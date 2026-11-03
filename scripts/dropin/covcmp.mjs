// One commit of the drop-in bench: plain's coverage outputs against the
// Quod run's, the files a CI job uploads or checks (coverage-final.json,
// lcov.info, coverage-summary.json, clover.xml) and the text table vitest
// prints. Timestamps are ignored (clover's generated/timestamp attributes);
// JSON is compared parsed (key order aside), everything else byte for byte.
// Any other difference is a wrong result.
//
//   node covcmp.mjs <plain cov dir> <check cov dir> <plain log> <check log>
//
// Prints one JSON line: { files, same, diffs: [{ file, why }], totals }.
import fs from 'node:fs'
import path from 'node:path'

const [pd, cd, pl, cl] = process.argv.slice(2)
const ls = (d) => {
  try {
    return fs.readdirSync(d).sort()
  } catch {
    return []
  }
}
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
const norm = (name, buf) => {
  const s = buf.toString('utf8')
  if (name.endsWith('.json')) {
    try {
      return JSON.stringify(canon(JSON.parse(s)))
    } catch {
      return s
    }
  }
  if (name.endsWith('.xml')) return s.replace(/\b(generated|timestamp)="\d+"/g, '$1=""')
  return s
}
// vitest's text reporter table(s): from "Coverage report from" to the closing rule.
const table = (log) => {
  let s = ''
  try {
    s = fs.readFileSync(log, 'utf8')
  } catch {
    return null
  }
  const out = []
  let on = false
  for (const line of s.split('\n')) {
    const l = line.replace(/\x1b\[[0-9;]*m/g, '')
    if (/Coverage report from/.test(l)) {
      on = true
      out.push(l.trim())
      continue
    }
    if (!on || /quod( vitest)?:/.test(l)) continue
    // a table row or rule has a column per metric; anything else ends it
    if ((l.match(/\|/g) ?? []).length >= 4) out.push(l.trimEnd())
    else if (l.trim() && !/^[-\s]+$/.test(l)) on = false
  }
  return out.length ? out.join('\n') : null
}
const r = { files: 0, same: 0, diffs: [], plain_files: ls(pd).length, check_files: ls(cd).length }
for (const f of [...new Set([...ls(pd), ...ls(cd)])]) {
  r.files++
  let a = null
  let b = null
  try {
    a = norm(f, fs.readFileSync(path.join(pd, f)))
  } catch {}
  try {
    b = norm(f, fs.readFileSync(path.join(cd, f)))
  } catch {}
  if (a === null) r.diffs.push({ file: f, why: 'only the Quod run wrote it' })
  else if (b === null) r.diffs.push({ file: f, why: 'the Quod run did not write it' })
  else if (a !== b) {
    let why = 'differs'
    if (f.endsWith('coverage-summary.json') || f.endsWith('coverage-final.json')) {
      try {
        const A = JSON.parse(a)
        const B = JSON.parse(b)
        const ka = Object.keys(A)
        const kb = Object.keys(B)
        const only = ka.filter((k) => !(k in B)).concat(kb.filter((k) => !(k in A)))
        const changed = ka.filter((k) => k in B && JSON.stringify(A[k]) !== JSON.stringify(B[k]))
        why = `${only.length} files in one only, ${changed.length} differ (e.g. ${(only[0] ?? changed[0] ?? '').slice(-60)})`
        if (A.total && B.total) why += `; total plain ${JSON.stringify(A.total.lines)} quod ${JSON.stringify(B.total.lines)}`
      } catch {}
    }
    r.diffs.push({ file: f, why })
  } else r.same++
}
const ta = table(pl)
const tb = table(cl)
if (ta !== null || tb !== null) {
  r.files++
  if (ta === tb) r.same++
  else r.diffs.push({ file: '(text table)', why: ta === null ? 'plain printed none' : tb === null ? 'the Quod run printed none' : 'differs' })
}
// The totals plain reported, for the report.
for (const f of ls(pd).filter((f) => f.endsWith('coverage-summary.json'))) {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(pd, f), 'utf8')).total
    r.totals ??= {}
    r.totals[f] = { lines: t.lines.pct, branches: t.branches.pct, functions: t.functions.pct, statements: t.statements.pct }
  } catch {}
}
console.log(JSON.stringify(r))
