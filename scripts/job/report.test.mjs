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
function report(rows, expected, settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quod-report-'))
  try {
    const input = path.join(dir, 'jobs.jsonl')
    fs.writeFileSync(input, rows.map(JSON.stringify).join('\n'))
    if (expected) fs.writeFileSync(path.join(dir, 'expected.jsonl'), expected.map(JSON.stringify).join('\n'))
    if(settings)fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify(settings))
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

function managedWindow() {
  const manifest=JSON.parse(fs.readFileSync(new URL('./managed-window.json',import.meta.url)))
  const settings={managedWindow:true,cold:true,repeatFirst:false,harnessSha:'1'.repeat(40),actionSha:'2'.repeat(40)}
  const variants=['floor','plain','managed-control','managed'],rows=[]
  for(const commit of manifest.commits)for(const [v,variant]of variants.entries()) {
    const r={...row(variant),id:'convex-helpers',i:commit.i,commit:commit.sha,run:1000+commit.i*4+v,
      image:'ubuntu-26.04/20261101.186.1',run_meta:{conclusion:'success',head_sha:settings.harnessSha},
      job:{...row(variant).job,id:2000+commit.i*4+v},semantic:commit.ordinarySemanticSha256,
      cacheNamespace:variant.startsWith('managed')?'managed-test-'+variant:'',
      managed:{invalid:false,events:[],states:{sha256:commit.ordinarySemanticSha256,files:120,tests:commit.tests},
        releaseSignature:commit.i>=2?['cancelled 0','fail 0','pass 5','skipped 0','tests 5','todo 0']:[]}}
    if(variant.startsWith('managed'))r.managed.events=[{mode:variant==='managed-control'?'control':'v0',hit:variant==='managed'&&commit.i>0,
      managedExecutions:variant==='managed'&&commit.i>0?0:1,fallback:false,effectsSha256:'a'.repeat(64),executionKey:'b'.repeat(64),
      nativeFingerprintSha256:'c'.repeat(64),runtimeClassSha256:'d'.repeat(64),ordinary:{exitCode:0}}]
    rows.push(r)
  }
  return{rows,settings}
}
test('the complete original managed window compares all merged states and independent effects',()=>{
  const {rows,settings}=managedWindow();const result=report(rows,rows,settings)
  assert.equal(result.status,0,result.stderr)
  assert.equal(result.metrics.managedExperiment.variants.managed.candidateReplays,11)
  assert.equal(result.metrics.managedExperiment.variants.managed.fullJobHits,0)
})
test('managed display-summary differences do not mask or invent merged result differences',()=>{
  const {rows,settings}=managedWindow();const managed=rows.find(row=>row.variant==='managed')
  managed.sig='split reporter summary differs\n'
  assert.equal(report(rows,rows,settings).status,0)
  managed.semantic='f'.repeat(64)
  assert.equal(report(rows,rows,settings).status,1)
})
test('candidate effect disagreement and an omitted release-test tail fail the window',()=>{
  const {rows,settings}=managedWindow();const managed=rows.find(row=>row.variant==='managed'&&row.i===2)
  managed.managed.events[0].effectsSha256='e'.repeat(64)
  assert.equal(report(rows,rows,settings).status,1)
  managed.managed.events[0].effectsSha256='a'.repeat(64);managed.managed.releaseSignature=[]
  assert.equal(report(rows,rows,settings).status,1)
})
