'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const {fromLog} = require('./managed-evidence.cjs')
test('retains managed summaries and complete state counts', () => {
  const parsed=fromLog('2026-11-07T00:00:00.000Z QUOD_MANAGED_RESULT {"mode":"v0","hit":true}\n'+
    '2026-11-07T00:00:00.000Z QUOD_BENCH_STATES '+ 'a'.repeat(64)+' 120 4129\n')
  assert.deepEqual(parsed.events,[{mode:'v0',hit:true}])
  assert.deepEqual(parsed.states,{sha256:'a'.repeat(64),files:120,tests:4129})
})
test('keeps release-test tail multiplicity independently of Vitest display summaries',()=>{
  assert.deepEqual(fromLog(' Test Files 119 passed\nℹ tests 5\nℹ pass 5\nℹ fail 0\n').releaseSignature,['fail 0','pass 5','tests 5'])
})
test('does not accept ambiguous full-suite reports or malformed product evidence',()=>{
  const line='QUOD_BENCH_STATES '+'a'.repeat(64)+' 120 4129\n'
  assert.throws(()=>fromLog(line+line),/multiple full-suite/)
  assert.throws(()=>fromLog('QUOD_MANAGED_RESULT {truncated'),/JSON|property|Expected/)
})
