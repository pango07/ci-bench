// One repository's drop-in result: the per-commit table (markdown, stdout)
// and its scoreboard row (<out>/row.json). ci-metrics.mjs has already added
// the ci_* fields and written <out>/metrics.json.
//
//   node report.mjs results.jsonl <out dir>      (env DROPIN_META: the corpus entry)
import fs from 'node:fs'
import path from 'node:path'

const [file, outDir] = process.argv.slice(2)
const meta = JSON.parse(process.env.DROPIN_META || '{}')
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
let metrics = {}
try {
  metrics = JSON.parse(fs.readFileSync(path.join(outDir, 'metrics.json'), 'utf8'))
} catch {}
const timed = rows.filter((r) => !r.first)
const sum = (a) => a.reduce((x, y) => x + y, 0)
const s = (ms) => (ms / 1000).toFixed(1)

const invocations = sum(timed.map((r) => r.invocations))
const intercepted = sum(timed.map((r) => r.intercepted))
const files = sum(timed.map((r) => r.files))
const replayed = sum(timed.map((r) => r.replayed))
const wrong = rows.reduce((n, r) => n + (r.wrong === null ? 1 : r.wrong.length), 0)
// An exit difference explained by a test that ran (not replayed) and flaked is plain vitest's flakiness, not Quod's.
const exitMismatch = rows.filter((r) => r.plain_exit !== (r.quod_exit ?? r.crit_exit) && !(r.flaky?.length && !r.wrong?.length)).map((r) => r.i)
const flakyCommits = rows.filter((r) => r.flaky?.length).map((r) => r.i)
const recordedMax = Math.max(0, ...rows.map((r) => r.recorded))
const declined = [...new Set(rows.flatMap((r) => r.declined))]
const missing = [...new Set(rows.flatMap((r) => r.missing))]
const setupFail = rows.filter((r) => r.install_rc || r.build_rc).map((r) => r.i)
const plainFail = rows.filter((r) => r.plain_exit).map((r) => r.i)

// Zero edits works = Quod engaged on every vitest command line of the test
// step, never changed the step's outcome, recorded inline, and replayed
// something over the window (witness mode: a record replays only once a
// second run agreed with it).
const why = []
if (!invocations) why.push('no vitest command line observed through the node shim (the shim is bypassed, or vitest is not started as a node process)')
else if (!intercepted) why.push(`Quod declined every vitest command line (${declined.length} kinds)`)
else if (intercepted < invocations) why.push(`Quod declined ${invocations - intercepted} of ${invocations} vitest invocations`)
if (exitMismatch.length) why.push(`Quod's exit code differs from plain on commits ${exitMismatch.join(',')}`)
if (intercepted && !recordedMax) why.push('nothing was recorded')
if (intercepted && recordedMax && !replayed) why.push('recorded, but nothing ever replayed')
if (missing.length) why.push(`missing reports: ${missing.slice(0, 3).join('; ')}`)
if (wrong) why.push(`${wrong} wrong replays`)
const works = why.length === 0
// Why Quod declined (ran plain vitest) or replayed nothing, in its own words:
// the quod lines of the Quod runs that say so; else the declined command
// lines' arguments (the hook passed them to plain vitest without a word).
const said = new Map()
for (const r of timed) for (const l of String(r.quod_check_log || '').split('|')) {
  const m = l.match(/^(\d+) (.*)$/)
  if (m && /not supported|plain vitest|declin|cannot|every (test )?file runs|runs every file|shared input changed|no record/i.test(m[2])) said.set(m[2], (said.get(m[2]) ?? 0) + +m[1])
}
const declinedArgs = [...new Set(rows.flatMap((r) => (r.per_key ?? []).filter((k) => (r.declined ?? []).includes(k.key)).map((k) => JSON.stringify(k.args ?? []))))]
const declineReason = !invocations
  ? 'the shim never saw vitest'
  : intercepted < invocations || !replayed
    ? [...said].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([l, n]) => `${l} (x${n})`).join('; ') || (declinedArgs.length ? `declined without a quod line; args ${declinedArgs.join(' ')}` : '')
    : ''
const t = metrics.totals ?? {}
const firstReplay = rows.find((r) => r.replayed > 0)?.i ?? null
const row = {
  id: meta.id,
  repo: meta.repo,
  sha: meta.sha,
  shape: meta.shape,
  quod_bin: process.env.DROPIN_QUOD_BIN ?? '',
  mode: rows[0]?.mode ?? '',
  works_zero_edits: works ? 'yes' : 'no',
  engaged: !invocations ? 'no' : intercepted === invocations ? 'yes' : intercepted ? 'partly' : 'no',
  why: works ? 'engaged on every vitest invocation, recorded inline, replayed after the second witness' : why.join('; '),
  decline_reason: declineReason,
  commits: timed.length,
  files_replayed_pct: files ? +((100 * replayed) / files).toFixed(1) : 0,
  files_replayed: replayed,
  files_total: files,
  first_replay_commit: firstReplay,
  ci_fast_x: t.fast_x ?? null,
  ci_cost_x: t.cost_x ?? null,
  ci_fast_x_median: t.fast_x_median ?? null,
  ci_cost_x_measured_only: t.cost_x_measured_only ?? null,
  wrong_replays: wrong,
  flaky_commits: flakyCommits,
  invocations_per_commit: timed.length ? +(invocations / timed.length).toFixed(1) : 0,
  intercepted,
  invocations,
  recorded_files_max: recordedMax,
  plain_test_s_total: +s(sum(timed.map((r) => r.plain_ms))),
  quod_test_s_total: +s(sum(timed.map((r) => r.quod_ms ?? r.crit_ms))),
  setup_s_total: +s(sum(timed.map((r) => r.install_ms))),
  plain_failing_commits: plainFail,
  setup_failing_commits: setupFail,
  quod_log_sample: rows.find((r) => !r.first)?.quod_check_log ?? '',
  pull_request_check: (() => { try { return fs.readFileSync(path.join(outDir, 'pr.txt'), 'utf8').trim() } catch { return '' } })(),
  run: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '',
}
fs.writeFileSync(path.join(outDir, 'row.json'), JSON.stringify(row, null, 1))

const o = []
o.push(`## ${meta.repo} (${meta.id})`)
o.push('')
o.push(`${meta.shape}. Test step: \`${meta.test}\`${meta.build ? `, after \`${meta.build}\`` : ''}. Window ends at \`${(meta.sha || '').slice(0, 9)}\`.`)
o.push('')
o.push(`**Zero edits: ${row.works_zero_edits}** (${row.why}). Quod ${row.quod_bin || '?'} (${row.mode}). Files replayed ${row.files_replayed_pct}% (first replay at commit ${firstReplay ?? '-'}), CI fast ${row.ci_fast_x ?? '-'}x, CI cost ${row.ci_cost_x ?? '-'}x, wrong replays ${wrong}.${declineReason ? ` Declined / no replay: ${declineReason}.` : ''}`)
o.push('')
o.push('| # | commit | setup | plain | Quod | exit p/q | vitest cmds (Quod) | files | ran | replayed | recorded | wrong | flaky | Quod says |')
o.push('|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---|')
for (const r of rows) {
  o.push(`| ${r.i}${r.first ? ' (first)' : ''} | \`${r.commit.slice(0, 9)}\` ${String(r.subject).slice(0, 40).replace(/\|/g, '/')} | ${s(r.install_ms)} s | ${s(r.plain_ms)} s | ${s(r.quod_ms ?? r.crit_ms)} s | ${r.plain_exit}/${r.quod_exit ?? r.crit_exit} | ${r.invocations} (${r.intercepted}) | ${r.files} | ${r.ran} | ${r.replayed} | ${r.recorded} | ${r.wrong === null ? 'ERR' : r.wrong.length} | ${r.flaky?.length ?? '-'} | ${String(r.quod_check_log || '').slice(0, 160).replace(/\|/g, ' / ')} |`)
}
o.push('')
for (const r of rows) for (const w of r.wrong_detail ?? []) o.push(`- WRONG at ${r.i}: ${w.file} plain=${w.plain} check=${w.check} -${JSON.stringify(w.minus)} +${JSON.stringify(w.plus)}`)
if (row.pull_request_check) o.push(`\n${row.pull_request_check}`)
console.log(o.join('\n'))
