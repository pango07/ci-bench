// The drop-in scoreboard over every repository's row.json.
//   node scoreboard.mjs <dir with dropin-*/row.json> <out dir>
import fs from 'node:fs'
import path from 'node:path'
const [dir, outDir] = process.argv.slice(2)
const rows = []
for (const d of fs.readdirSync(dir)) {
  const p = path.join(dir, d, 'row.json')
  if (fs.existsSync(p)) rows.push(JSON.parse(fs.readFileSync(p, 'utf8')))
  else rows.push({ id: d.replace(/^dropin-/, ''), works_zero_edits: 'no', why: 'the bench job produced no result (see its log)' })
}
rows.sort((a, b) => String(a.id).localeCompare(String(b.id)))
const pass = rows.filter((r) => r.works_zero_edits === 'yes').length
const x = (v) => (v == null ? '-' : `${Number(v).toFixed(2)}x`)
const o = []
o.push(`# Drop-in compatibility scoreboard`)
o.push('')
o.push(`${pass} of ${rows.length} repositories work with the action line alone in the test job (measured; the shadow job's own inputs are a separate column). Ratios are Quod / plain: below 1.00 is better. CI cost includes an **estimated** 15 s fixed overhead per job (runner, checkout, cache); everything else is measured on this run.`)
o.push('')
o.push('| repo | shape | zero edits (test job) | why | shadow job needs | files replayed | CI fast | CI cost | wrong replays | notes |')
o.push('|---|---|---|---|---|---:|---:|---:|---:|---|')
for (const r of rows) o.push(`| ${r.repo ?? r.id} | ${r.shape ?? ''} | ${r.works_zero_edits} | ${(r.why ?? '').replace(/\|/g, '/')} | ${(r.shadow_job_needs ?? '').replace(/\|/g, '/')} | ${r.files_replayed_pct ?? '-'}% | ${x(r.ci_fast_x)} | ${x(r.ci_cost_x)} | ${r.wrong_replays ?? '-'} | ${r.commits ?? '-'} commits; vitest cmds/commit ${r.invocations_per_commit ?? '-'}; recorded ${r.recorded_files_max ?? '-'}; Quod: ${(r.quod_check_log_sample ?? '').slice(0, 120).replace(/\|/g, '/')} |`)
fs.writeFileSync(path.join(outDir, 'scoreboard.json'), JSON.stringify({ pass, total: rows.length, rows }, null, 1))
fs.writeFileSync(path.join(outDir, 'scoreboard.md'), o.join('\n') + '\n')
console.log(o.join('\n'))
