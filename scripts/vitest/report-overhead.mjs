// report.md (and overhead.json) from overhead.sh's results.jsonl.
//   node report-overhead.mjs results.jsonl "<vitest args>" <project url> <overhead.json>
import fs from 'node:fs'

const [path, args, url, jsonOut] = process.argv.slice(2)
const all = fs.readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const repo = (url || '').replace(/\.git$/, '')
const s = (ms) => (ms / 1000).toFixed(2)
const median = (v) => {
  const a = [...v].sort((p, q) => p - q)
  const m = a.length >> 1
  return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : 0
}
const sum = (v) => v.reduce((a, b) => a + b, 0)
const pct = (a, b) => ((a / Math.max(b, 10) - 1) * 100)
const f = (p) => `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`

// Per (kind, commit): the median of each mode over its rounds.
const groups = new Map()
for (const r of all) {
  const k = `${r.kind} ${r.i}`
  if (!groups.has(k)) groups.set(k, { kind: r.kind, i: r.i, commit: r.commit, plain: [], norec: [], rec: [], diffs: 0, uncompared: 0, ran: [], replayed: [], audited: [], record_ms: [] })
  const g = groups.get(k)
  g[r.mode].push(r.ms)
  if (r.differences === null) g.uncompared++
  else g.diffs += r.differences
  if (r.mode === 'rec') {
    g.ran.push(r.ran ?? 0)
    g.replayed.push(r.replayed ?? 0)
    g.audited.push(r.audited ?? 0)
    g.record_ms.push(r.record_ms ?? 0)
  }
}
const rows = [...groups.values()].map((g) => {
  const p = median(g.plain), n = median(g.norec), q = median(g.rec)
  return { ...g, p, n, q, norec_vs_plain: pct(n, p), rec_vs_plain: pct(q, p), rec_vs_norec: pct(q, n), record_cost_vs_plain: ((q - n) / Math.max(p, 10)) * 100 }
})
const summary = {}
for (const kind of ['full', 'typical']) {
  const g = rows.filter((r) => r.kind === kind)
  if (!g.length) continue
  const P = sum(g.map((r) => r.p)), N = sum(g.map((r) => r.n)), Q = sum(g.map((r) => r.q))
  summary[kind] = {
    commits: g.length,
    plain_ms: P, norec_ms: N, rec_ms: Q,
    total_rec_vs_plain_pct: +pct(Q, P).toFixed(2),
    total_norec_vs_plain_pct: +pct(N, P).toFixed(2),
    total_rec_vs_norec_pct: +pct(Q, N).toFixed(2),
    total_record_cost_vs_plain_pct: +(((Q - N) / Math.max(P, 10)) * 100).toFixed(2),
    median_rec_vs_plain_pct: +median(g.map((r) => r.rec_vs_plain)).toFixed(2),
    median_rec_vs_norec_pct: +median(g.map((r) => r.rec_vs_norec)).toFixed(2),
    worst_rec_vs_plain_pct: +Math.max(...g.map((r) => r.rec_vs_plain)).toFixed(2),
    worst_rec_vs_norec_pct: +Math.max(...g.map((r) => r.rec_vs_norec)).toFixed(2),
    differences: sum(g.map((r) => r.diffs)),
    uncompared: sum(g.map((r) => r.uncompared)),
  }
}
// The design's verdict: recording overhead where every file runs is the
// recording against plain; on typical commits, inline against --no-record
// (the same selection, so the difference is the recording and audits).
const ohFull = summary.full?.total_rec_vs_plain_pct
const ohTyp = summary.typical?.total_rec_vs_norec_pct
const worst = Math.max(ohFull ?? -Infinity, ohTyp ?? -Infinity)
const diffs = (summary.full?.differences ?? 0) + (summary.typical?.differences ?? 0) + (summary.full?.uncompared ?? 0) + (summary.typical?.uncompared ?? 0)
const verdict = diffs > 0 ? 'FAIL (differences against plain)' : worst <= 15 ? 'PASS (at most 15% overhead, 0 differences)' : worst <= 25 ? 'FAIL (over 15%, under 25%)' : 'FAIL: OVER 25% (kills the design)'
fs.writeFileSync(jsonOut, JSON.stringify({ repo, args, summary, verdict, per_commit: rows.map(({ plain, norec, rec, ...r }) => ({ ...r, plain_runs: plain, norec_runs: norec, rec_runs: rec })) }, null, 1))

const out = []
out.push(`## Inline recording overhead: ${repo.split('/').slice(-2).join('/')}`)
out.push('')
out.push(`\`vitest ${args}\`: plain \`vitest\`, \`quod vitest --no-record\` and \`quod vitest --audits auto\` (inline recording), interleaved in rotating order, ${median(rows.map((r) => r.plain.length))} rounds each per commit; medians per commit. **full**: every file must run (both Quod modes from an empty ledger). **typical**: both Quod modes from the same ledger (the previous commit's inline recording). Every Quod report compared with the same round's plain report, file by file and test by test.`)
out.push('')
out.push(`**Verdict: ${verdict}.** Overhead every-file-runs (inline vs plain, total): ${ohFull != null ? f(ohFull) : 'n/a'}; typical (inline vs --no-record, total): ${ohTyp != null ? f(ohTyp) : 'n/a'}.`)
out.push('')
out.push('| | commits | plain | --no-record | inline | --no-record vs plain | inline vs plain | inline vs --no-record | recording cost (as % of plain) | differences |')
out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for (const [kind, x] of Object.entries(summary)) {
  out.push(`| **${kind}** (total of medians) | ${x.commits} | ${s(x.plain_ms)} s | ${s(x.norec_ms)} s | ${s(x.rec_ms)} s | ${f(x.total_norec_vs_plain_pct)} | ${f(x.total_rec_vs_plain_pct)} | ${f(x.total_rec_vs_norec_pct)} | ${f(x.total_record_cost_vs_plain_pct)} | ${x.differences}${x.uncompared ? ` (+${x.uncompared} not compared)` : ''} |`)
  out.push(`| ${kind}, median / worst per commit | | | | | | ${f(x.median_rec_vs_plain_pct)} / ${f(x.worst_rec_vs_plain_pct)} | ${f(x.median_rec_vs_norec_pct)} / ${f(x.worst_rec_vs_norec_pct)} | | |`)
}
out.push('')
out.push('| kind | # | commit | plain (median) | --no-record | inline | inline vs plain | inline vs --no-record | inline: ran / replayed / audited | record ms (median) | differences |')
out.push('|---|---:|---|---:|---:|---:|---:|---:|---|---:|---:|')
for (const r of rows) {
  const link = repo ? `[${r.commit.slice(0, 9)}](${repo}/commit/${r.commit})` : r.commit.slice(0, 9)
  out.push(`| ${r.kind} | ${r.i} | ${link} | ${s(r.p)} s | ${s(r.n)} s | ${s(r.q)} s | ${f(r.rec_vs_plain)} | ${f(r.rec_vs_norec)} | ${median(r.ran)} / ${median(r.replayed)} / ${median(r.audited)} | ${median(r.record_ms).toFixed(0)} | ${r.diffs}${r.uncompared ? ` (+${r.uncompared} not compared)` : ''} |`)
}
out.push('')
out.push(`Per-run times: overhead.json and results.jsonl in the artifact (min/max spread per mode there).`)
console.log(out.join('\n'))
