#!/usr/bin/env bash
# The drop-in bench, one repository: its real CI test step, unchanged, on N
# consecutive first-parent commits, with Quod added the way a customer adds
# it (pango07/quod-action, already run as a step of this job, mode check).
#
#   run.sh   (env: DROPIN_{SHA,COMMITS,INSTALL,BUILD,TEST,WORKDIR,EXTRA_ENV,META}; cwd = the project)
#
# Per commit, as CI would see it (fresh checkout + install from a warm store,
# the repo's build steps, then the test step):
#   plain   the test command with Quod's hook not loaded
#   check   the test command with the action's shim + hook (mode check),
#           reading the newest completed recording (the previous commit's shadow)
#   shadow  the test command with the hook in mode shadow (what
#           quod-action/.github/workflows/shadow.yml does), recording from
#           the previous recording, with the check run's reports as its
#           --expect-report; its ledger is the next commit's recording.
# plain and check alternate order. Every vitest command line the test step
# starts gets a JSON reporter appended (bench.cjs, before the hook), so the
# three runs are compared per file and per test (compare.mjs).
#
# The only change to the action's runtime: the node shim it put on PATH is
# rewritten to also preload bench.cjs (and, for plain, to not preload the
# hook: QUOD_DISABLE does not survive turbo's strict env), and config.json's
# mode is switched between check and shadow. The ledger hand-off is local
# (cloud: false), one directory per completed recording.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
proj=$(pwd)
out=$RUNNER_TEMP/dropin
Q=$RUNNER_TEMP/quod
L=$Q/vitest
D=$Q/dropin
snaps=$RUNNER_TEMP/dropin-snaps
rm -rf "$out" "$snaps"; mkdir -p "$out/logs" "$out/runs" "$snaps" "$D"
for kv in ${DROPIN_EXTRA_ENV:-}; do export "$kv"; done
ms() { local up _; read -r up _ </proc/uptime; echo $(( 10#${up/./} * 10 )); }

active=0
[ -x "$Q/bin/node" ] && [ -f "$Q/config.json" ] && active=1
echo "quod-action active: $active"
[ $active = 1 ] && cat "$Q/bin/node"
REAL=$(QUOD_SHIM_ACTIVE=1 node -p process.execPath)
echo "node: $REAL ($("$REAL" --version))"
mkdir -p "$Q/bin"
export PATH="$Q/bin:$PATH"
cp "$here/bench.cjs" "$D/bench.cjs"
printf '{"root":"%s","cur":"%s"}' "$proj" "$D/cur" > "$D/control.json"
quodbin=$([ $active = 1 ] && node -p 'require(process.argv[1]).quod' "$Q/config.json")
echo "quod: ${quodbin:-none} $([ -n "$quodbin" ] && "$quodbin" --version 2>&1 | head -1)"

# DROPIN_MODE=witness (default): no shadow job. The test job records inline
# with second-witness trust (QUOD_VITEST_WITNESSES=2, DROPIN_QUOD_W: a
# second-witness quod): the action's hook, with its check-mode
# `--no-record` dropped (what an inline-recording action would run), and the
# ledger carried from each commit's job to the next. DROPIN_MODE=shadow: the
# released check + shadow pair.
mode=${DROPIN_MODE:-witness}
# DROPIN_HOOK_REF: the action's hook.cjs from that ref of pango07/quod-action
# instead of the pinned action's (a hook change benched before its release).
if [ -n "${DROPIN_HOOK_REF:-}" ] && [ $active = 1 ]; then
  curl -fsSL "https://raw.githubusercontent.com/pango07/quod-action/$DROPIN_HOOK_REF/hook.cjs" -o "$Q/hook.cjs.new" && mv "$Q/hook.cjs.new" "$Q/hook.cjs" \
    || { echo "::error::could not fetch hook.cjs at $DROPIN_HOOK_REF"; exit 2; }
  echo "hook.cjs from pango07/quod-action@$DROPIN_HOOK_REF"
fi
if [ "$mode" = witness ] && [ $active = 1 ]; then
  [ -x "${DROPIN_QUOD_W:-}" ] || { echo "::error::witness mode needs DROPIN_QUOD_W"; exit 2; }
  sed "s/'--no-record', //" "$Q/hook.cjs" > "$Q/hook-witness.cjs"
  grep -q -- "--no-record" "$Q/hook-witness.cjs" && { echo "::error::could not drop --no-record from hook.cjs"; exit 2; }
  QUOD_SHIM_ACTIVE=1 "$REAL" -e 'const f=process.argv[1],c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.quod=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(c),{mode:0o600})' "$Q/config.json" "$DROPIN_QUOD_W"
  export QUOD_VITEST_WITNESSES=2
  rm -rf "$L"; mkdir -p "$L"   # no recording yet (the action may have restored one from this repo's cache)
  echo "witness mode: $DROPIN_QUOD_W ($("$DROPIN_QUOD_W" --version 2>&1 | head -1)), QUOD_VITEST_WITNESSES=2"
fi
setmode() { # plain | check | shadow | witness
  local req="--require '$D/bench.cjs'"
  [ "$1" = check ] || [ "$1" = shadow ] && [ $active = 1 ] && req="$req --require '$Q/hook.cjs'"
  [ "$1" = witness ] && [ $active = 1 ] && req="$req --require '$Q/hook-witness.cjs'"
  printf '#!/bin/sh\n[ "$QUOD_SHIM_ACTIVE" = 1 ] && exec %s "$@"\nexec %s %s "$@"\n' "'$REAL'" "'$REAL'" "$req" > "$Q/bin/node"
  chmod +x "$Q/bin/node"
  if [ $active = 1 ] && [ "$1" != plain ]; then
    QUOD_SHIM_ACTIVE=1 "$REAL" -e 'const f=process.argv[1],c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.mode=process.argv[2]==="shadow"?"shadow":"check";c.cloud=null;require("fs").writeFileSync(f,JSON.stringify(c),{mode:0o600})' "$Q/config.json" "$1"
  fi
  rm -rf "$D/cur"; mkdir -p "$D/cur"
}
ledger_from() { # commit index whose completed recording to restore (-1: none)
  rm -rf "$L"; mkdir -p "$L"
  [ "$1" -ge 0 ] && [ -d "$snaps/$1" ] && cp -a "$snaps/$1/." "$L/"
  return 0
}
clean_caches() { # what a fresh runner would not have: task-runner caches
  find "$proj" -name .turbo -type d -prune -exec rm -rf {} + 2>/dev/null
  rm -rf "$proj/node_modules/.cache/turbo" "$proj/.nx/cache" "$proj/.nx/workspace-data" 2>/dev/null
  return 0
}
# The coverage outputs a job uploads or checks, wherever vitest wrote them.
covfiles() { find "$proj" \( -name node_modules -o -name .git \) -prune -o -type f \( -name coverage-final.json -o -name lcov.info -o -name coverage-summary.json -o -name clover.xml \) -print 2>/dev/null; }
runtest() { # tag, commit index -> "ms rc"
  local tag=$1 i=$2 s rc
  clean_caches
  covfiles | while read -r f; do rm -f "$f"; done
  s=$(ms)
  # Each run is its own CI job: the per-job and per-run variables GitHub sets
  # differ (the commit, the run, the job, the runner).
  (cd "$proj/${DROPIN_WORKDIR:-.}" && GITHUB_SHA=$(git rev-parse HEAD) GITHUB_RUN_ID=$((4100000000 + i)) GITHUB_RUN_NUMBER=$((100 + i)) \
    GITHUB_JOB=$([ "$tag" = shadow ] && echo record || echo test) RUNNER_TRACKING_ID="github_$tag-$i-$RANDOM" RUNNER_NAME="GitHub Actions $RANDOM" \
    env ${DROPIN_RUN_ENV:-} bash -c "$DROPIN_TEST") >"$out/logs/$tag-$i.log" 2>&1
  rc=$?
  local d=$(( $(ms) - s ))
  mkdir -p "$out/runs/$i/$tag"; cp -a "$D/cur/." "$out/runs/$i/$tag/" 2>/dev/null
  mkdir -p "$out/runs/$i/$tag-cov"
  covfiles | while read -r f; do r=${f#"$proj"/}; cp "$f" "$out/runs/$i/$tag-cov/${r//\//__}"; done
  echo "$d $rc"
}

cd "$proj"
mapfile -t commits < <(git rev-list --first-parent -n $((DROPIN_COMMITS + 1)) "$DROPIN_SHA" | tac)
echo "window: ${#commits[@]} commits (first is the first run ever), ${commits[0]:0:9}..${commits[-1]:0:9}"

for i in "${!commits[@]}"; do
  c=${commits[$i]}
  echo "::group::commit $i ${c:0:9} $(git log -1 --format=%s "$c" | cut -c1-80)"
  git checkout -q --force "$c"; git clean -qffdx
  s=$(ms); (bash -c "$DROPIN_INSTALL") >"$out/logs/install-$i.log" 2>&1; irc=$?; install_ms=$(( $(ms) - s ))
  s=$(ms); brc=0; [ -n "${DROPIN_BUILD:-}" ] && { (bash -c "$DROPIN_BUILD") >"$out/logs/build-$i.log" 2>&1; brc=$?; }; build_ms=$(( $(ms) - s ))
  [ $irc = 0 ] && [ $brc = 0 ] || echo "::warning::commit $i: install rc $irc, build rc $brc"
  if (( i == 0 )); then
    # Diagnostics, once: which node the package manager's scripts see
    # (DROPIN_PROBE), and whether QUOD_DISABLE=1 in the job's env reaches the
    # hook through the test command (task runners filter the environment).
    if [ -n "${DROPIN_PROBE:-}" ]; then
      setmode check
      echo "probe: $DROPIN_PROBE"; (bash -c "$DROPIN_PROBE") 2>&1 | tee "$out/logs/probe.log" | head -20
    fi
    if [ "${DROPIN_PROBE_DISABLE:-}" = true ] && [ $active = 1 ]; then
      setmode check; ledger_from -1; rm -rf "$Q/reports"; mkdir -p "$Q/reports"
      (cd "$proj/${DROPIN_WORKDIR:-.}" && QUOD_DISABLE=1 bash -c "$DROPIN_TEST") >"$out/logs/probe-disable.log" 2>&1
      n=$(ls "$Q/reports" | wc -l)
      echo "probe: with QUOD_DISABLE=1 in the environment, Quod still ran $n vitest command lines" | tee -a "$out/logs/probe.log"
    fi
  fi
  keep=$out/runs/$i/check-out; mkdir -p "$keep"
  savout() { for f in "$L"/*/out.json; do [ -f "$f" ] && cp "$f" "$keep/$(basename "$(dirname "$f")").json"; done; return 0; }
  sh_ms=0; sh_rc=0
  if [ "$mode" = witness ]; then
    # One job per commit: the ledger the previous commit's job left.
    rm -f "$L"/*/out.json; rm -rf "$Q/reports"; mkdir -p "$Q/reports"
    if (( i % 2 == 0 )); then
      setmode plain; read -r p_ms p_rc < <(runtest plain "$i")
      setmode witness; read -r q_ms q_rc < <(runtest check "$i"); savout
    else
      setmode witness; read -r q_ms q_rc < <(runtest check "$i"); savout
      setmode plain; read -r p_ms p_rc < <(runtest plain "$i")
    fi
    cp -a "$Q/reports" "$out/runs/$i/check-reports" 2>/dev/null
    (( i < 2 )) && { echo "witness run $i wrote:"; find "$L" "$Q/reports" "$D/cur" "$proj" -path "$proj/node_modules" -prune -o -name '*.json' -newer "$out/logs/plain-$i.log" -print 2>/dev/null | grep -v '/dump/\|/results/' | head -20; } | tee -a "$out/logs/witness-files.log"
  else
    if (( i % 2 == 0 )); then
      setmode plain; read -r p_ms p_rc < <(runtest plain "$i")
      setmode check; ledger_from $((i - 1)); rm -rf "$Q/reports"; mkdir -p "$Q/reports"
      read -r q_ms q_rc < <(runtest check "$i"); savout
    else
      setmode check; ledger_from $((i - 1)); rm -rf "$Q/reports"; mkdir -p "$Q/reports"
      read -r q_ms q_rc < <(runtest check "$i"); savout
      setmode plain; read -r p_ms p_rc < <(runtest plain "$i")
    fi
    cp -a "$Q/reports" "$out/runs/$i/check-reports" 2>/dev/null
    setmode shadow; ledger_from $((i - 1))
    read -r sh_ms sh_rc < <(runtest shadow "$i")
    mkdir -p "$snaps/$i"; cp -a "$L/." "$snaps/$i/"
  fi
  recorded=$(QUOD_SHIM_ACTIVE=1 "$REAL" -e 'let n=0;for(const f of process.argv.slice(1)){try{n+=Object.keys(JSON.parse(require("fs").readFileSync(f,"utf8")).files||{}).length}catch{}}console.log(n)' "$L"/*/ledger.json)
  cmp=$(QUOD_SHIM_ACTIVE=1 "$REAL" "$here/compare.mjs" "$out/runs/$i" 2>"$out/logs/compare-$i.err")
  covc=$(QUOD_SHIM_ACTIVE=1 "$REAL" "$here/covcmp.mjs" "$out/runs/$i/plain-cov" "$out/runs/$i/check-cov" "$out/logs/plain-$i.log" "$out/logs/check-$i.log" 2>>"$out/logs/compare-$i.err")
  echo "coverage, commit $i: $covc"
  pc=$(QUOD_SHIM_ACTIVE=1 "$REAL" "$here/counts.mjs" "$out/logs/plain-$i.log"); qc=$(QUOD_SHIM_ACTIVE=1 "$REAL" "$here/counts.mjs" "$out/logs/check-$i.log")
  quodlines=$(grep -h -oE 'quod( vitest)?:.*' "$out/logs/check-$i.log" | grep -vE '(GITHUB|RUNNER|ACTIONS)_[A-Z_]* keyed for every' | sort | uniq -c | sort -rn | head -6 | sed 's/^ *//' | tr '\n' '|')
  shlines=$(grep -h -oE 'quod( vitest)?:.*' "$out/logs/shadow-$i.log" 2>/dev/null | grep -vE '(GITHUB|RUNNER|ACTIONS)_[A-Z_]* keyed for every' | sort | uniq -c | sort -rn | head -6 | sed 's/^ *//' | tr '\n' '|')
  DROPIN_MODE_EFF=$mode QUOD_SHIM_ACTIVE=1 "$REAL" -e '
    const [i, c, subject, p_ms, p_rc, q_ms, q_rc, sh_ms, sh_rc, install_ms, build_ms, irc, brc, recorded, cmp, ql, sl, pc, qc, covc] = process.argv.slice(1)
    let cov; try { cov = JSON.parse(covc) } catch { cov = { error: covc || "covcmp failed", diffs: [{ file: "(covcmp)", why: "failed" }] } }
    let k; try { k = JSON.parse(cmp) } catch { k = { error: cmp || "compare failed" } }
    // Where the Quod run left no per-test report, its per-state counts against plain.
    const P = JSON.parse(pc), Q = JSON.parse(qc)
    const countsMatch = JSON.stringify(P.files) === JSON.stringify(Q.files) && JSON.stringify(P.tests) === JSON.stringify(Q.tests)
    const noReport = (k.missing ?? []).filter((m) => /no check report/.test(m))
    if (noReport.length && !k.error) {
      k.missing = k.missing.filter((m) => !/no check report/.test(m))
      if (!countsMatch) k.wrong.push({ file: "(counts)", plain: JSON.stringify(P), check: JSON.stringify(Q), minus: [], plus: [] })
    }
    const row = { i: +i, first: i === "0", commit: c, subject,
      plain_ms: +p_ms, plain_exit: +p_rc, ...(process.env.DROPIN_MODE_EFF === "witness" ? { quod_ms: +q_ms, quod_exit: +q_rc, mode: "witness" } : { crit_ms: +q_ms, crit_exit: +q_rc, shadow_ms: +sh_ms, shadow_exit: +sh_rc, mode: "shadow" }),
      install_ms: +install_ms + +build_ms, install_only_ms: +install_ms, build_ms: +build_ms, install_rc: +irc, build_rc: +brc,
      recorded: +recorded, invocations: k.invocations ?? 0, intercepted: k.intercepted ?? 0, files: k.files ?? 0, ran: k.ran ?? 0, replayed: k.replayed ?? 0,
      wrong: k.error ? null : k.wrong.map((w) => w.file), wrong_detail: k.wrong, flaky: k.flaky?.map((w) => w.file) ?? null, flaky_detail: k.flaky,
      check_from_quod_report: k.check_from_quod_report ?? 0, compared_by_counts: noReport.length, counts_plain: P, counts_check: Q, counts_match: countsMatch, missing: k.missing ?? [], declined: k.declined ?? [], shadow_diff: k.shadow_diff ?? [], per_key: k.per_key, compare_error: k.error,
      quod_check_log: ql, quod_shadow_log: sl, cov }
    console.log(JSON.stringify(row))
  ' "$i" "$c" "$(git log -1 --format=%s "$c")" "$p_ms" "$p_rc" "$q_ms" "$q_rc" "$sh_ms" "$sh_rc" "$install_ms" "$build_ms" "$irc" "$brc" "$recorded" "$cmp" "$quodlines" "$shlines" "$pc" "$qc" "$covc" | tee -a "$out/results.jsonl"
  echo "::endgroup::"
done
# The pull-request case: a PR's first commit restores the default branch's
# newest recording. The last commit's check again, against the last
# recording, with the variables a pull_request job has.
if [ $active = 1 ]; then
  last=$(( ${#commits[@]} - 1 ))
  if [ "$mode" = witness ]; then cp -a "$L" "$L.keep"; setmode witness; rm -f "$L"/*/out.json
  else setmode check; ledger_from "$last"; fi
  rm -rf "$Q/reports"; mkdir -p "$Q/reports"
  DROPIN_RUN_ENV="GITHUB_EVENT_NAME=pull_request GITHUB_REF=refs/pull/1/merge GITHUB_REF_NAME=1/merge GITHUB_HEAD_REF=dropin-pr GITHUB_BASE_REF=${GITHUB_REF_NAME:-main}" \
    runtest pr "$last" >/dev/null
  mkdir -p "$out/runs/$last/check-out-pr"
  for f in "$L"/*/out.json; do [ -f "$f" ] && cp "$f" "$out/runs/$last/check-out-pr/"; done
  pr=$(grep -h -oE 'quod vitest: (ran|every file).*|shared input changed.*' "$out/logs/pr-$last.log" | head -6 | tr '\n' '|')
  [ "$mode" = witness ] && { rm -rf "$L"; mv "$L.keep" "$L"; }
  echo "pull_request check of the last commit against the ledger the push jobs left: $pr" | tee "$out/pr.txt"
fi
# Nothing for the action's post step to upload (its artifact name is the
# same in every matrix job).
rm -rf "$Q/reports"
QUOD_SHIM_ACTIVE=1 "$REAL" "$here/../vitest/ci-metrics.mjs" "$out/results.jsonl" "$out" > "$out/ci.md" || true
QUOD_SHIM_ACTIVE=1 "$REAL" "$here/report.mjs" "$out/results.jsonl" "$out" > "$out/report.md"
cat "$out/ci.md" "$out/report.md"
QUOD_SHIM_ACTIVE=1 "$REAL" -e '
  const l = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse)
  const files = l.reduce((n, r) => n + (r.cov?.files ?? 0), 0), same = l.reduce((n, r) => n + (r.cov?.same ?? 0), 0)
  const bad = l.filter((r) => r.cov?.diffs?.length)
  console.log(`\n### Coverage outputs, plain against Quod\n\n${files ? `${same} of ${files} coverage outputs identical over ${l.length} commits (coverage-final.json, lcov.info, coverage-summary.json, clover.xml without timestamps, the text table)` : "no coverage outputs on any commit"}; ${bad.length ? `DIFFERENCES on commits ${bad.map((r) => r.i).join(",")}: ${JSON.stringify(bad[0].cov.diffs.slice(0, 4))}` : "0 differences"}`)
  const t = l.find((r) => r.cov?.totals)?.cov.totals; if (t) console.log(`\nplain totals (first commit with a summary): ${JSON.stringify(t)}`)
' "$out/results.jsonl" >> "$out/report.md"
cat "$out/report.md" | tail -4
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$out/report.md" "$out/ci.md" >> "$GITHUB_STEP_SUMMARY"
# Loud: a wrong replay fails the job.
if QUOD_SHIM_ACTIVE=1 "$REAL" -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);process.exit(l.some(r=>r.wrong===null||r.wrong.length||r.cov?.diffs?.length)?1:0)' "$out/results.jsonl"; then
  echo "0 wrong replays"
else
  echo "::error::WRONG REPLAYS (or an uncompared commit): see report.md"; exit 1
fi
