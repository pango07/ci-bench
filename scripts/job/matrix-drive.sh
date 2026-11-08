#!/usr/bin/env bash
# Fresh original48 jobs. Only managed/control chains are sequentially warmed by
# their own preceding cold job; there are no seed jobs, repeats or execution retries.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
[[ "${1:-convex-helpers}" = convex-helpers && "${2:-12}" = 12 && "${3:-floor,plain,managed-control,managed}" = floor,plain,managed-control,managed &&
   "${BJ_REPEAT_FIRST:-false}" = false && "${BJ_CLOUD:-false}" = false ]] || { echo 'exact original12 x4 cold scope required' >&2; exit 1; }
R=${GITHUB_REPOSITORY:?}; out=${BJ_OUT:-$RUNNER_TEMP/bj}
mkdir -p "$out/runs" "$out/raw" "$out/src"
node --test "$here/matrix-evidence.test.cjs" "$here/property47-window-profile.test.cjs" "$here/evidence.test.cjs" "$here/select-job.test.cjs" || exit 1
pins=$(node - "$here/../../.github/workflows/bench-job-one.yml" <<'JS'
const fs=require('node:fs'),assert=require('node:assert/strict'),text=fs.readFileSync(process.argv[2],'utf8')
const action=/uses: pango07\/quod-action@([a-f0-9]{40}) # MATRIX_ACTION_SHA/.exec(text)?.[1]
const source=/MATRIX_RUNTIME_SOURCE: '([a-f0-9]{40})' # MATRIX_SOURCE_SHA/.exec(text)?.[1]
const actionInput=/MATRIX_ACTION_SHA: '([a-f0-9]{40})'/.exec(text)?.[1]
const profile=/MATRIX_CANDIDATE_PROFILE: '([a-z0-9-]+)'/.exec(text)?.[1]
assert.equal(profile,'reviewed-original-property47-single-instance-v1-research','explicit property47 workflow profile required')
assert(text.includes("'matrix-property47-control' || 'matrix-property47'"),'property47 Action mode pair required')
assert(action&&source&&!/^0+$/.test(action)&&!/^0+$/.test(source),'approved remotely built Action/runtime full pins required before any dispatch')
assert.equal(actionInput,action,'evidence Action pin differs from actual workflow uses pin')
console.log(action+' '+source+' '+profile)
JS
) || exit 1
read -r action_sha source_sha candidate_profile <<< "$pins"
gh api "repos/pango07/quod-action/contents/dist/managed/manifest.json?ref=$action_sha" > "$out/action-manifest-api.json" || exit 1
jq -r .content "$out/action-manifest-api.json" | tr -d '\n' | base64 --decode > "$out/action-manifest.json" || exit 1
archive_sha=$(node - "$out/action-manifest.json" "$source_sha" <<'JS'
const fs=require('node:fs'),assert=require('node:assert/strict'),m=JSON.parse(fs.readFileSync(process.argv[2]))
assert(m.schema==='quod-managed-action-runtime-v1'&&m.source.repository==='pango07/quod'&&m.source.commit===process.argv[3]&&/^[a-f0-9]{64}$/.test(m.sha256),'shipped Action/runtime source mismatch')
console.log(m.sha256)
JS
) || exit 1
cp "$here/managed-window.json" "$out/managed-window.json"
cfg=$(node - "$here/../dropin/corpus.json" "$here/managed-window.json" <<'JS'
const fs=require('node:fs'),assert=require('node:assert/strict'),e=JSON.parse(fs.readFileSync(process.argv[2])).find(x=>x.id==='convex-helpers'),m=JSON.parse(fs.readFileSync(process.argv[3]))
assert(e.repo===m.repository&&e.sha===m.commits.at(-1).sha&&e.install===m.commands.install&&e.build===m.commands.build&&e.test===m.commands.test)
assert(e.node_file==='.nvmrc'&&!e.env&&!e.workdir&&!e.pnpm&&!e.bun&&!e.corepack&&!e.corepack_first)
console.log(JSON.stringify({node_file:e.node_file,install:e.install,build:e.build,test:e.test,workdir:'.',env:''}))
JS
) || exit 1
end=${BJ_END:-5eaa7e5160736054d53f8b71e2c522835eb427e0}
git clone -q --filter=blob:none --no-checkout https://github.com/get-convex/convex-helpers "$out/src/convex-helpers" || exit 1
git -C "$out/src/convex-helpers" rev-list --first-parent -n 12 "$end" | tac > "$out/original-commits.txt"
node "$here/managed-evidence.cjs" verify-window "$here/managed-window.json" "$out/original-commits.txt" || exit 1
rm -rf "$out/src/convex-helpers"
jq -n --arg run "$GITHUB_RUN_ID" --arg harness "$GITHUB_SHA" --arg action "$action_sha" --arg source "$source_sha" --arg archive "$archive_sha" --arg profile "$candidate_profile" \
  '{schema:"quod-matrix-original-window-settings-v1",coordinatorRun:$run,harnessSha:$harness,actionSha:$action,sourceSha:$source,runtimeArchiveSha256:$archive,candidateProfile:$profile,cold:true,repeatFirst:false,experimentalCloud:false,commands:{install:"npm ci",build:"npm run build",test:"npm run test"},namespace:"property47-<run>-convex-helpers-<variant>"}' > "$out/settings.json"
: > "$out/expected.jsonl"; : > "$out/branches"
i=0
while read -r commit; do
  for variant in floor plain managed-control managed; do
    jq -cn --arg v "$variant" --argjson i "$i" --arg c "$commit" '{id:"convex-helpers",variant:$v,i:$i,commit:$c}' >> "$out/expected.jsonl"
  done
  i=$((i+1))
done < "$out/original-commits.txt"
wait_run() {
  local tag=$1 branch=$2 matches='' run='' status=''
  for _ in $(seq 1 60); do
    sleep 10
    matches=$(gh run list -R "$R" --workflow bench-job-one.yml --branch "$branch" --event workflow_dispatch --limit 100 --json databaseId,displayTitle \
      --jq "[.[]|select(.displayTitle==\"bench-job-one $tag\")]") || continue
    [[ $(jq length <<< "$matches") = 1 ]] && { run=$(jq -r '.[0].databaseId' <<< "$matches"); break; }
    [[ $(jq length <<< "$matches") = 0 ]] || { echo "duplicate execution tag $tag" >&2; return 1; }
  done
  [[ "$run" =~ ^[0-9]+$ ]] || return 1
  while :; do
    status=$(gh run view "$run" -R "$R" --json status --jq .status 2>/dev/null)
    [[ "$status" = completed ]] && break
    sleep 30
  done
  echo "$run"
}
chain() {
  local variant=$1 branch="bench/property47-wj-$GITHUB_RUN_ID-convex-helpers-$1" namespace='' i commit tag rid
  local -a pending=()
  gh api -X POST "repos/$R/git/refs" -f ref="refs/heads/$branch" -f sha="$GITHUB_SHA" > "$out/runs/$variant-branch-api.json" || return 1
  echo "$branch" >> "$out/branches"
  [[ "$variant" = managed || "$variant" = managed-control ]] && namespace="property47-$GITHUB_RUN_ID-convex-helpers-$variant"
  mapfile -t commits < "$out/original-commits.txt"
  for i in "${!commits[@]}"; do
    commit=${commits[$i]}; tag="$GITHUB_RUN_ID-convex-helpers-$variant-$i"
    gh workflow run bench-job-one.yml -R "$R" --ref "$branch" -f tag="$tag" -f repo=get-convex/convex-helpers -f commit="$commit" \
      -f variant="$variant" -f cfg="$cfg" -f cloud=false -f cache_namespace="$namespace" || return 1
    if [[ "$variant" = floor || "$variant" = plain ]]; then pending+=("$i"); continue; fi
    rid=$(wait_run "$tag" "$branch") || return 1
    jq -cn --arg v "$variant" --argjson i "$i" --arg c "$commit" --argjson r "$rid" --arg b "$branch" --arg n "$namespace" \
      '{id:"convex-helpers",variant:$v,i:$i,commit:$c,run:$r,branch:$b,cacheNamespace:$n}' >> "$out/runs/$variant.jsonl"
  done
  for i in "${pending[@]}"; do
    commit=${commits[$i]}; tag="$GITHUB_RUN_ID-convex-helpers-$variant-$i"
    rid=$(wait_run "$tag" "$branch") || return 1
    jq -cn --arg v "$variant" --argjson i "$i" --arg c "$commit" --argjson r "$rid" --arg b "$branch" \
      '{id:"convex-helpers",variant:$v,i:$i,commit:$c,run:$r,branch:$b,cacheNamespace:""}' >> "$out/runs/$variant.jsonl"
  done
}
pids=(); for variant in floor plain managed-control managed; do chain "$variant" & pids+=("$!"); done
chain_failure=0; for pid in "${pids[@]}"; do wait "$pid" || chain_failure=1; done
: > "$out/jobs.jsonl"
branch_sets=()
for variant in floor plain managed-control managed; do
  branch="bench/property47-wj-$GITHUB_RUN_ID-convex-helpers-$variant"
  file="$out/raw/$variant-observed-runs.json"
  gh api -X GET "repos/$R/actions/workflows/bench-job-one.yml/runs" -f branch="$branch" -f event=workflow_dispatch -F per_page=100 > "$file" || printf '{}' > "$file"
  branch_sets+=("$file")
done
jq -s --arg run "$GITHUB_RUN_ID" '[to_entries[]|{branch:("bench/property47-wj-"+$run+"-convex-helpers-"+(["floor","plain","managed-control","managed"][.key])),total_count:.value.total_count,workflow_runs:.value.workflow_runs}]' "${branch_sets[@]}" > "$out/observed-runs.json"
while read -r row; do
  rid=$(jq -r .run <<< "$row"); raw="$out/raw/$rid"; mkdir -p "$raw"
  gh api "repos/$R/actions/runs/$rid" > "$raw/run.json" || continue
  gh api "repos/$R/actions/runs/$rid/jobs?per_page=100" > "$raw/jobs.json" || continue
  gh api "repos/$R/actions/runs/$rid/artifacts?per_page=100" > "$raw/artifacts.json" || continue
  selected=$(node "$here/select-job.cjs" < "$raw/jobs.json") || continue
  jid=$(jq -r '.jobs[0].id' <<< "$selected")
  curl -fsSL --retry 4 --retry-all-errors --retry-delay 1 -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$R/actions/jobs/$jid/logs" -o "$raw/job.log" || : > "$raw/job.log"
  evidence=$(node "$here/matrix-evidence.cjs" log "$raw/job.log") || evidence='{"invalid":true}'
  image=$(sed 's/^[0-9TZ:.-]* //' "$raw/job.log" | awk '/^Image: /{i=$2;getline;if($1=="Version:"){print i "/" $2;exit}}')
  jq -c --argjson api "$(cat "$raw/run.json")" --argjson jobs "$selected" --argjson matrix "$evidence" --arg image "$image" \
    '.+{run_meta:$api,job:$jobs.jobs[0],matrix:$matrix,image:$image}' <<< "$row" >> "$out/jobs.jsonl"
done < <(cat "$out"/runs/*.jsonl 2>/dev/null)
while read -r branch; do gh api -X DELETE "repos/$R/git/refs/heads/$branch" >/dev/null || true; done < "$out/branches"
status=0; node "$here/matrix-report.mjs" "$out/jobs.jsonl" "$out" || status=$?
[[ "$chain_failure" = 0 ]] || status=1
[[ -z "${GITHUB_STEP_SUMMARY:-}" || ! -f "$out/report.md" ]] || cat "$out/report.md" >> "$GITHUB_STEP_SUMMARY"
exit "$status"
