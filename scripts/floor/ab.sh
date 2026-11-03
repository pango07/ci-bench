#!/usr/bin/env bash
# Same-runner A/B for the floor's typecheck (no caches, no turbo): per
# package, full `tsc --noEmit` against `tsc --incremental` from the base
# commit's .tsbuildinfo, on the base plus one commit ($1: source |
# typeerror | lock (types only: the installed packages stay the base's)),
# alternating, $2 rounds; then all three packages serially against in
# parallel (full). Prints ms; monotonic clock.
#   ab.sh <case> <rounds> <scale>     (from the ci-bench checkout; needs node)
set -uo pipefail
case_=$1; rounds=${2:-2}; scale=${3:-4}
root=$PWD; fx=$root/fx-ab
ms() { local up _; read -r up _ </proc/uptime; echo $(( 10#${up/./} * 10 )); }
pk=(packages/shared packages/backend apps/web)
rm -rf "$fx"; node scripts/floor/gen.mjs "$fx" --scale "$scale" --incremental >/dev/null
(cd "$fx" && npm ci --no-audit --no-fund --loglevel=error >/dev/null)
tsc=$fx/node_modules/.bin/tsc
# the base commit's tsbuildinfo
for p in "${pk[@]}"; do (cd "$fx/$p" && "$tsc" --noEmit --incremental --tsBuildInfoFile .tsbuildinfo -p . >/dev/null; cp .tsbuildinfo /tmp/ab-$(basename $p).tsbuildinfo); done
node scripts/floor/gen.mjs "$fx" --scale "$scale" --incremental --variant "$case_" >/dev/null
[ "$case_" = lock ] && cp scripts/floor/locks/base.json "$fx/package-lock.json"
echo "case $case_, scale $scale, $(nproc) CPUs"
for r in $(seq 1 "$rounds"); do
  for p in "${pk[@]}"; do
    n=$(basename $p)
    for mode in full inc; do
      cd "$fx/$p"
      if [ $mode = inc ]; then cp /tmp/ab-$n.tsbuildinfo .tsbuildinfo; a=(--incremental --tsBuildInfoFile .tsbuildinfo); else rm -f .tsbuildinfo; a=(); fi
      s=$(ms); "$tsc" --noEmit "${a[@]}" -p . >/tmp/ab.out 2>&1; rc=$?; e=$(( $(ms) - s ))
      echo "round $r $n $mode ${e} ms rc=$rc errors=$(grep -c 'error TS' /tmp/ab.out)"
    done
  done
  cd "$fx"
  s=$(ms); for p in "${pk[@]}"; do (cd $p && "$tsc" --noEmit -p . >/dev/null 2>&1); done; e=$(( $(ms) - s )); echo "round $r all serial-full ${e} ms"
  s=$(ms); for p in "${pk[@]}"; do (cd $p && "$tsc" --noEmit -p . >/dev/null 2>&1) & done; wait; e=$(( $(ms) - s )); echo "round $r all parallel-full ${e} ms"
  s=$(ms); for p in "${pk[@]}"; do (cd $p && cp /tmp/ab-$(basename $p).tsbuildinfo .tsbuildinfo && "$tsc" --noEmit --incremental --tsBuildInfoFile .tsbuildinfo -p . >/dev/null 2>&1) & done; wait; e=$(( $(ms) - s )); echo "round $r all parallel-inc ${e} ms"
  cd "$root"
done
