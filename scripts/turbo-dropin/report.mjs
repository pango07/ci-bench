// report.mjs <jobs.json> <logs dir>: the drop-in table and its checks.
//
// From GitHub's own step times (whole seconds) of each job:
//   CI fast  the critical path to the typecheck's verdict: "Set up job"
//            (runner set-up and the download of every action the job uses)
//            plus the customer's steps from the first one's start to the
//            typecheck's end.
//   CI cost  the runner seconds the customer's job spends: "Set up job",
//            every customer step and its post step (cache saves included),
//            and "Complete job".
// The `bench:` steps (the fixture, finding the server) are the harness and
// are left out of both.
import fs from 'node:fs'
import path from 'node:path'

const [jobsFile, logs] = process.argv.slice(2)
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'))
const secs = (s) => (s.started_at && s.completed_at ? (new Date(s.completed_at) - new Date(s.started_at)) / 1000 : 0)
const at = (t) => new Date(t).getTime() / 1000

const rows = []
for (const j of jobs) {
  const m = /^(plain|quod) (source|docs|lock|typeerror)$/.exec(j.name) ?? (j.name === 'seed' ? [null, 'quod', 'seed'] : null)
  if (!m) continue
  const steps = j.steps ?? []
  const ci = steps.filter((s) => /^(Post )?ci: /.test(s.name) && s.conclusion !== 'skipped')
  const setup = steps.find((s) => s.name === 'Set up job')
  const done = steps.find((s) => s.name === 'Complete job')
  const tc = steps.find((s) => s.name === 'ci: typecheck')
  const first = ci.find((s) => !s.name.startsWith('Post '))
  const step = (n) => secs(steps.find((s) => s.name === n) ?? {})
  const log = (() => {
    try {
      return fs.readFileSync(path.join(logs, `${j.id}.log`), 'utf8')
    } catch {
      return ''
    }
  })()
  const cached = /Cached:\s+(\d+) cached, (\d+) total/.exec(log)
  rows.push({
    strategy: m[1],
    case: m[2],
    job: j.id,
    url: j.html_url,
    verdict: tc?.conclusion ?? 'none',
    fast: tc && first ? secs(setup ?? {}) + at(tc.completed_at) - at(first.started_at) : null,
    cost: secs(setup ?? {}) + ci.reduce((a, s) => a + secs(s), 0) + secs(done ?? {}),
    wall: secs(j),
    s: {
      setup: secs(setup ?? {}),
      node: step('ci: setup-node'),
      quod: step('ci: quod'),
      install: step('ci: install'),
      typecheck: step('ci: typecheck'),
      post: ci.filter((s) => s.name.startsWith('Post ')).reduce((a, s) => a + secs(s), 0),
      post_quod: step('Post ci: quod'),
    },
    turbo: cached ? `${cached[1]}/${cached[2]}` : '',
    ts_errors: (log.match(/error TS\d+/g) ?? []).length,
    npm_ci_skipped: /npm ci skipped/.test(log),
    nm_restored: /node_modules restored for this lockfile/.test(log),
    nm_missed: /no node_modules saved yet for this lockfile/.test(log),
    nm_saved: /node_modules saved for this lockfile/.test(log),
    remote: /turbo's remote cache is Quod Cloud/.test(log),
  })
}
const order = { seed: 0, source: 1, docs: 2, lock: 3, typeerror: 4 }
rows.sort((a, b) => order[a.case] - order[b.case] || a.strategy.localeCompare(b.strategy))
const n = (v) => (v == null ? '' : String(Math.round(v)))
console.log('| case | strategy | **CI fast s** | **CI cost s** | set up job | setup-node | quod | npm ci | typecheck | post steps | turbo cached | node_modules | verdict |')
console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|')
for (const r of rows) {
  const nm = r.strategy === 'plain' ? '' : r.npm_ci_skipped ? 'restored, npm ci skipped' : r.nm_missed ? `missed${r.nm_saved ? ', saved' : ''}` : r.nm_restored ? 'restored, npm ci ran' : '?'
  console.log(`| ${r.case} | ${r.strategy} | **${n(r.fast)}** | **${n(r.cost)}** | ${n(r.s.setup)} | ${n(r.s.node)} | ${r.strategy === 'quod' ? n(r.s.quod) : ''} | ${n(r.s.install)} | ${n(r.s.typecheck)} | ${n(r.s.post)} | ${r.turbo} | ${nm} | ${r.verdict}${r.ts_errors ? ` (${r.ts_errors} TS errors)` : ''} |`)
}

// Correctness: the verdict each case must have, the same with and without
// Quod, and what the caches must have done.
const checks = []
const ok = (c, what) => checks.push(`${c ? 'ok  ' : 'FAIL'} ${what}`)
for (const c of ['source', 'docs', 'lock', 'typeerror']) {
  const p = rows.find((r) => r.case === c && r.strategy === 'plain')
  const q = rows.find((r) => r.case === c && r.strategy === 'quod')
  if (!p || !q) {
    ok(false, `${c}: both jobs ran`)
    continue
  }
  const want = c === 'typeerror' ? 'failure' : 'success'
  ok(p.verdict === want && q.verdict === want, `${c}: typecheck ${want} with and without Quod (plain ${p.verdict}, quod ${q.verdict})`)
  if (c === 'typeerror') ok(q.ts_errors > 0 && q.ts_errors === p.ts_errors, `typeerror: the same TS errors (plain ${p.ts_errors}, quod ${q.ts_errors})`)
  if (c === 'lock') {
    ok(q.nm_missed && !q.npm_ci_skipped, 'lock: node_modules missed and npm ci ran')
    ok(q.turbo.startsWith('0/'), `lock: no turbo task replayed (${q.turbo})`)
  } else {
    ok(q.npm_ci_skipped, `${c}: node_modules restored and npm ci skipped`)
  }
  if (c === 'docs') ok(q.turbo === '3/3', `docs: every turbo task replayed (${q.turbo})`)
  ok(q.remote, `${c}: turbo used Quod Cloud`)
}
const wrong = checks.filter((c) => c.startsWith('FAIL')).length
console.log(`\n### Checks (${wrong} failed)\n`)
for (const c of checks) console.log(`- ${c}`)
const sum = (s, k) => rows.filter((r) => r.strategy === s && r.case !== 'seed').reduce((a, r) => a + (r[k] ?? 0), 0)
console.log(`\nAll four cases: CI fast plain ${n(sum('plain', 'fast'))} s, quod ${n(sum('quod', 'fast'))} s; CI cost plain ${n(sum('plain', 'cost'))} s, quod ${n(sum('quod', 'cost'))} s (the seed, the previous run, is not in these sums).`)
fs.writeFileSync('rows.json', JSON.stringify(rows, null, 1))
