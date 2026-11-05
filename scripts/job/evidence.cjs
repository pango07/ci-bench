'use strict'
const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
function states(report, root) {
  if (!Array.isArray(report.testResults) || !report.testResults.length) throw Error('missing Vitest test results')
  const rows = report.testResults.map(file => {
    if (typeof file.name !== 'string' || !Array.isArray(file.assertionResults)) throw Error('incomplete Vitest file evidence')
    const tests = file.assertionResults.map(a => {
      if (typeof a.fullName !== 'string' || typeof a.status !== 'string') throw Error('incomplete test evidence')
      return [a.fullName, a.status]
    }).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return [path.relative(root, file.name), file.status, tests]
  }).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return { hash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'), files: rows.length, tests: rows.reduce((n,r)=>n+r[2].length,0) }
}
if (require.main === module) {
  const result = states(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), process.argv[3])
  console.log(`QUOD_BENCH_STATES ${result.hash} ${result.files} ${result.tests}`)
}
module.exports = { states }
