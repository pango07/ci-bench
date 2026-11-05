// The two headline numbers versus plain CI, from a bench's results.jsonl:
//
//   CI fast: wall time from job start until the developer-facing check is
//            done (the critical path only: install + the test step, or
//            Quod's plan when it skips the install).
//   CI cost: runner-seconds across EVERY job the setup needs: each job's
//            fixed overhead (JOB_FIXED_MS, an estimate: runner set-up,
//            checkout, cache restore and save), its install, its test step,
//            and for the shadow line the whole shadow job (its own install
//            and the recording run).
//
// Plain CI is one job: fixed + install + `vitest`. Install is measured per
// commit (a fresh `pnpm install --frozen-lockfile --prefer-offline` from a
// warm store, as a CI cache restores it); the fixed overhead is not measured.
//
//   node ci-metrics.mjs results.jsonl <out dir>
// Adds ci_* fields to every timed row of results.jsonl (rewritten in place),
// writes <out dir>/metrics.json and prints the markdown section.
import fs from 'node:fs'
import path from 'node:path'

const [file, outDir] = process.argv.slice(2)
// Measured (bench-job run 41945160971, 24 plain jobs of zustand, convex-helpers,
// mcp-sdk and vercel-ai, jobs API): median runner-seconds outside the
// install, build and test steps of a plain job = 12 s (8 s set-up job,
// checkout and package-manager/node set-up; the rest post steps and gaps).
// The action adds a median 6 s more per job (its main and post steps).
const J = Number(process.env.JOB_FIXED_MS ?? 12000)
const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const isFirst = (r) => r.first || r.warmup

// Per row: { plain: {fast, cost}, quod: {fast, cost}, jobs: [...] } or null.
function ci(r) {
  if (r.mutation || r.plain_ms == null) return null
  const install = r.install_ms ?? 0
  const plain = { fast: install + r.plain_ms, cost: J + install + r.plain_ms }
  if (r.crit_ms != null) {
    // The shadow line: the check job, then a separate shadow job that
    // reinstalls and re-runs the affected files with recording on.
    const check = r.plan != null ? r.plan_ms + (r.plan === 'done' ? 0 : install + r.crit_ms) : install + r.crit_ms
    const shadow = install + r.shadow_ms + (r.observe_ms ?? 0)
    return {
      plain,
      quod: { fast: check, cost: J + check + J + shadow },
      jobs: { check_ms: check, shadow_job_ms: shadow, fixed_ms: 2 * J },
    }
  }
  if (r.quod_ms != null) {
    // Inline (recording in the check job itself; second witness): one job.
    const check = install + r.quod_ms
    return { plain, quod: { fast: check, cost: J + check }, jobs: { check_ms: check, fixed_ms: J } }
  }
  return null
}

const rows = []
for (const r of lines) {
  const m = ci(r)
  if (!m) continue
  Object.assign(r, {
    ci_fast_plain_ms: m.plain.fast,
    ci_fast_quod_ms: m.quod.fast,
    ci_cost_plain_ms: m.plain.cost,
    ci_cost_quod_ms: m.quod.cost,
    ci_fast_x: +(m.quod.fast / Math.max(m.plain.fast, 10)).toFixed(3),
    ci_cost_x: +(m.quod.cost / Math.max(m.plain.cost, 10)).toFixed(3),
    ci_jobs: m.jobs,
  })
  // Same-job A/B (bench.sh with QUOD_B): B is an inline check job too.
  if (r.b_ms != null) {
    const install = r.install_ms ?? 0
    Object.assign(r, { ci_fast_b_ms: install + r.b_ms, ci_cost_b_ms: J + install + r.b_ms })
  }
  rows.push(r)
}
fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

const timed = rows.filter((r) => !isFirst(r))
const first = rows.find(isFirst)
const sum = (v) => v.reduce((a, b) => a + b, 0)
const median = (v) => {
  const a = [...v].sort((p, q) => p - q)
  const m = a.length >> 1
  return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : 0
}
const s = (ms) => (ms / 1000).toFixed(1)
const tot = (k) => sum(timed.map((r) => r[k]))
const totals = {
  commits: timed.length,
  job_fixed_ms: J,
  fast_plain_ms: tot('ci_fast_plain_ms'),
  fast_quod_ms: tot('ci_fast_quod_ms'),
  cost_plain_ms: tot('ci_cost_plain_ms'),
  cost_quod_ms: tot('ci_cost_quod_ms'),
  install_ms: tot('install_ms'),
}
totals.fast_x = +(totals.fast_quod_ms / Math.max(totals.fast_plain_ms, 1)).toFixed(3)
totals.cost_x = +(totals.cost_quod_ms / Math.max(totals.cost_plain_ms, 1)).toFixed(3)
totals.fast_x_median = +median(timed.map((r) => r.ci_fast_x)).toFixed(3)
totals.cost_x_median = +median(timed.map((r) => r.ci_cost_x)).toFixed(3)
// The same totals without the estimated fixed overhead (measured parts only).
const jobs = (r) => (r.ci_jobs.shadow_job_ms != null ? 2 : 1)
totals.cost_x_measured_only = +(
  sum(timed.map((r) => r.ci_cost_quod_ms - jobs(r) * J)) / Math.max(sum(timed.map((r) => r.ci_cost_plain_ms - J)), 1)
).toFixed(3)
const shadowLine = timed.some((r) => r.ci_jobs.shadow_job_ms != null)
const ab = timed.length > 0 && timed.every((r) => r.ci_fast_b_ms != null)
if (ab) {
  Object.assign(totals, { fast_b_ms: tot('ci_fast_b_ms'), cost_b_ms: tot('ci_cost_b_ms') })
  totals.fast_b_x = +(totals.fast_b_ms / Math.max(totals.fast_plain_ms, 1)).toFixed(3)
  totals.cost_b_x = +(totals.cost_b_ms / Math.max(totals.cost_plain_ms, 1)).toFixed(3)
  totals.fast_b_x_median = +median(timed.map((r) => r.ci_fast_b_ms / Math.max(r.ci_fast_plain_ms, 10))).toFixed(3)
  totals.cost_b_x_median = +median(timed.map((r) => r.ci_cost_b_ms / Math.max(r.ci_cost_plain_ms, 10))).toFixed(3)
  totals.b_wrong = sum(timed.map((r) => (r.b_wrong ?? []).length))
}
const metrics = {
  definition: {
    ci_fast: 'job start to developer-facing check done, critical path only: install + test step (Quod: plan, then install + check unless the plan replayed everything)',
    ci_cost: 'runner-seconds over every job: per job JOB_FIXED_MS (estimate) + install + test/record step; the shadow line adds the shadow job (install + recording run)',
    install: 'measured per commit: fresh pnpm install --frozen-lockfile --prefer-offline from a warm store',
    ratio: 'quod / plain (below 1 is better)',
  },
  totals,
  first: first ? { commit: first.commit, ci_fast_plain_ms: first.ci_fast_plain_ms, ci_fast_quod_ms: first.ci_fast_quod_ms, ci_cost_plain_ms: first.ci_cost_plain_ms, ci_cost_quod_ms: first.ci_cost_quod_ms } : null,
  per_commit: timed.map((r) => ({ i: r.i, commit: r.commit, ci_fast_plain_ms: r.ci_fast_plain_ms, ci_fast_quod_ms: r.ci_fast_quod_ms, ci_cost_plain_ms: r.ci_cost_plain_ms, ci_cost_quod_ms: r.ci_cost_quod_ms, ci_fast_x: r.ci_fast_x, ci_cost_x: r.ci_cost_x, jobs: r.ci_jobs })),
}
if (outDir) fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 1))

const out = []
out.push(`### CI fast and CI cost versus plain CI${shadowLine ? ' (shadow line: check job + shadow job)' : ' (one job)'}`)
out.push('')
out.push(`Ratio = Quod / plain; below 1.00 is better. **CI fast**: job start until the check is done (install + test step; critical path only). **CI cost**: runner-seconds across every job${shadowLine ? ', the shadow job (its own install and the recording run) included' : ''}. Install measured per commit (fresh \`pnpm install --frozen-lockfile --prefer-offline\`, warm store). Each job also carries a ${s(J)} s fixed overhead (set-up, checkout, post steps; \`JOB_FIXED_MS\`, the median measured on real plain jobs by bench-job.yml).`)
out.push('')
out.push('| | plain | Quod | ratio (total) | median per-commit ratio |')
out.push('|---|---:|---:|---:|---:|')
out.push(`| **CI fast**, ${timed.length} commits | ${s(totals.fast_plain_ms)} s | ${s(totals.fast_quod_ms)} s | **${totals.fast_x.toFixed(2)}x** | ${totals.fast_x_median.toFixed(2)}x |`)
out.push(`| **CI cost**, ${timed.length} commits | ${s(totals.cost_plain_ms)} s | ${s(totals.cost_quod_ms)} s | **${totals.cost_x.toFixed(2)}x** | ${totals.cost_x_median.toFixed(2)}x |`)
out.push(`| CI cost, measured parts only (no fixed overhead) | | | ${totals.cost_x_measured_only.toFixed(2)}x | |`)
if (ab) {
  out.push(`| **same job, B** (\`QUOD_B\`): CI fast | ${s(totals.fast_plain_ms)} s | ${s(totals.fast_b_ms)} s | **${totals.fast_b_x.toFixed(2)}x** | ${totals.fast_b_x_median.toFixed(2)}x |`)
  out.push(`| **same job, B**: CI cost | ${s(totals.cost_plain_ms)} s | ${s(totals.cost_b_ms)} s | **${totals.cost_b_x.toFixed(2)}x** | ${totals.cost_b_x_median.toFixed(2)}x |`)
  out.push(`| B / A (test step totals) | | | ${(sum(timed.map((r) => r.b_ms)) / Math.max(sum(timed.map((r) => r.quod_ms)), 1)).toFixed(3)} | B wrong replays: ${totals.b_wrong} |`)
}
if (first) out.push(`| first run ever (not in the totals) | fast ${s(first.ci_fast_plain_ms)} s, cost ${s(first.ci_cost_plain_ms)} s | fast ${s(first.ci_fast_quod_ms)} s, cost ${s(first.ci_cost_quod_ms)} s | | |`)
out.push('')
out.push(`<details><summary>per commit</summary>\n`)
out.push(`| # | install | plain fast | Quod fast | fast ratio | plain cost | Quod cost${shadowLine ? ' (check + shadow job)' : ''} | cost ratio |`)
out.push('|---:|---:|---:|---:|---:|---:|---:|---:|')
for (const r of rows) {
  const parts = r.ci_jobs.shadow_job_ms != null ? ` (${s(J + r.ci_jobs.check_ms)} + ${s(J + r.ci_jobs.shadow_job_ms)})` : ''
  out.push(`| ${r.i}${isFirst(r) ? ' (first)' : ''} | ${s(r.install_ms ?? 0)} s | ${s(r.ci_fast_plain_ms)} s | ${s(r.ci_fast_quod_ms)} s | ${r.ci_fast_x.toFixed(2)}x | ${s(r.ci_cost_plain_ms)} s | ${s(r.ci_cost_quod_ms)} s${parts} | ${r.ci_cost_x.toFixed(2)}x |`)
}
out.push('\n</details>\n')
console.log(out.join('\n'))
