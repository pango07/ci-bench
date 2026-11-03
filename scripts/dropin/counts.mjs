// vitest's own end-of-run summary lines in a test step's log, summed over
// every vitest run in it: "Test Files  3 failed | 40 passed (43)" and
// "Tests  2 failed | 300 passed | 4 skipped (306)". For runs whose JSON
// reporter wrote nothing (the witness binaries' inline recording run), the
// plain and Quod runs are compared at this level: each state's count.
//   node counts.mjs <log>   -> {"files":{...},"tests":{...},"runs":n}
import fs from 'node:fs'
const t = fs.readFileSync(process.argv[2], 'utf8').replace(/\x1b\[[0-9;]*m/g, '')
const out = { files: {}, tests: {}, runs: 0 }
for (const m of t.matchAll(/^\s*(Test Files|Tests)\s+(.+?)\s*\((\d+)\)\s*$/gm)) {
  const k = m[1] === 'Tests' ? 'tests' : 'files'
  if (k === 'files') out.runs++
  for (const p of m[2].split('|')) {
    const q = p.trim().match(/^(\d+)\s+(\w+)/)
    if (q) out[k][q[2]] = (out[k][q[2]] ?? 0) + +q[1]
  }
  out[k].total = (out[k].total ?? 0) + +m[3]
}
console.log(JSON.stringify(out))
