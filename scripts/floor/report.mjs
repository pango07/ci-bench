// report.mjs <rows dir> <jobs.json>: the floor table. CI fast = the job's
// critical path to the typecheck verdict (monotonic, from its first step);
// CI cost = the job's runner seconds (GitHub's started/completed, which
// include runner setup, every step and the post steps: cache saves too).
import fs from 'node:fs'
import path from 'node:path'
const [dir, jobsFile] = process.argv.slice(2)
const rows = []
for (const f of fs.readdirSync(dir, { recursive: true })) if (String(f).endsWith('.json')) rows.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
const jobs = new Map(JSON.parse(fs.readFileSync(jobsFile, 'utf8')).map((j) => [j.name, (new Date(j.completed_at) - new Date(j.started_at)) / 1000]))
const s = (ms) => (ms == null ? '' : (ms / 1000).toFixed(1))
const order = { plain: 0, pr276: 1, quod: 2, 'quod-par': 3 }
rows.sort((a, b) => a.case.localeCompare(b.case) || order[a.strategy] - order[b.strategy] || a.rep - b.rep)
console.log('| case | strategy | rep | nm restore s | install s | nm save s | tc restore s | typecheck s | saves s | **CI fast s** | **CI cost s** | turbo cached | nm hit | rc |')
console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|')
for (const r of rows) {
  const m = r.ms
  console.log(`| ${r.case} | ${r.strategy} | ${r.rep} | ${s(m.nm_restore)} | ${s(m.install)} | ${s(m.nm_save)} | ${s(m.tc_restore)} | ${s(m.typecheck)} | ${s(m.save)} | **${s(m.fast)}** | **${jobs.get(r.job) ?? ''}** | ${r.turbo_cached ?? ''} | ${r.strategy === 'plain' ? '' : r.nm_hit} | ${r.rc}${r.type_errors ? ` (${r.type_errors} TS errors)` : ''} |`)
}
console.log('\nrestore + typecheck (nm restore + install + tc restore + typecheck), per case:')
for (const r of rows) {
  const m = r.ms
  console.log(`- ${r.case} ${r.strategy}: ${s(m.nm_restore + m.install + m.tc_restore + m.typecheck)} s`)
}
fs.writeFileSync(path.join(dir, '..', 'rows.json'), JSON.stringify(rows))
