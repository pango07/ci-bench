'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { selectJob } = require('./select-job.cjs')
const ran = { id:42, status:'completed', conclusion:'success', steps:[{name:'test',conclusion:'success'}] }
const skipped = { id:41, status:'completed', conclusion:'skipped', steps:[] }
test('finds the measured job regardless of skipped job order', () => {
  for (const jobs of [[ran,skipped],[skipped,ran],[skipped,ran,skipped]]) assert.deepEqual(selectJob({jobs}).jobs,[ran])
})
test('retains failed jobs so correctness comparison cannot hide a failure', () => {
  const failed={...ran,conclusion:'failure'}
  assert.deepEqual(selectJob({jobs:[skipped,failed]}).jobs,[failed])
})
test('refuses absent, ambiguous, unfinished or incomplete evidence', () => {
  for (const response of [null,{}, {jobs:[]}, {jobs:[skipped]}, {jobs:[ran,ran]}, {jobs:[{...ran,status:'in_progress'}]}, {jobs:[{...ran,conclusion:''}]}, {jobs:[{...ran,steps:[]}]}]) assert.throws(()=>selectJob(response))
})
test('plain and floor never prepare Quod; variant jobs preserve the same common steps', () => {
  const fs = require('node:fs'), path = require('node:path')
  const workflow = fs.readFileSync(path.join(__dirname,'../../.github/workflows/bench-job-one.yml'),'utf8')
  const plain = workflow.split('\n  job:\n')[1].split('\n  quod:\n')[0]
  const quod = workflow.split('\n  quod:\n')[1].split('\n  shipped:\n')[0]
  const shipped = workflow.split('\n  shipped:\n')[1]
  assert.doesNotMatch(plain, /uses: pango07\/quod-action@/)
  assert.equal((quod.match(/uses: pango07\/quod-action@/g)||[]).length,1)
  assert.equal((shipped.match(/uses: pango07\/quod-action@/g)||[]).length,1)
  const steps = section => section.split(/^      - /m).slice(1)
    .filter(step => !step.startsWith('name: quod'))
    .map(step => step.split('\n').filter(line=>line.trim()&&!line.trim().startsWith('#')).join('\n'))
  assert.deepEqual(steps(quod),steps(plain))
  assert.deepEqual(steps(shipped),steps(plain))
})
