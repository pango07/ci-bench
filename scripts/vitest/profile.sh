#!/usr/bin/env bash
# The inline recorder's cost, part by part, at one commit: plain vitest,
# `quod vitest --no-record` and `quod vitest` (inline recording) with parts
# of the recorder switched off (QUOD_VITEST_DISABLE) or experiments on,
# interleaved in rotating order, ROUNDS times each.
#
#   profile.sh <project checkout> <vitest args...>     (QUOD=...)
#
#   full     every file runs (each Quod run from an empty ledger)
#   typical  PROFILE_TYPICAL=1: each Quod run from a copy of the ledger the
#            parent commit recorded (the files the commit changed run)
#
# Every run's summary (record phases, the driver's worker sums) goes to
# results.jsonl; report-profile.mjs makes the table. Also CPU profiles of
# one worker per mode when PROFILE_CPU=1.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
proj=$(cd "$1" && pwd); shift
args=("$@")
out=${RUNNER_TEMP:-/tmp}/bench-vitest
work=/work/state/profile
rounds=${ROUNDS:-3}
rm -rf "$out" "$work"; mkdir -p "$out/logs" "$work"
: "${QUOD:?QUOD must point at the quod binary}"
cd "$proj"
ms() { local up _; read -r up _ </proc/uptime; echo $(( 10#${up/./} * 10 )); }

# label -> environment for `quod vitest` (plain and norec are special)
declare -A V=(
  [plain]=- [norec]=- [rec]=
  [rec-norender]=QUOD_VITEST_DISABLE=render
  [rec-nocov]=QUOD_VITEST_DISABLE=cov
  [rec-notake]=QUOD_VITEST_DISABLE=take
  [rec-nofs]=QUOD_VITEST_DISABLE=fs
  [rec-noenv]=QUOD_VITEST_DISABLE=env
  [rec-noloader]=QUOD_VITEST_DISABLE=loader,escapes
  [rec-nomain]=QUOD_VITEST_DISABLE=main
  [rec-nopreload]=QUOD_VITEST_DISABLE=preload
  [rec-bare]=QUOD_VITEST_DISABLE=fs,env,loader,escapes,main,cov,preload,render
  [rec-nosetup]=QUOD_VITEST_DISABLE=setup,main,render
  [rec-tick]=QUOD_VITEST_COV_TICK=100
)
# PROFILE_EXTRA="label=K=V,K2=V2;label2=..." adds variants
IFS=';' read -ra extra <<<"${PROFILE_EXTRA:-}"
for e in "${extra[@]}"; do [ -n "$e" ] && V[${e%%=*}]=${e#*=}; done
full_variants=(${PROFILE_FULL:-plain norec rec rec-norender rec-nocov rec-notake rec-nofs rec-noenv rec-noloader rec-nomain rec-nopreload rec-bare rec-nosetup rec-tick})
typ_variants=(${PROFILE_TYP:-plain norec rec rec-norender rec-nocov rec-notake rec-tick})

one() { # kind round label dir
  local kind=$1 r=$2 label=$3 dir=$4 spec=${V[$3]}
  rm -f "$out/s.json"
  local s; s=$(ms)
  if [ "$label" = plain ]; then
    node_modules/.bin/vitest "${args[@]}" >"$out/logs/$kind-$label-$r.log" 2>&1
  elif [ "$label" = norec ]; then
    "$QUOD" vitest --no-record --dir "$dir" --summary "$out/s.json" -- "${args[@]}" >"$out/logs/$kind-$label-$r.log" 2>&1
  else
    local envs=(); IFS=',' read -ra envs <<<"$spec"
    env "${envs[@]}" "$QUOD" vitest --audits auto --dir "$dir" --summary "$out/s.json" -- "${args[@]}" >"$out/logs/$kind-$label-$r.log" 2>&1
  fi
  local rc=$? d=$(( $(ms) - s ))
  node -e '
    const [kind, round, label, ms, rc, p] = process.argv.slice(1)
    let s = {}; try { s = JSON.parse(require("fs").readFileSync(p, "utf8")) } catch {}
    console.log(JSON.stringify({ kind, round: +round, label, ms: +ms, exit: +rc, ran: s.ran, replayed: s.replayed,
      select_ms: s.select_ms, vitest_ms: s.vitest_ms, record_ms: s.record_ms, phases: s.phases, render: s.render?.ms, driver: s.driver }))
  ' "$kind" "$r" "$label" "$d" "$rc" "$out/s.json" | tee -a "$out/results.jsonl" | cut -c1-200
}

series() { # kind base-ledger-dir-or-empty variants...
  local kind=$1 base=$2; shift 2
  local vs=("$@") n=$#
  for ((r = 0; r < rounds; r++)); do
    for ((j = 0; j < n; j++)); do
      local label=${vs[$(( (j + r * 5) % n ))]}
      local dir=$work/run; rm -rf "$dir"; mkdir -p "$dir"
      [ -n "$base" ] && cp -a "$base/." "$dir/"
      one "$kind" "$r" "$label" "$dir"
    done
  done
}

sha=$(git rev-parse HEAD)
echo "::group::full at ${sha:0:9}"
series full "" "${full_variants[@]}"
echo "::endgroup::"

if [ "${PROFILE_TYPICAL:-1}" = 1 ]; then
  echo "::group::typical (${sha:0:9} on its parent's ledger)"
  git checkout -q HEAD~1
  [ "$(git diff HEAD "$sha" --name-only -- pnpm-lock.yaml)" ] && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1
  base=$work/base; rm -rf "$base"; mkdir -p "$base"
  "$QUOD" vitest --dir "$base" -- "${args[@]}" >"$out/logs/typical-base.log" 2>&1
  git checkout -q "$sha"
  [ "$(git diff HEAD~1 HEAD --name-only -- pnpm-lock.yaml)" ] && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1
  series typical "$base" "${typ_variants[@]}"
  echo "::endgroup::"
fi

if [ "${PROFILE_CPU:-0}" = 1 ]; then
  echo "::group::cpu profiles (full, rec vs norec)"
  for m in norec rec; do
    d=$work/cpu-$m; rm -rf "$d"; mkdir -p "$d" "$out/prof-$m"
    f=(); [ $m = norec ] && f=(--no-record)
    NODE_OPTIONS="--cpu-prof --cpu-prof-dir=$out/prof-$m" "$QUOD" vitest "${f[@]}" --dir "$d" -- "${args[@]}" >/dev/null 2>&1
    echo "== $m"; node "$here/cpuprof-summary.mjs" "$out/prof-$m" 14 | tail -60
  done
  echo "::endgroup::"
fi

node "$here/report-profile.mjs" "$out/results.jsonl" "$(git remote get-url origin)" "${sha}" > "$out/report.md"
cat "$out/report.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$out/report.md" >> "$GITHUB_STEP_SUMMARY"
exit 0
