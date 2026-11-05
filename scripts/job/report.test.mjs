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
    const result = spawnSync(process.execPath, [new URL('./report.mjs', import.meta.url).pathname, input, dir], { encoding: 'utf8' })
    result.metrics = JSON.parse(fs.readFileSync(path.join(dir, 'job-metrics.json')))
    return result
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
test('complete agreeing comparisons pass', () => assert.equal(report([row('plain'), row('quod')]).status, 0))
test('repeated commits compare against their own window positions', () => {
  const p0 = row('plain'), q0 = row('quod')
  const p1 = {...row('plain', 'second invocation\n'), i:1}
  const q1 = {...row('quod', 'second invocation\n'), i:1}
  assert.equal(report([p0,q0,p1,q1]).status, 0)
  q0.sig = p1.sig
  assert.equal(report([p0,q0,p1,q1]).status, 1)
})
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

test('a unit witness makes a vitest replay only a partial hit', () => {
  const q = row('quod')
  q.quod = 'quod vitest: every file replays\nquod: `npm run build` recorded (first witness: 20 inputs)'
  assert.equal(report([row('plain'), q]).metrics.per.find(p=>p.variant==='quod').hit, 'partial')
})
test('lineage disagreements fail even when aggregate test lines happen to match', () => {
  const q = row('quod')
  q.quod = 'quod vitest: lineage: 0 promoted, 3 plain audits, 1 disagreed, 17 revoked'
  const r = report([row('plain'), q])
  assert.equal(r.status, 1)
  assert.equal(r.metrics.per.find(p=>p.variant==='quod').lineage.revoked, 17)
})

test('per-test evidence is mandatory when the job opted in', () => {
  const p=row('plain'), q=row('quod'); p.evidence=q.evidence=true
  p.semantic='abc'
  assert.equal(report([p,q]).status,1)
  q.semantic='abc'
  assert.equal(report([p,q]).status,0)
  q.semantic='different'
  assert.equal(report([p,q]).status,1)
})
