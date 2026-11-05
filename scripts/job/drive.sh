#!/usr/bin/env bash
# The bench-job driver (bench-job.yml): per (project, variant) a chain of
# real jobs, one per commit, oldest first, each waited for before the next
# (so commit i+1's job restores what commit i's saved, as in production).
# Chains run concurrently. Timings come from the jobs API afterwards
# (report.mjs), never from in-job timers.
#
#   drive.sh <ids> <commits> <variants>     (env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA, GITHUB_REF_NAME)
#
# Each quod chain runs on its own branch of this repository
# (bench/wj-<run>-<id>, at this run's commit): the action's ledger and
# Quod Cloud's are scoped by branch, so projects do not read each other's
# and every chain starts with none. The branches are deleted at the end.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
ids=${1:?ids}; commits=${2:-6}; variants=${3:-plain,quod-shipped}
R=$GITHUB_REPOSITORY
out=${BJ_OUT:-$RUNNER_TEMP/bj}; mkdir -p "$out/runs" "$out/src"
corpus=$here/../dropin/corpus.json
IFS=, read -ra IDS <<<"$ids"; IFS=, read -ra VARS <<<"$variants"

cfg() { # the corpus entry's set-up flags and commands, as bench-job-one's `cfg`
  node -e '
    const e = require(process.argv[1]).find((x) => x.id === process.argv[2])
    if (!e) { console.error("no corpus entry " + process.argv[2]); process.exit(1) }
    // TURBO_FORCE is the in-place bench'"'"'s (one checkout, many runs); a fresh job has no local turbo cache.
    const env = (e.env ?? "").split(/\s+/).filter((kv) => kv && !kv.startsWith("TURBO_FORCE=")).join(" ")
    const c = { pnpm: !!e.pnpm, bun: !!e.bun, corepack: !!e.corepack, corepack_first: !!e.corepack_first, node: e.node ?? "", node_file: e.node_file ?? "", bun_file: e.bun_file ?? "",
      install: e.install, build: e.build ?? "", test: e.test, workdir: e.workdir ?? ".", env }
    console.log(JSON.stringify(c))' "$corpus" "$1"
}
meta() { node -e 'const e=require(process.argv[1]).find(x=>x.id===process.argv[2]);console.log(e[process.argv[3]])' "$corpus" "$1" "$2"; }

wait_run() { # tag branch -> run id once it completes
  local tag=$1 br=$2 id='' st
  for _ in $(seq 1 60); do
    sleep 10
    id=$(gh run list -R "$R" --workflow bench-job-one.yml --branch "$br" --event workflow_dispatch --limit 50 \
      --json databaseId,displayTitle --jq "[.[] | select(.displayTitle == \"bench-job-one $tag\")][0].databaseId // empty" 2>/dev/null)
    [ -n "$id" ] && break
  done
  [ -n "$id" ] || return 1
  # 60 s polls: eight chains stay well inside GITHUB_TOKEN's 1000 requests an hour.
  while :; do
    st=$(gh run view "$id" -R "$R" --json status --jq .status 2>/dev/null)
    [ "$st" = completed ] && break
    sleep 60
  done
  echo "$id"
}

chain() { # id variant
  local id=$1 v=$2 repo sha c br i tag rid
  repo=$(meta "$id" repo); c=$(cfg "$id") || return 1
  mapfile -t cs < "$out/src/$id.commits"
  br=$GITHUB_REF_NAME
  if [ "$v" != plain ]; then
    br=bench/wj-$GITHUB_RUN_ID-$id-$v
    gh api -X POST "repos/$R/git/refs" -f ref="refs/heads/$br" -f sha="$GITHUB_SHA" >/dev/null || { echo "::error::cannot create $br"; return 1; }
    echo "$br" >> "$out/branches"
  fi
  for i in "${!cs[@]}"; do
    sha=${cs[$i]}; tag="$GITHUB_RUN_ID-$id-$v-$i"
    gh workflow run bench-job-one.yml -R "$R" --ref "$br" -f tag="$tag" -f repo="$repo" -f commit="$sha" -f variant="$v" -f cfg="$c" \
      || { echo "::warning::$tag: dispatch failed"; continue; }
    rid=$(wait_run "$tag" "$br") || { echo "::warning::$tag: no run appeared"; continue; }
    echo "$id $v $i ${sha:0:9}: run $rid"
    printf '{"id":"%s","variant":"%s","i":%d,"commit":"%s","run":%s}\n' "$id" "$v" "$i" "$sha" "$rid" >> "$out/runs/$id-$v.jsonl"
  done
}

for id in "${IDS[@]}"; do
  repo=$(meta "$id" repo); end=$(meta "$id" sha)
  git clone -q --filter=blob:none --no-checkout "https://github.com/$repo" "$out/src/$id"
  git -C "$out/src/$id" rev-list --first-parent -n "$commits" "$end" | tac > "$out/src/$id.commits"
  echo "$id: $(wc -l < "$out/src/$id.commits") commits ending at ${end:0:9}"
  rm -rf "$out/src/$id"
done
for id in "${IDS[@]}"; do for v in "${VARS[@]}"; do chain "$id" "$v" & done; done
wait

# Timings and Quod's own lines, per job, from the API.
: > "$out/jobs.jsonl"
cat "$out"/runs/*.jsonl 2>/dev/null | while read -r row; do
  rid=$(jq -r .run <<<"$row")
  jobs=$(gh api "repos/$R/actions/runs/$rid/jobs")
  run=$(gh api "repos/$R/actions/runs/$rid" --jq '{run_started_at, created_at, conclusion}')
  jid=$(jq -r '.jobs[0].id' <<<"$jobs")
  quod=$(gh api "repos/$R/actions/jobs/$jid/logs" 2>/dev/null | sed 's/^[0-9TZ:.-]* //' | grep -E '^(quod( vitest)?|Quod)[ :]' | grep -vE '(GITHUB|RUNNER|ACTIONS)_[A-Z_]* keyed for every' | head -40 | jq -Rs .)
  jq -c --argjson jobs "$jobs" --argjson run "$run" --argjson quod "${quod:-\"\"}" '. + {run_meta: $run, job: ($jobs.jobs[0] | {id, created_at, started_at, completed_at, conclusion, steps: [.steps[] | {name, conclusion, started_at, completed_at}]}), quod: $quod}' <<<"$row" >> "$out/jobs.jsonl"
done
[ -f "$out/branches" ] && while read -r br; do gh api -X DELETE "repos/$R/git/refs/heads/$br" >/dev/null || true; done < "$out/branches"
node "$here/report.mjs" "$out/jobs.jsonl" "$out" | tee "$out/report.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$out/report.md" >> "$GITHUB_STEP_SUMMARY"
exit 0
