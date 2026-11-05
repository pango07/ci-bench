import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const row = (variant, sig = 'test passed\ntest passed\n') => ({
  id: 'fixture', variant, i: 0, commit: 'abc', run: 1, sig, quod: '',
  job: { created_at: '2026-11-05T00:00:00Z', started_at: '2026-11-05T00:00:00Z', completed_at: '2026-11-05T00:00:10Z', conclusion: 'success', steps: [] },
})
function report(rows, expected) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quod-report-'))
  try {
    const input = path.join(dir, 'jobs.jsonl')
    fs.writeFileSync(input, rows.map(JSON.stringify).join('\n'))
    if (expected) fs.writeFileSync(path.join(dir, 'expected.jsonl'), expected.map(JSON.stringify).join('\n'))
    return spawnSync(process.execPath, [new URL('./report.mjs', import.meta.url).pathname, input, dir], { encoding: 'utf8' })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
test('complete agreeing comparisons pass', () => assert.equal(report([row('plain'), row('quod')]).status, 0))
test('missing logs fail verification', () => {
  const result = report([row('plain'), row('quod', '')])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /1 unchecked/)
})
test('duplicate test lines retain their counts', () => {
  const result = report([row('plain'), row('quod', 'test passed\n')])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /1 wrong/)
})
test('an omitted dispatched job fails verification', () => {
  const result = report([row('plain')], [row('plain'), row('quod')])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /1 missing jobs/)
})
test('job conclusion differences fail verification', () => {
  const q = row('quod'); q.job.conclusion = 'failure'
  assert.equal(report([row('plain'), q]).status, 1)
})
