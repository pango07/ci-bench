'use strict'
// Bench-only preload, loaded by the bench's node shim BEFORE Quod's hook.cjs.
// For a vitest command line it appends a JSON reporter writing to a fixed
// path per (working directory, original arguments), so plain, check and
// shadow runs of the same command produce comparable per-test reports, and
// writes which ledger id Quod's hook will use for that command line (the
// hook's own formula, on the arguments after this append). Nothing else.
;(() => {
  const argv = process.argv
  if (process.env.QUOD_SHIM_ACTIVE === '1') return
  const bin = argv[1]
  const fs = require('node:fs')
  const path = require('node:path')
  // Yarn runs scripts with its own `node` wrapper (its process.execPath):
  // the shim instead, as quod-action's hook does, so the plain run's vitest
  // gets this reporter too (the hook is not loaded in plain runs).
  if (bin && /yarn/.test(bin)) {
    try {
      if (/^yarn(pkg)?(-[^/]*)?\.c?js$/.test(path.basename(fs.realpathSync(bin)))) process.execPath = path.join(__dirname, '..', 'bin', 'node')
    } catch {}
    return
  }
  if (!bin || !/vitest(\.m?js)?$/.test(bin)) return
  let entry
  try {
    entry = fs.realpathSync(bin)
  } catch {
    return
  }
  if (!entry.endsWith(`${path.sep}vitest${path.sep}vitest.mjs`)) return
  let ctl
  try {
    ctl = JSON.parse(fs.readFileSync(path.join(__dirname, 'control.json'), 'utf8'))
  } catch {
    return
  }
  const crypto = require('node:crypto')
  const h8 = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 8)
  const orig = argv.slice(2)
  if (['watch', 'dev', 'bench', 'list', 'init'].includes(orig[0])) return
  const rel = path.relative(ctl.root, process.cwd()) || 'root'
  const slug = rel.replace(/[^A-Za-z0-9._-]+/g, '_')
  const key = `${slug}-${h8(orig)}`
  const file = path.join(ctl.cur, `${key}.json`)
  argv.push('--reporter=default', '--reporter=json', `--outputFile.json=${file}`)
  let a = argv.slice(2)
  if (a[0] === 'run') a = a.slice(1)
  const id = `${slug}-${h8(a)}`
  try {
    fs.mkdirSync(ctl.cur, { recursive: true })
    fs.writeFileSync(path.join(ctl.cur, `${key}.meta`), JSON.stringify({ id, rel, args: orig, entry, node: process.version }))
  } catch {}
})()
