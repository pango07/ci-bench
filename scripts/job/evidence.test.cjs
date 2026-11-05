const { test } = require('node:test')
const assert = require('node:assert/strict')
const { states } = require('./evidence.cjs')
const fixture = () => ({ testResults: [{ name: '/repo/a.test.ts', status: 'passed', assertionResults: [{ fullName: 'one', status: 'passed' }, { fullName: 'two', status: 'passed' }] }] })
test('test states compare independently of durations and execution order', () => {
  const a = fixture(), b = fixture()
  b.testResults[0].duration = 999
  b.testResults[0].assertionResults.reverse()
  assert.deepEqual(states(a, '/repo'), states(b, '/repo'))
})
test('swapped states, renamed tests, and duplicate tests change the fingerprint', () => {
  const original = states(fixture(), '/repo').hash
  for (const kind of ['state','name','duplicate']) {
    const r = fixture(), a = r.testResults[0].assertionResults
    if (kind === 'state') a[0].status = 'failed'
    if (kind === 'name') a[0].fullName = 'renamed'
    if (kind === 'duplicate') a.push(a[0])
    assert.notEqual(states(r,'/repo').hash, original)
  }
})
test('missing evidence fails closed', () => assert.throws(()=>states({}, '/repo')))
