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
  if (workflow.includes('\n  native:\n')) {
    // The matrix investigation has two mutually exclusive measured job
    // definitions. Preserve the same original command steps, while checking
    // the explicit floor guards and plain JSON reporter separately.
    const native = workflow.split('\n  native:\n')[1].split('\n  matrix:\n')[0]
    const matrix = workflow.split('\n  matrix:\n')[1]
    assert(native && matrix, 'both measured variant definitions are required')
    assert.doesNotMatch(native, /uses: pango07\/quod-action@/)
    assert.equal((matrix.match(/uses: pango07\/quod-action@/g)||[]).length, 1)
    assert.match(native, /inputs\.variant == 'floor' \|\| inputs\.variant == 'plain'/)
    assert.match(matrix, /inputs\.variant == 'managed' \|\| inputs\.variant == 'managed-control'/)
    assert.match(native, /^    name: job$/m)
    assert.match(matrix, /^    name: job$/m)
    const steps = section => new Map(section.split(/^      - /m).slice(1).map(step => [step.split('\n')[0], step]))
    const plainSteps = steps(native), matrixSteps = steps(matrix)
    for (const title of ['name: checkout', 'name: verify original Node declaration',
      'uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'name: env']) {
      assert(plainSteps.has(title) && matrixSteps.has(title), 'missing common step: ' + title)
      assert.equal(matrixSteps.get(title), plainSteps.get(title), 'changed common step: ' + title)
    }
    for (const name of ['install', 'build', 'test']) {
      const title = 'name: ' + name, plain = plainSteps.get(title), managed = matrixSteps.get(title)
      assert(plain && managed, 'missing original command step: ' + name)
      assert.equal((plain.match(/^        if: inputs\.variant != 'floor'$/gm)||[]).length, 1)
      assert.doesNotMatch(managed, /^        if:/m)
      assert(plain.includes('CMD: ${{ fromJSON(inputs.cfg).' + name + ' }}'))
      let ordinary = plain.replace(/^        if: inputs\.variant != 'floor'\n/m, '')
      let controlled = managed
      if (name === 'test') {
        assert.equal((ordinary.match(/^          NODE_OPTIONS: --require=\$\{\{ runner\.temp \}\}\/bench-vitest-report\.cjs$/gm)||[]).length, 1)
        assert.equal((controlled.match(/^          NODE_OPTIONS: ''$/gm)||[]).length, 1)
        ordinary = ordinary.replace(/^          NODE_OPTIONS: --require=\$\{\{ runner\.temp \}\}\/bench-vitest-report\.cjs\n/m, '')
        controlled = controlled.replace(/^          NODE_OPTIONS: ''\n/m, '')
      }
      assert.equal(controlled, ordinary, 'original command step differs: ' + name)
    }
    return
  }
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
