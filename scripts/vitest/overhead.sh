#!/usr/bin/env bash
# Inline recording overhead: plain `vitest`, `quod vitest --no-record` and
# `quod vitest` (inline recording, --audits auto), interleaved ROUNDS times
# each (rotating order), per commit, on one runner.
#
#   overhead.sh <project checkout> <sha> <n> <vitest args...>   (QUOD=path/to/quod)
#
# Two kinds of measurement per commit:
#   full     every file must run: both Quod modes start from an empty ledger
#            (the first run ever, or a shared input changed). On the commits
#            in FULL_AT (default: all).
#   typical  both Quod modes start from a copy of the same ledger: the one
#            the previous commit's inline run recorded (so the same files
#            replay and run in both; the difference is the recording).
#            Every commit but the window's first.
# Every run's JSON report is compared with the same round's plain report,
# per file and per test (compare.mjs). Writes
# $RUNNER_TEMP/bench-vitest/{results.jsonl,report.md,overhead.json,logs/}.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
proj=$(cd "$1" && pwd); sha=$2; n=$3; shift 3
args=("$@")
out=${RUNNER_TEMP:-/tmp}/bench-vitest
work=/work/state/oh
rounds=${ROUNDS:-5}
rm -rf "$out" "$work"; mkdir -p "$out/logs" "$work"
: "${QUOD:?QUOD must point at the quod binary}"
cd "$proj"
mapfile -t commits < <(git rev-list --first-parent -n $((n + 1)) "$sha" | tac)
echo "window: ${#commits[@]} commits, ${commits[0]:0:9}..${commits[-1]:0:9}; $rounds rounds per mode"
ms() { local up _; read -r up _ </proc/uptime; echo $(( 10#${up/./} * 10 )); }
lock=

plain() { # tag
  rm -f "$out/plain.json"; local s; s=$(ms)
  node_modules/.bin/vitest "${args[@]}" --reporter=default --reporter=json --outputFile.json="$out/plain.json" >"$out/logs/plain-$1.log" 2>&1
  local rc=$?; echo "$(( $(ms) - s )) $rc"
}
quodrun() { # tag, dir, extra flags...
  local tag=$1 dir=$2; shift 2
  rm -f "$out/q.summary.json" "$out/quod.json"; local s; s=$(ms)
  "$QUOD" vitest "$@" --dir "$dir" --summary "$out/q.summary.json" -- "${args[@]}" --reporter=default --reporter=json --outputFile.json="$out/quod.json" >"$out/logs/$tag.log" 2>&1
  local rc=$?; echo "$(( $(ms) - s )) $rc"
}
row() { # kind i round mode ms rc report dir
  local cmp='{}'
  if [ "$4" != plain ]; then
    cmp=$(node "$here/compare.mjs" "$out/plain.json" "$out/quod.json" "$8/out.json" 2>&1 | tee "$out/logs/compare-$1-$2-$3-$4.log" | tail -1)
  fi
  node -e '
    const [kind, i, round, mode, ms, rc, cmp, sumPath, commit] = process.argv.slice(1)
    const fs = require("fs")
    let s = {}; try { s = mode === "plain" ? {} : JSON.parse(fs.readFileSync(sumPath, "utf8")) } catch {}
    let k = {}; try { k = JSON.parse(cmp) } catch { k = { error: cmp } }
    console.log(JSON.stringify({ kind, i: +i, round: +round, mode, commit, ms: +ms, exit: +rc,
      ran: s.ran, replayed: s.replayed, audited: s.audited, record_ms: s.record_ms, select_ms: s.select_ms,
      files: k.files, differences: mode === "plain" ? 0 : (k.differences ?? null), wrong: k.wrong ?? (mode === "plain" ? [] : null), recording: k.recording ?? [] }))
  ' "$1" "$2" "$3" "$4" "$5" "$6" "$cmp" "$out/q.summary.json" "$c" | tee -a "$out/results.jsonl"
}

prev=     # the ledger the previous commit's last inline run recorded
for i in "${!commits[@]}"; do
  c=${commits[$i]}
  git checkout -q --force "$c"
  nl=$(sha1sum pnpm-lock.yaml 2>/dev/null | cut -c1-40)
  if [ "$nl" != "$lock" ]; then
    PUPPETEER_SKIP_DOWNLOAD=true pnpm install --frozen-lockfile --prefer-offline >"$out/logs/install-$i.log" 2>&1 || echo "install failed at $c"
    lock=$nl
  fi
  kinds=()
  if [ "${FULL_AT:-all}" = all ] || [[ " ${FULL_AT} " == *" $i "* ]]; then kinds+=(full); fi
  [ -n "$prev" ] && kinds+=(typical)
  last=
  for kind in "${kinds[@]}"; do
    for ((r = 0; r < rounds; r++)); do
      # Fresh ledger copies for both Quod modes: empty (full) or the previous recording (typical).
      for m in norec rec; do
        d=$work/$kind-$m; rm -rf "$d"; mkdir -p "$d"
        [ "$kind" = typical ] && cp -a "$prev/." "$d/"
      done
      order=(plain norec rec)
      case $(( (r + i) % 3 )) in 1) order=(norec rec plain);; 2) order=(rec plain norec);; esac
      # Each Quod run is compared with this round's plain report.
      rm -f "$out"/plain-$r.json "$out"/{plain,norec,rec}.json "$out"/{norec,rec}.summary.json
      declare -A t=() rc=()
      for m in "${order[@]}"; do
        case $m in
          plain) read -r t[$m] rc[$m] < <(plain "$kind-$i-$r"); cp "$out/plain.json" "$out/plain-$r.json" 2>/dev/null ;;
          norec) read -r t[$m] rc[$m] < <(quodrun "norec-$kind-$i-$r" "$work/$kind-norec" --no-record); cp "$out/quod.json" "$out/norec.json" 2>/dev/null; cp "$out/q.summary.json" "$out/norec.summary.json" 2>/dev/null ;;
          rec) read -r t[$m] rc[$m] < <(quodrun "rec-$kind-$i-$r" "$work/$kind-rec" --audits auto); cp "$out/quod.json" "$out/rec.json" 2>/dev/null; cp "$out/q.summary.json" "$out/rec.summary.json" 2>/dev/null ;;
        esac
      done
      cp "$out/plain-$r.json" "$out/plain.json" 2>/dev/null
      row "$kind" "$i" "$r" plain "${t[plain]}" "${rc[plain]}" "" ""
      rm -f "$out/quod.json" "$out/q.summary.json"; cp "$out/norec.json" "$out/quod.json" 2>/dev/null; cp "$out/norec.summary.json" "$out/q.summary.json" 2>/dev/null
      row "$kind" "$i" "$r" norec "${t[norec]}" "${rc[norec]}" "" "$work/$kind-norec"
      rm -f "$out/quod.json" "$out/q.summary.json"; cp "$out/rec.json" "$out/quod.json" 2>/dev/null; cp "$out/rec.summary.json" "$out/q.summary.json" 2>/dev/null
      row "$kind" "$i" "$r" rec "${t[rec]}" "${rc[rec]}" "" "$work/$kind-rec"
      unset t rc
    done
    # The next commit's typical ledger: this commit's last inline recording
    # (typical when there was one; the full record on the first commit).
    if [ "$kind" = typical ] || [ -z "$prev" ]; then last=$work/$kind-rec; fi
  done
  if [ -n "$last" ]; then rm -rf "$work/prev"; cp -a "$last" "$work/prev"; prev=$work/prev; fi
done
node "$here/report-overhead.mjs" "$out/results.jsonl" "${args[*]}" "$(git remote get-url origin)" "$out/overhead.json" > "$out/report.md"
cat "$out/report.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$out/report.md" >> "$GITHUB_STEP_SUMMARY"
if node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);process.exit(l.some(r=>r.differences===null||r.differences>0)?1:0)' "$out/results.jsonl"; then
  echo "0 differences against plain"
else
  echo "::error::A Quod run's report differs from plain's (or was not compared): see report.md"; exit 1
fi
