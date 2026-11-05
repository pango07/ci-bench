// bench-job's report, from jobs.jsonl (one line per real job, with the jobs
// API's job and step timestamps). All numbers are the API's (1 s
// resolution), none from in-job timers.
//
//   queue    job created_at -> started_at (waiting for a runner; not billed)
//   runner   job started_at -> completed_at (runner-seconds, what is billed)
//   boot     the "Set up job" step
//   setup    checkout + package-manager / node set-up steps (+ the env step)
//   action   the Quod action's main step (variant quod-*)
//   work     install + build + test steps
//   post     every post step and "Complete job"
//   fixed    runner - work (everything a job costs besides the project's own work)
//
//   node report.mjs jobs.jsonl <out dir>      -> markdown on stdout, <out>/job-metrics.json
import fs from 'node:fs'
import path from 'node:path'

const [file, outDir] = process.argv.slice(2)
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const t = (s) => (s ? Date.parse(s) / 1000 : NaN)
const dur = (st) => Math.max(0, t(st.completed_at) - t(st.started_at)) || 0

function group(name) {
  if (name === 'Set up job') return 'boot'
  if (name === 'Complete job' || name.startsWith('Post ')) return 'post'
  if (name === 'quod') return 'action'
  if (['install', 'build', 'test'].includes(name)) return name
  return 'setup'
}

// A hit: Quod replayed every test file of every vitest invocation of the job.
function hit(q) {
  if (!q) return null
  const ran = [...q.matchAll(/quod vitest: ran (\d+) files/g)].map((m) => +m[1])
  const all = (q.match(/quod vitest: every file replays/g) ?? []).length
  if (!ran.length && !all) return null
  return ran.every((n) => n === 0) ? 'hit' : 'miss'
}

// The wrong check: every job's test lines (drive.sh `sig`) and conclusion
// against plain's job of the same project and commit.
const plainOf = new Map(rows.filter((r) => r.variant === 'plain').map((r) => [`${r.id} ${r.commit}`, r]))
function wrong(r) {
  if (r.variant === 'plain' || r.variant === 'floor') return null
  const p = plainOf.get(`${r.id} ${r.commit}`)
  if (!p || !p.sig || !r.sig) return null
  const diff = []
  if (p.job.conclusion !== r.job.conclusion) diff.push(`conclusion ${p.job.conclusion} vs ${r.job.conclusion}`)
  const a = new Set(p.sig.split('\n').filter(Boolean))
  const b = new Set(r.sig.split('\n').filter(Boolean))
  for (const l of a) if (!b.has(l)) diff.push(`plain only: ${l.trim()}`)
  for (const l of b) if (!a.has(l)) diff.push(`${r.variant} only: ${l.trim()}`)
  return diff
}
const per = rows.map((r) => {
  const j = r.job
  const g = { boot: 0, setup: 0, action: 0, install: 0, build: 0, test: 0, post: 0 }
  for (const st of j.steps ?? []) if (st.conclusion !== 'skipped') g[group(st.name)] += dur(st)
  const runner = t(j.completed_at) - t(j.started_at)
  const work = g.install + g.build + g.test
  return {
    id: r.id, variant: r.variant, i: r.i, commit: r.commit, run: r.run, conclusion: j.conclusion,
    wall: t(j.completed_at) - t(j.created_at), queue: t(j.started_at) - t(j.created_at), runner, ...g, work, fixed: runner - work,
    boot_setup: g.boot + g.setup, hit: hit(r.quod), quod: r.quod, billed: Math.ceil(runner / 60), wrong: wrong(r), lines: (r.sig ?? '').split('\n').filter(Boolean).length,
  }
})

const median = (v) => {
  const a = v.filter((x) => Number.isFinite(x)).sort((p, q) => p - q)
  const m = a.length >> 1
  return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : NaN
}
const sum = (v) => v.reduce((a, b) => a + b, 0)
const f = (x) => (Number.isFinite(x) ? x.toFixed(0) : '-')
const keys = ['wall', 'queue', 'runner', 'boot', 'setup', 'action', 'install', 'build', 'test', 'post', 'fixed', 'boot_setup']

const groups = {}
for (const p of per) (groups[`${p.id} ${p.variant}`] ??= []).push(p)
const summary = {}
for (const [k, ps] of Object.entries(groups)) {
  summary[k] = { jobs: ps.length, corpus_runner_s: sum(ps.map((p) => p.runner)), corpus_wall_s: sum(ps.map((p) => p.wall)), median: Object.fromEntries(keys.map((x) => [x, median(ps.map((p) => p[x]))])) }
}
const all = (v, x) => median(per.filter((p) => p.variant === v).map((p) => p[x]))
const variants = [...new Set(per.map((p) => p.variant))]
const overall = Object.fromEntries(variants.map((v) => [v, Object.fromEntries(keys.map((x) => [x, all(v, x)]))]))

const out = []
out.push('### Real jobs: where a job\'s runner-seconds go (jobs API, seconds)')
out.push('')
out.push('Medians per project and variant. **fixed** = runner-seconds minus install, build and test steps. **boot+setup** = "Set up job" + checkout + package-manager/node set-up (the kill line is 40 s). Queue is not billed and not in runner.')
out.push('')
out.push('| project | variant | jobs | wall | queue | runner | boot | setup | action | install | build | test | post | **fixed** | **boot+setup** | corpus wall-s | corpus runner-s |')
out.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for (const [k, s] of Object.entries(summary)) {
  const [id, v] = k.split(' ')
  const m = s.median
  out.push(`| ${id} | ${v} | ${s.jobs} | ${f(m.wall)} | ${f(m.queue)} | ${f(m.runner)} | ${f(m.boot)} | ${f(m.setup)} | ${f(m.action)} | ${f(m.install)} | ${f(m.build)} | ${f(m.test)} | ${f(m.post)} | **${f(m.fixed)}** | **${f(m.boot_setup)}** | ${f(s.corpus_wall_s)} | ${f(s.corpus_runner_s)} |`)
}
for (const v of variants) {
  const m = overall[v]
  out.push(`| **all** | ${v} | ${per.filter((p) => p.variant === v).length} | ${f(m.wall)} | ${f(m.queue)} | ${f(m.runner)} | ${f(m.boot)} | ${f(m.setup)} | ${f(m.action)} | ${f(m.install)} | ${f(m.build)} | ${f(m.test)} | ${f(m.post)} | **${f(m.fixed)}** | **${f(m.boot_setup)}** | | |`)
}
out.push('')
// Cost and correctness per project and variant, against plain.
out.push('| project | variant | jobs | median wall | runner-s | x plain | billed min | x plain | wrong | unchecked |')
out.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|')
for (const [k, ps] of Object.entries(groups)) {
  const [id] = k.split(' ')
  const pl = groups[`${id} plain`] ?? []
  const rs = sum(ps.map((p) => p.runner))
  const bm = sum(ps.map((p) => p.billed))
  const prs = sum(pl.map((p) => p.runner))
  const pbm = sum(pl.map((p) => p.billed))
  const w = ps.filter((p) => p.wrong?.length).length
  const u = ps.filter((p) => p.variant !== 'plain' && p.wrong === null).length
  out.push(`| ${id} | ${ps[0].variant} | ${ps.length} | ${f(median(ps.map((p) => p.wall)))} | ${f(rs)} | ${prs ? (rs / prs).toFixed(2) : '-'} | ${bm} | ${pbm ? (bm / pbm).toFixed(2) : '-'} | ${ps[0].variant === 'plain' ? '' : w} | ${ps[0].variant === 'plain' ? '' : u} |`)
}
const wrongs = per.filter((p) => p.wrong?.length)
if (wrongs.length) {
  out.push('')
  out.push('**Wrong** (test lines or conclusion differ from plain at the same commit):')
  for (const p of wrongs) out.push(`- ${p.id} ${p.variant} #${p.i} ${p.commit.slice(0, 9)}: ${p.wrong.slice(0, 6).join('; ')}`)
}
out.push('')
out.push('<details><summary>per job</summary>\n')
out.push('| project | variant | # | commit | run | result | Quod | wrong | wall | queue | runner | billed | boot | setup | action | install | build | test | post | fixed |')
out.push('|---|---|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for (const p of per.sort((a, b) => a.id.localeCompare(b.id) || a.variant.localeCompare(b.variant) || a.i - b.i))
  out.push(`| ${p.id} | ${p.variant} | ${p.i} | ${p.commit.slice(0, 9)} | [${p.run}](https://github.com/${process.env.GITHUB_REPOSITORY ?? 'pango07/ci-bench'}/actions/runs/${p.run}) | ${p.conclusion} | ${p.hit ?? ''} | ${p.variant === 'plain' ? `${p.lines} lines` : p.wrong === null ? '?' : p.wrong.length ? 'WRONG' : '0'} | ${f(p.wall)} | ${f(p.queue)} | ${f(p.runner)} | ${p.billed} | ${f(p.boot)} | ${f(p.setup)} | ${f(p.action)} | ${f(p.install)} | ${f(p.build)} | ${f(p.test)} | ${f(p.post)} | ${f(p.fixed)} |`)
out.push('\n</details>\n')
if (outDir) fs.writeFileSync(path.join(outDir, 'job-metrics.json'), JSON.stringify({ overall, summary, per }, null, 1))
console.log(out.join('\n'))
