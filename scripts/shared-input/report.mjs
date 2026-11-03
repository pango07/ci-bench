// results.jsonl (scripts/vitest/shadow.sh) -> a markdown table.
import fs from 'node:fs'
const [file, label] = process.argv.slice(2)
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const s = (ms) => (ms / 1000).toFixed(1)
console.log(`### ${label}\n`)
console.log('| # | commit | plain s | quod s | ran | replayed | shared changed | plain exit | quod exit | wrong |')
console.log('|---|---|---:|---:|---:|---:|---|---:|---:|---:|')
const n = (v) => (Array.isArray(v) ? v.length : v == null ? NaN : +v)
let wrong = 0
let unknown = 0
for (const r of rows) {
  const w = n(r.wrong)
  if (Number.isNaN(w)) unknown++
  else wrong += w
  const keys = r.shared_changed ? (r.shared_changed_keys ?? []).join(', ') : ''
  console.log(`| ${r.i} | ${r.subject} | ${s(r.plain_ms)} | ${s(r.crit_ms)} | ${r.ran ?? ''} | ${r.replayed ?? ''} | ${keys} | ${r.plain_exit} | ${r.crit_exit} | ${Number.isNaN(w) ? '?' : w} |`)
}
console.log(`\nwrong replays: ${wrong}${unknown ? ` (${unknown} commits not compared)` : ''}; shadow differences: ${rows.map((r) => n(r.shadow_wrong) || 0).reduce((a, b) => a + b, 0)}`)
