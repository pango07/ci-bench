#!/usr/bin/env bash
# The vitest benchmark: plain `vitest` vs `quod vitest` on N consecutive
# first-parent commits ending at SHA, oldest first, on this runner.
#
#   bench.sh <project checkout> <sha> <n> <vitest args...>   (QUOD=path/to/quod)
#
# The parent of the window is a warm-up (both series run once; Quod records
# its ledger, as the previous CI run would have) and is not counted. Then, per
# commit: check it out, reinstall dependencies only when the lockfile
# changed (not timed), and run both series in alternating order with the
# same arguments plus a JSON reporter. The two JSON reports are compared per
# file and per test: a difference in a file Quod replayed is a wrong replay.
# Writes $RUNNER_TEMP/bench-vitest/{results.jsonl,report.md,logs/}.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
proj=$(cd "$1" && pwd); sha=$2; n=$3; shift 3
args=("$@")
out=${RUNNER_TEMP:-/tmp}/bench-vitest
state=/work/state/quod-vitest
rm -rf "$out" "$state"; mkdir -p "$out/logs"
: "${QUOD:?QUOD must point at the quod binary}"
cd "$proj"
mapfile -t commits < <(git rev-list --first-parent -n $((n + 1)) "$sha" | tac)
echo "window: ${#commits[@]} commits (first is the warm-up), ${commits[1]:0:9}..${commits[-1]:0:9}"
# Monotonic milliseconds: a hosted runner's wall clock is stepped mid-job.
ms() { awk '{ printf "%d\n", $1 * 1000 }' /proc/uptime; }
lock=$(sha1sum pnpm-lock.yaml 2>/dev/null | cut -c1-40)

# Through the action (QUOD_ACTION_REF): plain is QUOD_DISABLE=1 (the
# action's shim is on PATH), Quod is the plain command itself, and the
# ledger is the one the action's hook keeps (newest under its directory).
via_action() { [ -n "${QUOD_ACTION_REF:-}" ]; }
plain() { # $1 = tag
  local s; s=$(ms)
  QUOD_DISABLE=1 node_modules/.bin/vitest "${args[@]}" --reporter=default --reporter=json --outputFile.json="$out/plain.json" >"$out/logs/plain-$1.log" 2>&1
  local rc=$?
  echo "$(( $(ms) - s )) $rc"
}
quod() {
  local s; s=$(ms)
  if via_action; then
    node_modules/.bin/vitest "${args[@]}" --reporter=default --reporter=json --outputFile.json="$out/quod.json" >"$out/logs/quod-$1.log" 2>&1
    local rc=$?
    echo "$(( $(ms) - s )) $rc"
    return
  fi
  "$QUOD" vitest --dir "$state" --summary "$out/summary.json" -- "${args[@]}" --reporter=default --reporter=json --outputFile.json="$out/quod.json" >"$out/logs/quod-$1.log" 2>&1
  local rc=$?
  echo "$(( $(ms) - s )) $rc"
}

# Same-job A/B (QUOD_B=<another quod>, through the workflow's BIN_B): B
# runs every commit too, on its own ledger, interleaved with plain and A,
# and its report is compared with plain's the same way (b_* fields; the
# CI metrics get a B line). Mutation checks are A's only.
stateb=/work/state/quod-vitest-b
rm -rf "$stateb"
quodb() {
  local s; s=$(ms)
  "$QUOD_B" vitest --dir "$stateb" --summary "$out/summary-b.json" -- "${args[@]}" --reporter=default --reporter=json --outputFile.json="$out/quod-b.json" >"$out/logs/quodb-$1.log" 2>&1
  local rc=$?
  echo "$(( $(ms) - s )) $rc"
}

for i in "${!commits[@]}"; do
  c=${commits[$i]}
  git checkout -q --force "$c"
  nl=$(sha1sum pnpm-lock.yaml 2>/dev/null | cut -c1-40)
  install_ms=0
  # CI cost and CI fast count the install each CI job does: a fresh install
  # from the warm store per commit (FRESH_INSTALL=0: only when the lockfile changed).
  if [ "${FRESH_INSTALL:-1}" = 1 ]; then
    find . -name node_modules -type d -prune -exec rm -rf {} +
    lock=
  fi
  if [ "$nl" != "$lock" ]; then
    s=$(ms)
    PUPPETEER_SKIP_DOWNLOAD=true pnpm install --frozen-lockfile --prefer-offline >"$out/logs/install-$i.log" 2>&1 || echo "install failed at $c"
    install_ms=$(( $(ms) - s ))
    lock=$nl
  fi
  b_ms=; b_rc=; bcmp='{}'
  if [ -n "${QUOD_B:-}" ]; then
    rm -f "$out/summary-b.json"
    case $(( i % 3 )) in
      0) read -r p_ms p_rc < <(plain "$i"); read -r q_ms q_rc < <(quod "$i"); read -r b_ms b_rc < <(quodb "$i") ;;
      1) read -r q_ms q_rc < <(quod "$i"); read -r b_ms b_rc < <(quodb "$i"); read -r p_ms p_rc < <(plain "$i") ;;
      2) read -r b_ms b_rc < <(quodb "$i"); read -r p_ms p_rc < <(plain "$i"); read -r q_ms q_rc < <(quod "$i") ;;
    esac
  elif (( i % 2 == 0 )); then
    read -r p_ms p_rc < <(plain "$i"); read -r q_ms q_rc < <(quod "$i")
  else
    read -r q_ms q_rc < <(quod "$i"); read -r p_ms p_rc < <(plain "$i")
  fi
  if via_action; then
    state=$(find "$RUNNER_TEMP/quod/vitest" -mindepth 1 -maxdepth 1 -type d ! -name .suites -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
    [ -n "$state" ] || { echo "::error::the action did not run quod (no ledger directory)"; exit 1; }
    node -e '
      const fs = require("fs"); let o = {}; try { o = JSON.parse(fs.readFileSync(process.argv[1], "utf8")) } catch {}
      fs.writeFileSync(process.argv[2], JSON.stringify({ ran: (o.ran ?? []).length, replayed: (o.replayed ?? []).length, fast: o.fast ?? false, audited: 0, audit_mismatches: o.auditMismatch ?? [] }))
    ' "$state/out.json" "$out/summary.json"
  fi
  if (( i == 0 )) && [ "${OBSERVE:-1}" = 1 ] && ! via_action; then
    # The observer backstop, on the record run's commit (not timed).
    echo "::group::observer backstop"
    bash "$here/observe.sh" "$proj" "$state" "${args[@]}" 2>&1 | tee "$out/logs/observe.log" | tail -60
    echo "::endgroup::"
    cd "$proj"
    # B absorbs the same observation
    [ -n "${QUOD_B:-}" ] && "$QUOD_B" vitest --dir "$stateb" --absorb /work/state/quod-observer/manifest.json 2>&1 | tail -3
  fi
  [ -n "${QUOD_B:-}" ] && bcmp=$(node "$here/compare.mjs" "$out/plain.json" "$out/quod-b.json" "$stateb/out.json" 2>&1 | tee "$out/logs/compare-b-$i.log" | tail -1)
  cmp=$(node "$here/compare.mjs" "$out/plain.json" "$out/quod.json" "$state/out.json" 2>&1 | tee "$out/logs/compare-$i.log" | tail -1)
  files=$(git diff --name-only "$c^" "$c" 2>/dev/null)
  touched=$(echo "$files" | grep -c . || true)
  areas=$(echo "$files" | awk -F/ 'NF{ if ($1=="packages"||$1=="packages-private") print $1"/"$2; else if (NF>1) print $1"/"; else print $1 }' | sort | uniq -c | sort -rn | awk '{printf "%s%s(%s)", sep, $2, $1; sep=", "}')
  subject=$(git log -1 --format=%s "$c")
  node -e '
    const [i, c, subject, touched, areas, p_ms, p_rc, q_ms, q_rc, install_ms, cmp, sumPath, b_ms, b_rc, bcmp, bSumPath] = process.argv.slice(1)
    let s = {}; try { s = JSON.parse(require("fs").readFileSync(sumPath, "utf8")) } catch {}
    let k = {}; try { k = JSON.parse(cmp) } catch { k = { error: cmp } }
    let b = null
    if (b_ms) {
      let bs = {}; try { bs = JSON.parse(require("fs").readFileSync(bSumPath, "utf8")) } catch {}
      let bk = {}; try { bk = JSON.parse(bcmp) } catch { bk = { error: bcmp } }
      b = { b_ms: +b_ms, b_exit: +b_rc, b_ran: bs.ran, b_replayed: bs.replayed, b_select_ms: bs.select_ms, b_record_ms: bs.record_ms, b_fast: bs.fast ?? false,
        b_provisional: bs.provisional, b_promoted: bs.promoted, b_disagreed: bs.witness_disagreed, b_wrong: bk.wrong ?? null, b_recording: bk.recording ?? null, b_compare_error: bk.error }
    }
    console.log(JSON.stringify({ i: +i, warmup: i === "0", commit: c, subject, touched: +touched, areas,
      plain_ms: +p_ms, plain_exit: +p_rc, quod_ms: +q_ms, quod_exit: +q_rc, install_ms: +install_ms,
      ran: s.ran, replayed: s.replayed, audited: s.audited, audit_mismatches: s.audit_mismatches,
      shared_changed: s.shared_inputs_changed, unrecordable: s.unrecordable,
      select_ms: s.select_ms, record_ms: s.record_ms, vitest_ms: s.vitest_ms, driver: s.driver,
      narrowed: s.narrowed, narrow: s.narrow, shared_changed_keys: s.shared_changed_keys,
      provisional: s.provisional, promoted: s.promoted, disagreed: s.witness_disagreed,
      files: k.files, wrong: k.wrong ?? null, recording: k.recording ?? null, compare_error: k.error, ...b }))
  ' "$i" "$c" "$subject" "$touched" "$areas" "$p_ms" "$p_rc" "$q_ms" "$q_rc" "$install_ms" "$cmp" "$out/summary.json" "$b_ms" "$b_rc" "$bcmp" "$out/summary-b.json" | tee -a "$out/results.jsonl"

  # Mutation check (not timed): on some commits, a throw put into a
  # function some recorded test executed must make Quod run that test and
  # report the same failures as plain vitest. Then the tree is restored and
  # Quod re-records.
  if [[ " ${MUTATE:-4 9 14 19} " == *" $i "* ]]; then
    target=$(node "$here/mutate-pick.mjs" "$state/ledger.json" "$i" 2>/dev/null)
    if [ -n "$target" ]; then
      mfile=${target% *}; mline=${target##* }
      what=$(node "$proj/node_modules/.quod-vitest/narrow.mjs" mutate "$mfile" "$mline" 2>&1)
      rm -rf "$state.pre-mutation"; cp -a "$state" "$state.pre-mutation"
      plain "m$i" >/dev/null
      read -r mq_ms mq_rc < <(quod "m$i")
      mcmp=$(node "$here/compare.mjs" "$out/plain.json" "$out/quod.json" "$state/out.json" 2>&1 | tee "$out/logs/compare-m$i.log" | tail -1)
      node -e '
        const [i, target, what, rc, cmp, sumPath, plainPath] = process.argv.slice(1)
        const fs = require("fs")
        let s = {}; try { s = JSON.parse(fs.readFileSync(sumPath, "utf8")) } catch {}
        let k = {}; try { k = JSON.parse(cmp) } catch { k = { error: cmp } }
        let failedFiles = 0; try { failedFiles = JSON.parse(fs.readFileSync(plainPath, "utf8")).testResults.filter(t => t.status === "failed").length } catch {}
        console.log(JSON.stringify({ mutation: true, i: +i, target, what, quod_exit: +rc, ran: s.ran, replayed: s.replayed, narrowed: s.narrowed,
          plain_failed_files: failedFiles, wrong: k.wrong ?? null, recording: k.recording ?? null }))
      ' "$i" "$target" "$what" "$mq_rc" "$mcmp" "$out/summary.json" "$out/plain.json" | tee -a "$out/results.jsonl"
      git checkout -q --force "$c"
      # Back to the ledger as it was before the mutation (no extra recording
      # run: under the second-witness policy that would be a free witness).
      rm -rf "$state"; mv "$state.pre-mutation" "$state"
    fi
  fi
done
node "$here/ci-metrics.mjs" "$out/results.jsonl" "$out" > "$out/ci.md"
node "$here/report.mjs" "$out/results.jsonl" "${args[*]}" "$(git remote get-url origin)" > "$out/report.body.md"
cat "$out/ci.md" "$out/report.body.md" > "$out/report.md"
cat "$out/report.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$out/report.md" >> "$GITHUB_STEP_SUMMARY"
# Loud: a wrong replay, or a recorded run that differs from plain (the
# recording changed behaviour), fails the job; the warm-up counts too.
if node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);process.exit(l.some(r=>r.wrong===null||r.wrong.length||r.recording===null||r.recording?.length||("b_ms" in r&&(r.b_wrong===null||r.b_wrong.length||r.b_recording===null||r.b_recording?.length)))?1:0)' "$out/results.jsonl"; then
  echo "0 wrong replays, 0 recording differences"
else
  echo "::error::WRONG REPLAYS or RECORDING CHANGED BEHAVIOUR (or an uncompared commit): see report.md"; exit 1
fi
