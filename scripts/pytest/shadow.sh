#!/usr/bin/env bash
# The pytest benchmark, shadow-recording mode: recording off the critical path.
#
#   shadow.sh <project checkout> <sha> <n> <pytest args...>   (QUOD=path/to/quod, PY=the venv's python)
#
# Per commit, in sequence (as CI pushes minutes apart would see it):
#   1. plain     `python -m pytest` (the baseline: warm venv, as the project's CI runs it)
#   2. critical  `quod pytest --no-record`: select against the most recent
#                COMPLETED ledger, run the affected test files in one plain
#                pytest session, replay the rest (ledger untouched).
#                This is the developer's CI job: the HEADLINE number.
#   3. shadow    `quod pytest --expect-report <critical's summary>`: the
#                separate, non-blocking job of the same commit. Re-selects,
#                runs the affected files with recording, certifies each
#                recorded file (alone == in session), audits, and writes the
#                ledger the next commit's critical path reads.
# plain and critical alternate their order per commit. Commit 0 (the window's
# parent) is the first run ever: no ledger, every file runs and records.
#
# SHADOW_LAG=k: the critical path of commit i reads the ledger of commit
# i-1-k (the k most recent shadows have not finished yet).
#
# Every critical run's JUnit XML is compared with plain's test by test (a
# difference in a replayed file is a wrong replay; in a file that ran, flaky);
# so is every shadow's. Mutation check on commits $MUTATE: a raise in a
# function some recorded test executed; the critical path must report what
# plain reports. Writes $RUNNER_TEMP/bench-pytest/{results.jsonl,report.md,logs/}.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
proj=$(cd "$1" && pwd); sha=$2; n=$3; shift 3
args=("$@")
out=${RUNNER_TEMP:-/tmp}/bench-pytest
state=/work/state/quod-pytest        # the shadow's working ledger
snaps=/work/state/completed          # completed recordings, one per shadow (the cache entries)
lag=${SHADOW_LAG:-0}
audits=${SHADOW_AUDITS:-4}
rm -rf "$out" "$state" "$snaps"; mkdir -p "$out/logs" "$snaps" "$state"
: "${QUOD:?QUOD must point at the quod binary}"
: "${PY:?PY must point at the project venv python}"
# Every flag this script passes must exist in the binary under test: an
# older quod takes an unknown flag as a pytest argument. Fail loudly instead.
need_flags() { # binary, flags...
  local bin=$1 help; shift
  help=$("$bin" pytest --help 2>&1) || { echo "::error::$bin pytest --help failed"; exit 2; }
  for f in "$@"; do
    grep -q -- "$f" <<<"$help" || { echo "::error::$bin does not support quod pytest $f (this bench passes it); use a newer binary"; exit 2; }
  done
}
need_flags "$QUOD" --dir --audits --summary --no-record --expect-report --python
cd "$proj"
mapfile -t commits < <(git rev-list --first-parent -n $((n + 1)) "$sha" | tac)
echo "window: ${#commits[@]} commits (first is the first run ever), ${commits[1]:0:9}..${commits[-1]:0:9}; lag $lag, shadow audits $audits"
# A monotonic clock (CLOCK_BOOTTIME via /proc/uptime, 10 ms resolution): the
# wall clock of a hosted runner is stepped by time sync during the job.
ms() { local up _; read -r up _ </proc/uptime; echo $(( 10#${up/./} * 10 )); }
deps_hash() { cat pyproject.toml setup.py setup.cfg requirements*.txt 2>/dev/null | sha1sum | cut -c1-40; }
deps=$(deps_hash)

plain() { # $1 = tag
  rm -f "$out/plain.xml"; local s; s=$(ms)
  "$PY" -m pytest "${args[@]}" --junitxml="$out/plain.xml" >"$out/logs/plain-$1.log" 2>&1
  local rc=$?
  echo "$(( $(ms) - s )) $rc"
}
critical() { # $1 = tag, $2 = ledger dir (a completed recording; a fresh copy)
  rm -f "$out/crit-summary.json" "$out/crit.xml"; local s; s=$(ms)
  "$QUOD" pytest --python "$PY" --no-record --dir "$2" --summary "$out/crit-summary.json" -- "${args[@]}" --junitxml="$out/crit.xml" >"$out/logs/crit-$1.log" 2>&1
  local rc=$?
  echo "$(( $(ms) - s )) $rc"
}
shadow() { # $1 = tag
  rm -f "$out/shadow-summary.json" "$out/shadow.xml"; local s; s=$(ms)
  env ${SHADOW_ENV:-} "$QUOD" pytest --python "$PY" --dir "$state" --audits "$audits" --expect-report "$out/crit-summary.json" --summary "$out/shadow-summary.json" -- "${args[@]}" --junitxml="$out/shadow.xml" >"$out/logs/shadow-$1.log" 2>&1
  local rc=$?
  echo "$(( $(ms) - s )) $rc"
}
ledger_for() {
  local k=$(( $1 - 1 - lag ))
  local d=/work/state/crit-ledger
  rm -rf "$d"; mkdir -p "$d"
  while (( k >= 0 )); do
    if [ -d "$snaps/$k" ]; then cp -a "$snaps/$k/." "$d/"; echo "$d $k"; return; fi
    k=$(( k - 1 ))
  done
  echo "$d -1"
}

for i in "${!commits[@]}"; do
  c=${commits[$i]}
  git checkout -q --force "$c"
  install_ms=0
  nd=$(deps_hash)
  if [ "$nd" != "$deps" ]; then
    s=$(ms)
    uv pip install -q -p "$PY" -e . ${INSTALL//,/ } >"$out/logs/install-$i.log" 2>&1 || echo "install failed at $c"
    install_ms=$(( $(ms) - s )); deps=$nd
  fi
  read -r cdir from < <(ledger_for "$i")
  if (( i % 2 == 0 )); then
    read -r p_ms p_rc < <(plain "$i"); read -r q_ms q_rc < <(critical "$i" "$cdir")
  else
    read -r q_ms q_rc < <(critical "$i" "$cdir"); read -r p_ms p_rc < <(plain "$i")
  fi
  cmp=$(python3 "$here/compare.py" "$out/plain.xml" "$out/crit.xml" "$out/crit-summary.json" 2>&1 | tee "$out/logs/compare-$i.log" | tail -1)
  read -r sh_ms sh_rc < <(shadow "$i")
  scmp=$(python3 "$here/compare.py" "$out/plain.xml" "$out/shadow.xml" "$out/shadow-summary.json" 2>&1 | tee "$out/logs/compare-shadow-$i.log" | tail -1)
  mkdir -p "$snaps/$i"; cp -a "$state/." "$snaps/$i/"
  ledger_bytes=$(du -sb "$snaps/$i" | cut -f1)
  files=$(git diff --name-only "$c^" "$c" 2>/dev/null)
  touched=$(echo "$files" | grep -c . || true)
  areas=$(echo "$files" | awk -F/ 'NF{ if (NF>1) print $1"/"; else print $1 }' | sort | uniq -c | sort -rn | awk '{printf "%s%s(%s)", sep, $2, $1; sep=", "}')
  subject=$(git log -1 --format=%s "$c")
  python3 "$here/row.py" "$i" "$c" "$subject" "$touched" "$areas" "$p_ms" "$p_rc" "$q_ms" "$q_rc" "$sh_ms" "$sh_rc" "$from" "$install_ms" "$ledger_bytes" "$cmp" "$scmp" "$out/crit-summary.json" "$out/shadow-summary.json" | tee -a "$out/results.jsonl"

  # Mutation check (not timed): a raise in a function some recorded test
  # executed must make the critical path run the tests it breaks and report
  # what plain pytest reports.
  if [[ " ${MUTATE:-4 9 14 19} " == *" $i "* ]]; then
    cp "$snaps/$i/ledger.json" "$out/logs/ledger-$i.json"
    what=$(python3 "$here/mutate.py" "$snaps/$i/ledger.json" "$i" "$proj" 2>"$out/logs/mutate-$i.log")
    if [ -z "$what" ]; then
      echo "mutation check at $i: no target ($(tail -1 "$out/logs/mutate-$i.log"))"
    else
      plain "m$i" >/dev/null
      read -r mdir _ < <(ledger_for $(( i + 1 + lag )))
      read -r mq_ms mq_rc < <(critical "m$i" "$mdir")
      mcmp=$(python3 "$here/compare.py" "$out/plain.xml" "$out/crit.xml" "$out/crit-summary.json" 2>&1 | tee "$out/logs/compare-m$i.log" | tail -1)
      python3 - "$i" "$what" "$mq_rc" "$mcmp" "$out/crit-summary.json" <<'EOF' | tee -a "$out/results.jsonl"
import json, sys
i, what, rc, cmp, sp = sys.argv[1:]
try: s = json.load(open(sp))
except Exception: s = {}
try: k = json.loads(cmp)
except Exception: k = {"error": cmp}
print(json.dumps({"mutation": True, "i": int(i), "target": what, "quod_exit": int(rc), "ran": s.get("ran"), "replayed": s.get("replayed"),
  "plain_failed": k.get("plain_failed"), "crit_failed": k.get("crit_failed"), "wrong": k.get("wrong"), "flaky": k.get("flaky")}))
EOF
      git checkout -q --force "$c"
    fi
  fi
done
cp "$state/ledger.json" "$out/logs/ledger-final.json" 2>/dev/null
python3 "$here/report.py" "$out/results.jsonl" "${args[*]}" "$(git remote get-url origin)" "$lag" "$audits" > "$out/report.md"
cat "$out/report.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$out/report.md" >> "$GITHUB_STEP_SUMMARY"
if python3 -c '
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
bad = [r for r in rows if r.get("wrong") is None or r.get("wrong")]
sys.exit(1 if bad else 0)' "$out/results.jsonl"; then
  echo "0 wrong replays"
else
  echo "::error::WRONG REPLAYS (or an uncompared commit): see report.md"; exit 1
fi
