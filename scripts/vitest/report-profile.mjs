// report.md from profile.sh's results.jsonl: per kind, each variant's median
// wall time against --no-record and plain, and the medians of its parts.
//   node report-profile.mjs results.jsonl <project url> <sha>
import fs from 'node:fs'

const [file, url, sha] = process.argv.slice(2)
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const med = (v) => {
  const a = v.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((p, q) => p - q)
  if (!a.length) return null
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
const n0 = (x) => (x == null ? '' : Math.round(x).toString())
const sg = (x) => (x == null ? '' : `${x >= 0 ? '+' : ''}${Math.round(x)}`)
const pc = (a, b) => (a == null || !b ? '' : `${a >= b ? '+' : ''}${((a / b - 1) * 100).toFixed(1)}%`)
const repo = (url || '').replace(/\.git$/, '').replace(/^https:\/\/github.com\//, '')
console.log(`## Recorder profile: ${repo} at \`${(sha || '').slice(0, 9)}\`\n`)
console.log('Medians over the rounds, ms. Δ = against `--no-record` (the same Quod run without recording). Worker sums: summed over the files that ran (setup = the setup file before the test file, take = takePreciseCoverage, map = coverage to source lines, keys = the rest of the cleanup). Record phases: Rust after vitest exits.\n')
for (const kind of ['full', 'typical']) {
  const ks = rows.filter((r) => r.kind === kind)
  if (!ks.length) continue
  const labels = [...new Set(ks.map((r) => r.label))]
  const by = (l) => ks.filter((r) => r.label === l)
  const norec = med(by('norec').map((r) => r.ms))
  const plain = med(by('plain').map((r) => r.ms))
  const ran = med(by('rec').map((r) => r.ran))
  console.log(`### ${kind}${ran != null ? ` (${ran} files run)` : ''}\n`)
  console.log('| variant | wall | Δ vs --no-record | vs plain | vitest | record | render | ingest | states | write | worker setup Σ | take Σ | map Σ | keys Σ | driver post | exits |')
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const l of labels) {
    const g = by(l)
    const m = (f) => med(g.map(f))
    const wall = m((r) => r.ms)
    const post = m((r) => r.driver ? Object.entries(r.driver).filter(([k]) => k.startsWith('post_')).reduce((a, [, v]) => a + v, 0) : null)
    console.log(`| ${l} | ${n0(wall)} | ${l === 'norec' ? '' : `${sg(wall - norec)} (${pc(wall, norec)})`} | ${pc(wall, plain)} | ${n0(m((r) => r.vitest_ms))} | ${n0(m((r) => r.record_ms))} | ${n0(m((r) => r.render))} | ${n0(m((r) => r.phases?.ingest))} | ${n0(m((r) => r.phases?.states))} | ${n0(m((r) => r.phases?.write))} | ${n0(m((r) => r.driver?.workerSetupSum))} | ${n0(m((r) => r.driver?.workerCovSum))} | ${n0(m((r) => r.driver?.workerMapSum))} | ${n0(m((r) => r.driver?.workerKeysSum))} | ${n0(post)} | ${[...new Set(g.map((r) => r.exit))].join(',')} |`)
  }
  console.log()
}
