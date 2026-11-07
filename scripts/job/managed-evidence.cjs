// Parse retained product summaries; this file never runs project tests.
'use strict'
const fs = require('node:fs')
const assert = require('node:assert/strict')
function fromLog(text) {
  const events = [], states = [], releaseSignature = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[0-9TZ:.-]+ /, '').replace(/\u001b\[[0-9;]*m/g, '')
    if (line.startsWith('QUOD_MANAGED_RESULT ')) {
      const event = JSON.parse(line.slice('QUOD_MANAGED_RESULT '.length))
      assert(event && typeof event === 'object' && !Array.isArray(event), 'invalid managed product evidence')
      events.push(event)
    }
    const match = /^QUOD_BENCH_STATES ([a-f0-9]{64}) (\d+) (\d+)$/.exec(line)
    if (match) states.push({sha256: match[1], files: Number(match[2]), tests: Number(match[3])})
    if (/^(?:# |ℹ )(?:tests|pass|fail|cancelled|skipped|todo) \d+$/.test(line)) releaseSignature.push(line.replace(/^(?:# |ℹ )/, ''))
  }
  assert(states.length <= 1, 'multiple full-suite evidence fingerprints')
  return {events, states: states[0] || null, releaseSignature: releaseSignature.sort(), invalid: false}
}
module.exports = {fromLog}
if (require.main === module) {
  try {
    const [mode, file, actual] = process.argv.slice(2)
    if (mode === 'log') process.stdout.write(JSON.stringify(fromLog(fs.readFileSync(file, 'utf8'))))
    else if (mode === 'verify-window') {
      const expected = JSON.parse(fs.readFileSync(file, 'utf8'))
      const commits = fs.readFileSync(actual, 'utf8').trim().split('\n')
      assert.equal(expected.schema, 'quod-managed-original-window-v1')
      assert.equal(expected.repeatFirst, false); assert.equal(expected.cold, true)
      assert.deepEqual(commits, expected.commits.map(row => row.sha), 'different original cold 12-commit window')
    } else throw Error('usage: managed-evidence.cjs log LOG | verify-window MANIFEST COMMITS')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
