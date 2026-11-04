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
const bins = [...new Set(rows.map((r) => r.quod_bin).filter(Boolean))]
const x = (v) => (v == null ? '-' : `${Number(v).toFixed(2)}x`)
const o = []
o.push(`# Drop-in compatibility scoreboard`)
o.push('')
o.push(`Quod ${bins.join(', ') || '(unknown)'} through quod-action, the test job recording inline (no shadow job; a record replays once a second run agrees, QUOD_VITEST_WITNESSES=2). ${pass} of ${rows.length} repositories work with the action line alone. Ratios are Quod / plain: below 1.00 is better. CI cost includes an **estimated** 15 s fixed overhead per job (runner, checkout, cache); everything else is measured on this run. Files replayed counts only commits after the first; the first replay can come no earlier than the third run of a file (record, second witness, replay).`)
o.push('')
o.push('| repo | shape | zero edits | engaged | files replayed (witness) | first replay | CI fast | CI cost | wrong replays | why / decline reason | notes |')
o.push('|---|---|---|---|---:|---:|---:|---:|---:|---|---|')
for (const r of rows) o.push(`| ${r.repo ?? r.id} | ${(r.shape ?? '').replace(/\|/g, '/')} | ${r.works_zero_edits} | ${r.engaged ?? '-'}${r.invocations != null ? ` (${r.intercepted}/${r.invocations})` : ''} | ${r.files_replayed_pct ?? '-'}%${r.files_total ? ` (${r.files_replayed}/${r.files_total})` : ''} | ${r.first_replay_commit ?? '-'} | ${x(r.ci_fast_x)} | ${x(r.ci_cost_x)} | ${r.wrong_replays ?? '-'} | ${[r.why, r.decline_reason].filter(Boolean).join(' — ').replace(/\|/g, '/').slice(0, 300)} | ${r.commits ?? '-'} commits; vitest cmds/commit ${r.invocations_per_commit ?? '-'}; recorded ${r.recorded_files_max ?? '-'}; ${r.quod_bin ?? ''} |`)
fs.writeFileSync(path.join(outDir, 'scoreboard.json'), JSON.stringify({ pass, total: rows.length, rows }, null, 1))
fs.writeFileSync(path.join(outDir, 'scoreboard.md'), o.join('\n') + '\n')
console.log(o.join('\n'))
