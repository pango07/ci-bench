// Who lists a directory in vitest's main process: `node --import diag.mjs
// node_modules/vitest/vitest.mjs run` with DIAG_DIR=<a path fragment>.
// Prints each listing of a matching path once, with the first frames
// outside node itself (so: the plugin, the resolver, or the config).
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const want = process.env.DIAG_DIR
const seen = new Set()
const log = (n, p) => {
  const s = String(p)
  if (!want || !s.includes(want)) return
  const frames = new Error().stack.split('\n').slice(3).map((l) => l.trim()).filter((l) => !l.includes('(node:') && !l.includes(' node:'))
  const key = `${n} ${s} <- ${frames.slice(0, 4).join(' | ')}`
  if (!seen.has(key)) {
    seen.add(key)
    process.stderr.write(`DIAG ${key}\n`)
  }
}
for (const [o, names] of [[fs, ['readdir', 'readdirSync', 'opendir', 'opendirSync']], [fs.promises, ['readdir', 'opendir']]]) {
  for (const n of names) {
    const f = o[n]
    o[n] = function (p, ...a) {
      try {
        log(n, p)
      } catch {}
      return f.call(this, p, ...a)
    }
  }
}
syncBuiltinESMExports()
