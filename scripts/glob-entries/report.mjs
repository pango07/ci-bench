// Per commit, side by side: what each binary ran and replayed on the
// glob-entries fixture, its wrong replays, and CI fast / CI cost totals.
//
//   node report.mjs <dir with <side>/results.jsonl and <side>/metrics.json>... (label=dir pairs)
import fs from 'node:fs'
import path from 'node:path'
const sides = process.argv.slice(2).map((a) => {
  const [label, dir] = a.split('=')
  const rows = fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.mutation)
  let metrics = null
  try {
    metrics = JSON.parse(fs.readFileSync(path.join(dir, 'metrics.json'), 'utf8'))
  } catch {}
  return { label, rows, metrics }
})
const n = (v) => (Array.isArray(v) ? v.length : v == null ? NaN : +v)
const base = sides[0].rows
console.log(`| # | commit | plain s | plain exit | ${sides.map((s) => `${s.label} ran / replayed (wrong)`).join(' | ')} |`)
console.log(`|---:|---|---:|---:|${sides.map(() => '---:').join('|')}|`)
for (const r of base) {
  const cells = sides.map((s) => {
    const x = s.rows.find((y) => y.i === r.i)
    if (!x) return '?'
    const w = n(x.wrong)
    return `${x.ran ?? '?'} / ${x.replayed ?? '?'} (${Number.isNaN(w) ? '?' : w})`
  })
  console.log(`| ${r.i}${r.first ? ' (first)' : ''} | ${r.subject} | ${(r.plain_ms / 1000).toFixed(1)} | ${r.plain_exit} | ${cells.join(' | ')} |`)
}
console.log()
for (const s of sides) {
  const wrong = s.rows.reduce((a, r) => a + (n(r.wrong) || 0), 0)
  const unknown = s.rows.filter((r) => Number.isNaN(n(r.wrong))).length
  const t = s.metrics?.totals
  const ran = s.rows.filter((r) => !r.first).reduce((a, r) => a + (r.ran ?? 0), 0)
  const rep = s.rows.filter((r) => !r.first).reduce((a, r) => a + (r.replayed ?? 0), 0)
  console.log(`- **${s.label}**: wrong replays ${wrong}${unknown ? ` (${unknown} commits not compared)` : ''}; after the first run ${ran} files ran, ${rep} replayed${t ? `; CI fast ${t.fast_x.toFixed(2)}x (${(t.fast_quod_ms / 1000).toFixed(1)} s vs ${(t.fast_plain_ms / 1000).toFixed(1)} s plain), CI cost ${t.cost_x.toFixed(2)}x (${(t.cost_quod_ms / 1000).toFixed(1)} s vs ${(t.cost_plain_ms / 1000).toFixed(1)} s), measured parts only ${t.cost_x_measured_only.toFixed(2)}x` : ''}`)
}
