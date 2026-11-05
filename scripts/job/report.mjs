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

// A hit: Quod replayed every test file of every vitest invocation of the
// job. off: the action turned Quod off for vitest (the job ran plain; a
// failed install, for one), whatever else the log says.
function hit(q) {
  if (!q) return null
  if (/Quod is off for vitest|Quod is off for this job|Quod was off for vitest/.test(q)) return 'off'
  const ran = [...q.matchAll(/quod vitest: ran (\d+) files/g)].map((m) => +m[1])
  const all = (q.match(/quod vitest: every file replays/g) ?? []).length
  if (!ran.length && !all) return null
  if (!ran.every((n) => n === 0)) return 'miss'
  if (/quod: .* (runs:|runs plain|always runs|recorded \(first witness)|quod: .*second witness (agrees|disagrees)/.test(q)) return 'partial'
  return 'hit'
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
  // Preserve multiplicity: two projects can print the same test line.
  const counts = (sig) => {
    const out = new Map()
    for (const line of sig.split('\n').filter(Boolean)) out.set(line, (out.get(line) ?? 0) + 1)
    return out
  }
  const a = counts(p.sig), b = counts(r.sig)
  for (const line of new Set([...a.keys(), ...b.keys()])) {
    if ((a.get(line) ?? 0) !== (b.get(line) ?? 0)) diff.push(`count ${a.get(line) ?? 0} plain vs ${b.get(line) ?? 0} ${r.variant}: ${line.trim()}`)
  }
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
    boot_setup: g.boot + g.setup, lineage: [...(r.quod ?? '').matchAll(/lineage: (\d+) promoted, (\d+) plain audits, (\d+) disagreed, (\d+) revoked/g)].reduce((a, m) => ({promoted:a.promoted + +m[1],audits:a.audits + +m[2],disagreed:a.disagreed + +m[3],revoked:a.revoked + +m[4]}), {promoted:0,audits:0,disagreed:0,revoked:0}), hit: hit(r.quod), image: r.image ?? '', quod: r.quod, billed: Math.ceil(runner / 60), wrong: wrong(r), lines: (r.sig ?? '').split('\n').filter(Boolean).length,
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
  const u = ps.filter((p) => !['plain', 'floor'].includes(p.variant) && p.wrong === null).length
  out.push(`| ${id} | ${ps[0].variant} | ${ps.length} | ${f(median(ps.map((p) => p.wall)))} | ${f(rs)} | ${prs ? (rs / prs).toFixed(2) : '-'} | ${bm} | ${pbm ? (bm / pbm).toFixed(2) : '-'} | ${ps[0].variant === 'plain' ? '' : w} | ${ps[0].variant === 'plain' ? '' : u} |`)
}
const wrongs = per.filter((p) => p.wrong?.length)
if (wrongs.length) {
  out.push('')
  out.push('**Wrong** (test lines or conclusion differ from plain at the same commit):')
  for (const p of wrongs) out.push(`- ${p.id} ${p.variant} #${p.i} ${p.commit.slice(0, 9)}: ${p.wrong.slice(0, 6).join('; ')}`)
}
out.push('')
out.push('| variant | c1–c11 runner-s | x plain | billed min | x plain | best hit above floor | median hit above floor | lineage audits | disagreed |')
out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
for (const v of variants.filter(v => !['plain', 'floor'].includes(v))) {
  const ps = per.filter(p => p.variant === v)
  const warm = ps.filter(p => p.i > 0)
  const pl = per.filter(p => p.variant === 'plain' && p.i > 0)
  const hitGaps = ps.filter(p => p.hit === 'hit').flatMap(p => {
    const floor = per.find(x => x.variant === 'floor' && x.id === p.id && x.commit === p.commit)
    return floor ? [p.runner - floor.runner] : []
  })
  out.push(`| ${v} | ${sum(warm.map(p=>p.runner))} | ${(sum(warm.map(p=>p.runner))/sum(pl.map(p=>p.runner))).toFixed(2)} | ${sum(warm.map(p=>p.billed))} | ${(sum(warm.map(p=>p.billed))/sum(pl.map(p=>p.billed))).toFixed(2)} | ${hitGaps.length ? 'floor + ' + f(Math.min(...hitGaps)) + ' s' : 'no full hits'} | ${hitGaps.length ? 'floor + ' + f(median(hitGaps)) + ' s' : 'no full hits'} | ${sum(ps.map(p=>p.lineage.audits))} | ${sum(ps.map(p=>p.lineage.disagreed))} |`)
}
out.push('')
out.push('<details><summary>per job</summary>\n')
out.push('| project | variant | # | commit | run | image | result | Quod | wrong | wall | queue | runner | billed | boot | setup | action | install | build | test | post | fixed |')
out.push('|---|---|---:|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for (const p of per.sort((a, b) => a.id.localeCompare(b.id) || a.variant.localeCompare(b.variant) || a.i - b.i))
  out.push(`| ${p.id} | ${p.variant} | ${p.i} | ${p.commit.slice(0, 9)} | [${p.run}](https://github.com/${process.env.GITHUB_REPOSITORY ?? 'pango07/ci-bench'}/actions/runs/${p.run}) | ${p.image} | ${p.conclusion} | ${p.hit ?? ''} | ${p.variant === 'plain' ? `${p.lines} lines` : p.wrong === null ? '?' : p.wrong.length ? 'WRONG' : '0'} | ${f(p.wall)} | ${f(p.queue)} | ${f(p.runner)} | ${p.billed} | ${f(p.boot)} | ${f(p.setup)} | ${f(p.action)} | ${f(p.install)} | ${f(p.build)} | ${f(p.test)} | ${f(p.post)} | ${f(p.fixed)} |`)
out.push('\n</details>\n')
if (outDir) fs.writeFileSync(path.join(outDir, 'job-metrics.json'), JSON.stringify({ overall, summary, per }, null, 1))
console.log(out.join('\n'))

// A green benchmark must contain evidence for every expected comparison.
// Older downloaded evidence can still be rendered, but missing signatures
// and wrong results always make the report command fail.
const lineageFailures = per.filter(p => p.lineage.disagreed > 0)
const unchecked = per.filter((p) => !['plain', 'floor'].includes(p.variant) && p.wrong === null)
const expectedFile = outDir && path.join(outDir, 'expected.jsonl')
const expected = expectedFile && fs.existsSync(expectedFile)
  ? fs.readFileSync(expectedFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
const key = (r) => JSON.stringify([r.id, r.variant, r.i, r.commit])
const actual = new Set(per.map(key))
const missing = expected.filter((r) => !actual.has(key(r)))
if (wrongs.length || unchecked.length || missing.length || lineageFailures.length) {
  console.error(`Benchmark verification failed: ${wrongs.length} wrong, ${unchecked.length} unchecked, ${missing.length} missing jobs, ${lineageFailures.length} lineage disagreements`)
  process.exitCode = 1
}
