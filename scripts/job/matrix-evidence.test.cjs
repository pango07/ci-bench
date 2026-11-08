'use strict'
// Parser/report fixtures run only as the remote coordinator prerequisite.
// Synthetic cache bytes exercise evidence validation, never real authority.
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const {pathToFileURL} = require('node:url')
const {nativeEvidence, logicalEvidence, fromLog, transportEvidence, sort, sha} = require('./matrix-evidence.cjs')
const copy = value => JSON.parse(JSON.stringify(value))
const hash = value => sha(JSON.stringify(value))
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'managed-window.json')))
const release = ['cancelled 0', 'fail 0', 'pass 20', 'skipped 0', 'tests 20', 'todo 0']

function logicalFixture() {
  const files = ['zod-4.0', 'zod-4.1'].map((project, i) => ({instanceId: String(i + 1).repeat(64),
    project, file: 'server/shared.test.ts', pool: 'forks', name: 'server/shared.test.ts', state: i ? 'skip' : 'pass'}))
  const rows = [{project: files[0].project, file: files[0].file, pool: 'forks', name: 'suite repeated name', state: 'pass'},
    {project: files[0].project, file: files[0].file, pool: 'forks', name: 'suite repeated name', state: 'pass'},
    {project: files[1].project, file: files[1].file, pool: 'forks', name: 'suite optional', state: 'skip'}]
  return refresh({schema: 'quod-managed-matrix-input-logical-results-v1', files,
    instances: files.map(({instanceId, project, file, pool}) => ({instanceId, project, file, pool})), rows, exitCode: 0})
}
function refresh(report) {
  report.sha256 = hash(sort(report.rows.map(row => [row.project, row.file, row.pool, row.name, row.state])))
  return report
}
function nativeFixture(logical) {
  const states = {pass: 'passed', fail: 'failed', skip: 'skipped', todo: 'todo'}
  return {testResults: logical.files.map(file => ({name: '/repo/' + file.file,
    // Native all-skipped files may have status passed. Do not invent that
    // reporter field on the logical report merely to compare the two.
    status: 'passed', assertionResults: logical.rows.filter(row => row.project === file.project && row.file === file.file)
      .map(row => ({fullName: row.name, status: states[row.state]}))}))}
}

test('cross-mode projection preserves all names/states and duplicate file instances without native file metadata', () => {
  const logical = logicalFixture(), native = nativeFixture(logical)
  const a = logicalEvidence(logical), b = nativeEvidence(native, '/repo')
  assert.equal(a.files, 2); assert.equal(a.tests, 3)
  assert.equal(a.projectionSha256, b.projectionSha256)
  assert.notEqual(a.fileStatesSha256, null); assert.equal(b.fileStatesSha256, null)
  native.testResults.reverse(); native.testResults[1].assertionResults.reverse()
  assert.equal(nativeEvidence(native, '/repo').projectionSha256, b.projectionSha256)
})

test('project labels and actual logical file states have independent stronger fingerprints', () => {
  const a = logicalFixture(), original = logicalEvidence(a)
  const renamed = copy(a)
  for (const field of ['files', 'instances', 'rows']) for (const row of renamed[field]) row.project += '-renamed'
  const next = logicalEvidence(refresh(renamed))
  assert.equal(next.projectionSha256, original.projectionSha256)
  assert.notEqual(next.strongLogicalSha256, original.strongLogicalSha256)
  const changedFile = copy(a); changedFile.files[1].state = 'pass'
  const changed = logicalEvidence(changedFile)
  assert.equal(changed.projectionSha256, original.projectionSha256)
  assert.notEqual(changed.fileStatesSha256, original.fileStatesSha256)
})

test('renaming, changed states and removed duplicate tests cannot retain the projection', () => {
  const original = logicalEvidence(logicalFixture()).projectionSha256
  for (const kind of ['name', 'state', 'duplicate']) {
    const changed = logicalFixture()
    if (kind === 'name') changed.rows[0].name = 'different assertion'
    if (kind === 'state') changed.rows[0].state = 'fail'
    if (kind === 'duplicate') changed.rows.splice(0, 1)
    assert.notEqual(logicalEvidence(refresh(changed)).projectionSha256, original)
  }
})

test('unknown identities/states, stale digests and duplicate selected identities are rejected', () => {
  for (const mutate of [
    report => {report.rows[0].project = 'foreign'},
    report => {report.rows[0].state = 'mystery'},
    report => {report.files[0].file = '../outside.test.ts'},
    report => {report.instances.pop()},
    report => {report.files[1] = copy(report.files[0])},
    report => {report.rows[0].name = 'stale digest'}
  ]) {
    const report = logicalFixture(); mutate(report)
    assert.throws(() => logicalEvidence(report))
  }
  const native = nativeFixture(logicalFixture()); native.testResults[0].assertionResults[0].status = 'unknown'
  assert.throws(() => nativeEvidence(native, '/repo'))
})

test('only one actual bridge marker may bind one retained summary; release multiplicity is retained', () => {
  const event = {schema: 'fixture', exitCode: 0}, states = {bridgeSummarySha256: hash(event)}
  const text = '2026-11-07T00:00:00.000Z QUOD_MANAGED_MATRIX_INPUT_RESULT ' + JSON.stringify(event) + '\n' +
    'QUOD_BENCH_MATRIX_STATES ' + JSON.stringify(states) + '\n' + release.map(row => '# ' + row).join('\n')
  assert.deepEqual(fromLog(text), {event, states, releaseSignature: release, invalid: false})
  assert.equal(fromLog(text + '\nℹ tests 20').releaseSignature.filter(row => row === 'tests 20').length, 2)
  assert.throws(() => fromLog(text + '\nQUOD_MANAGED_MATRIX_INPUT_RESULT ' + JSON.stringify(event)))
  assert.throws(() => fromLog('QUOD_BENCH_MATRIX_STATES {broken'))
  assert.throws(() => fromLog(text.replace(hash(event), 'a'.repeat(64))))
})

function transportFixture(t, {reason = 'hit', namespace = 'fixture-cold', control = false} = {}) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-evidence-')))
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}))
  const execution = path.join(temporary, 'quod/matrix-run-abc123'), out = path.join(temporary, 'out')
  fs.mkdirSync(execution, {recursive: true}); fs.mkdirSync(out)
  const scopeInput = {fixture: true}, scope = hash(scopeInput), receipt = Buffer.from('synthetic receipt bytes')
  const entry = {executionKey: 'a'.repeat(64), receiptSha256: sha(receipt), receiptBase64: receipt.toString('base64')}
  const pack = Buffer.from(JSON.stringify({schema: 'quod-managed-collection-v1', scope, entries: [entry]}) + '\n')
  const key = 'quod-managed-collection-v1-' + namespace + '-' + scope + '-' + sha(pack)
  const records = control ? [] : [{operation: 'collection-restore', reason,
    ...(reason === 'hit' ? {matchedServiceKey: key, collectionSha256: sha(pack), entries: 1} : {})}]
  if (!control && reason === 'hit') records.push({operation: 'collection-entry', matchedServiceKey: key,
    collectionSha256: sha(pack), executionKey: entry.executionKey, receiptSha256: entry.receiptSha256})
  const file = path.join(execution, 'cache-transport.json')
  fs.writeFileSync(file, JSON.stringify({schema: 'quod-managed-matrix-action-cache-v1', events: records}))
  const event = {evidenceDirectory: execution, cacheTransport: {file, scope, scopeInput, namespace: namespace + '-'},
    replayedInstances: !control && reason === 'hit' ? 1 : 0, retainedCollections: {}}
  if (!control && reason === 'hit') {
    const retained = path.join(execution, 'restored-collection.json'); fs.writeFileSync(retained, pack)
    event.retainedCollections.restored = {file: retained, sha256: sha(pack), bytes: pack.length, serviceKey: key}
  }
  return {event, temporary, out, namespace, variant: control ? 'managed-control' : 'managed', records, pack}
}
test('retained packs bind actual returned key, namespace, whole bytes and per-entry bytes', t => {
  const fixture = transportFixture(t), result = transportEvidence(fixture)
  assert.equal(result.sdkRestoreEvents, 1); assert.equal(result.sdkSaveEvents, 0)
  assert.equal(result.entryEvents, 1); assert.equal(result.packs.restored.sha256, sha(fixture.pack))
  assert(fs.readFileSync(path.join(fixture.out, 'restored-collection.json')).equals(fixture.pack))
})
test('control has no SDK events; wrong namespace, missing pack and forged receipt metadata are rejected', t => {
  const control = transportFixture(t, {control: true})
  assert.equal(transportEvidence(control).sdkRestoreEvents, 0)
  for (const kind of ['namespace', 'missing-pack', 'receipt', 'control-event']) {
    const f = transportFixture(t)
    if (kind === 'namespace') f.namespace = 'different-cold'
    if (kind === 'missing-pack') f.event.retainedCollections = {}
    if (kind === 'receipt') {
      f.records[1].receiptSha256 = 'f'.repeat(64)
      fs.writeFileSync(f.event.cacheTransport.file, JSON.stringify({schema: 'quod-managed-matrix-action-cache-v1', events: f.records}))
    }
    if (kind === 'control-event') f.variant = 'managed-control'
    assert.throws(() => transportEvidence(f))
  }
})

function reportFixture() {
  const settings = {schema: 'quod-matrix-original-window-settings-v1', coordinatorRun: '777', harnessSha: 'a'.repeat(40),
    actionSha: 'b'.repeat(40), sourceSha: 'c'.repeat(40), runtimeArchiveSha256: 'd'.repeat(64),
    cold: true, repeatFirst: false, commands: copy(manifest.commands)}
  const expected = [], rows = [], observedRuns = []
  let id = 1000
  for (const variant of ['floor', 'plain', 'managed-control', 'managed']) {
    const branch = `bench/matrix-wj-${settings.coordinatorRun}-convex-helpers-${variant}`, runs = []
    for (const known of manifest.commits) {
      const run = ++id, seconds = variant === 'plain' ? 120 : variant === 'managed' ? 30 : 60
      const start = '2026-11-07T00:00:00.000Z', end = new Date(Date.parse(start) + seconds * 1000).toISOString()
      const identity = {id: 'convex-helpers', variant, i: known.i, commit: known.sha}
      expected.push(identity); runs.push({id: run})
      const row = {...identity, run, branch, cacheNamespace: variant.startsWith('managed') ? `matrix-777-convex-helpers-${variant}` : '',
        run_meta: {id: run, head_branch: branch, head_sha: settings.harnessSha, event: 'workflow_dispatch', run_attempt: 1,
          path: '.github/workflows/bench-job-one.yml', conclusion: 'success'}, image: 'ubuntu/fixture',
        job: {id: run + 10000, status: 'completed', conclusion: 'success', created_at: start, started_at: start, completed_at: end,
          steps: [{name: 'Set up job', conclusion: 'success', started_at: start, completed_at: start},
            ...['install', 'build', 'test'].map(name => ({name, conclusion: variant === 'floor' ? 'skipped' : 'success', started_at: start, completed_at: end}))]},
        matrix: {event: null, states: null, releaseSignature: [], invalid: false}}
      if (variant !== 'floor') {
        row.matrix.releaseSignature = known.releaseTests ? [...release] : []
        row.matrix.states = {schema: 'quod-matrix-window-evidence-v1', variant, commit: known.sha,
          harnessSha: settings.harnessSha, actionSha: settings.actionSha, sourceSha: settings.sourceSha,
          files: known.files, tests: known.tests, projectionSha256: 'e'.repeat(64),
          raw: {sha256: 'f'.repeat(64), bytes: 123},
          ordinarySemanticSha256: variant === 'plain' ? known.ordinarySemanticSha256 : null}
        if (variant !== 'plain') {
          const hit = variant === 'managed' && known.i > 0
          Object.assign(row.matrix.states, {strongLogicalSha256: '1'.repeat(64), fileStatesSha256: '2'.repeat(64),
            bridgeSummarySha256: '3'.repeat(64), transport: {namespace: `matrix-777-convex-helpers-${variant}-`, sdkRestoreEvents: variant === 'managed' ? 1 : 0,
              sdkSaveEvents: variant === 'managed' && !hit ? 1 : 0, entryEvents: hit ? 108 : 0, restoreReason: hit ? 'hit' : 'miss'}})
          row.matrix.event = {schema: 'quod-managed-matrix-action-result-v1', mode: variant === 'managed' ? 'matrix-research' : 'matrix-control',
            exitCode: 0, fullJobHit: false, stickyManagedFailure: false, selectedScope: {kind: 'complete-original-default-selection'},
            selectedInstances: known.files, logicalStates: known.tests, logicalSha256: row.matrix.states.strongLogicalSha256,
            candidateInstances: 108, managedExecutions: hit ? 0 : 108, replayedInstances: hit ? 108 : 0,
            nativeSpecsExecuted: hit ? 12 : 120, skippedCompilations: hit ? 108 : 0,
            recordedReceipts: variant === 'managed' && !hit ? 108 : 0,
            cacheTransport: {namespace: `matrix-777-convex-helpers-${variant}-`, scopeInput: {runtimeArchiveSha256: settings.runtimeArchiveSha256}}}
        }
      }
      rows.push(row)
    }
    observedRuns.push({branch, total_count: 12, workflow_runs: runs})
  }
  return {settings, expected, rows, observedRuns, manifest: copy(manifest)}
}
const reportModule = () => import(pathToFileURL(path.join(__dirname, 'matrix-report.mjs')).href)
test('complete original48 report uses API job durations, per-job ceilings and separate fresh/prior bars', async () => {
  const {buildMatrixReport} = await reportModule(), report = buildMatrixReport(reportFixture())
  assert.equal(report.passed, true, report.issues.join('\n'))
  assert.equal(report.variants.managed.runnerSeconds, 360)
  assert.equal(report.variants.managed.modeledMinutes, 12)
  assert.equal(report.variants.plain.runnerSeconds, 1440)
  assert.equal(report.variants.plain.modeledMinutes, 24)
  assert.deepEqual(report.objectives, {evaluable: true, runnerSeconds: {halfFresh: true, halfPrior: true},
    modeledMinutes: {halfFresh: true, halfPrior: true}})
  assert.equal(report.fullJobHit, false)
  assert.match(report.independentArtifactAudit, /pending/)
  const boundary = reportFixture(), measured = boundary.rows.filter(row => row.variant === 'managed')
  measured[0].job.completed_at = '2026-11-07T00:01:01.000Z'
  const next = buildMatrixReport(boundary)
  assert.equal(next.variants.managed.modeledMinutes, 13)
})

test('missing/duplicate jobs, orphan executions and changed commands or frozen native state fail closed', async () => {
  const {buildMatrixReport} = await reportModule()
  for (const mutate of [
    data => data.rows.pop(),
    data => {data.rows[1] = copy(data.rows[0])},
    data => {data.observedRuns[0].total_count++},
    data => {data.observedRuns[0].workflow_runs[0].id = 999999},
    data => {data.settings.commands.test = 'reduced test command'},
    data => {data.settings.actionSha = '0'.repeat(40)},
    data => {data.rows.find(row => row.variant === 'plain').matrix.states.ordinarySemanticSha256 = '9'.repeat(64)}
  ]) {
    const fixture = reportFixture(); mutate(fixture)
    const result = buildMatrixReport(fixture)
    assert.equal(result.passed, false); assert.equal(result.objectives.evaluable, false)
    assert.equal(result.objectives.modeledMinutes.halfFresh, null)
  }
})

test('native projection, strong project/file states, cold namespace and release tail are independently required', async () => {
  const {buildMatrixReport} = await reportModule()
  for (const mutate of [
    row => {row.matrix.states.projectionSha256 = '9'.repeat(64)},
    row => {row.matrix.states.fileStatesSha256 = '9'.repeat(64)},
    row => {row.matrix.states.strongLogicalSha256 = row.matrix.event.logicalSha256 = '9'.repeat(64)},
    row => {row.cacheNamespace = 'warm-previous-run'},
    row => {row.matrix.event.cacheTransport.namespace = 'actual-different-namespace-'},
    row => {row.matrix.event.cacheTransport.scopeInput.runtimeArchiveSha256 = '9'.repeat(64)},
    row => {row.matrix.releaseSignature.pop()},
    row => {row.matrix.event.nativeSpecsExecuted = 11}
  ]) {
    const fixture = reportFixture(), row = fixture.rows.find(row => row.variant === 'managed' && row.i === 2)
    mutate(row); assert.equal(buildMatrixReport(fixture).passed, false)
  }
  const fixture = reportFixture(), control = fixture.rows.find(row => row.variant === 'managed-control')
  control.matrix.states.transport.sdkRestoreEvents = 1
  assert.equal(buildMatrixReport(fixture).passed, false)
})
