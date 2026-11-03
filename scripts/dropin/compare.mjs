// One commit of the drop-in bench: plain against check (and shadow), per
// vitest command line (key), per file and per test.
//
//   node compare.mjs <commit run dir>
//
// <dir>/plain/<key>.json, <dir>/check/<key>.{json,meta}, <dir>/shadow/<key>.json,
// <dir>/check-out/<ledger id>.json (quod's out.json of the check run: which
// files ran). A difference in a file the check run did not run is a WRONG
// replay; in a file it ran, flaky (plain vitest against plain vitest).
// Prints one JSON line.
import fs from 'node:fs'
import path from 'node:path'

const [dir] = process.argv.slice(2)
const rd = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
const load = (p) => {
  const j = rd(p)
  if (!j) return null
  const m = new Map()
  for (const t of j.testResults ?? []) {
    // vitest's fullName joins ancestors with ' '; quod's --report joins them with ' > '
    const tests = (t.assertionResults ?? []).map((x) => `${(x.fullName ?? x.title).split(' > ').join(' ')}=${({ todo: 'skipped', pending: 'skipped' })[x.status] ?? x.status}`).sort()
    m.set(t.name, { status: t.status, tests })
  }
  return m
}
// quod's --report has no file-level status: then the tests alone decide.
const same = (x, y) => (x.status == null || y.status == null || x.status === y.status) && x.tests.join('\n') === y.tests.join('\n')
const ls = (d, ext) => {
  try {
    return fs.readdirSync(d).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length))
  } catch {
    return []
  }
}
const keys = [...new Set([...ls(path.join(dir, 'plain'), '.json'), ...ls(path.join(dir, 'plain'), '.meta')])].sort()
const r = { invocations: keys.length, intercepted: 0, files: 0, ran: 0, replayed: 0, wrong: [], flaky: [], missing: [], shadow_diff: [], declined: [], per_key: [] }
for (const key of keys) {
  const meta = rd(path.join(dir, 'check', `${key}.meta`)) ?? rd(path.join(dir, 'plain', `${key}.meta`))
  const P = load(path.join(dir, 'plain', `${key}.json`))
  // The check run's vitest JSON; when its reporter wrote none (an inline
  // recording run), quod's own --report of the same run (per-test states).
  let C = load(path.join(dir, 'check', `${key}.json`))
  if (!C && meta) {
    C = load(path.join(dir, 'check-reports', `${meta.id}.json`))
    if (C) r.check_from_quod_report = (r.check_from_quod_report ?? 0) + 1
  }
  const S = load(path.join(dir, 'shadow', `${key}.json`))
  const out = meta ? rd(path.join(dir, 'check-out', `${meta.id}.json`)) : null
  const k = { key, id: meta?.id, args: meta?.args, files: P?.size ?? 0, ran: null, replayed: null }
  r.per_key.push(k)
  if (!P) {
    r.missing.push(`${key}: no plain report`)
    continue
  }
  r.files += P.size
  let ran = null
  if (out) {
    r.intercepted++
    ran = new Set((out.ran ?? []).map((x) => x.file))
    k.ran = [...P.keys()].filter((f) => ran.has(f)).length
    k.replayed = P.size - k.ran
    r.ran += k.ran
    r.replayed += k.replayed
  } else {
    r.declined.push(key)
    r.ran += P.size
  }
  if (!C) {
    r.missing.push(`${key}: no check report`)
    continue
  }
  for (const [f, x] of P) {
    const y = C.get(f)
    const bad = !y || !same(x, y)
    if (!bad) continue
    const what = { file: f, plain: x.status, check: y?.status ?? 'missing', minus: x.tests.filter((t) => !y?.tests.includes(t)).slice(0, 5), plus: (y?.tests ?? []).filter((t) => !x.tests.includes(t)).slice(0, 5) }
    if (ran && !ran.has(f)) r.wrong.push(what)
    else r.flaky.push(what)
  }
  for (const f of C.keys()) if (!P.has(f)) (ran && !ran.has(f) ? r.wrong : r.flaky).push({ file: f, plain: 'missing', check: C.get(f).status })
  if (S) for (const [f, x] of P) if (!S.has(f) || !same(x, S.get(f))) r.shadow_diff.push(f)
}
console.log(JSON.stringify(r))
