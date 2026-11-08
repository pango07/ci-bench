'use strict'
// Remote coordinator prerequisites only. Synthetic evidence is never SDK or
// receipt authority; the original parser/report fixture file stays unchanged.
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {pathToFileURL} = require('node:url')
const {DEFAULT_PROFILE, PROPERTY47_PROFILE, PROPERTY47_TARGET, PROPERTY47_VALUE, PROPERTY47_SELECTOR_SHA,
  resolveWindowProfile, property47Evidence} = require('./property47-window-profile.cjs')
const {sha} = require('./matrix-evidence.cjs')
const copy = value => JSON.parse(JSON.stringify(value))
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'managed-window.json')))
const release = ['cancelled 0', 'fail 0', 'pass 20', 'skipped 0', 'tests 20', 'todo 0']

function admissionFixture(hit = false) {
  const files = [copy(PROPERTY47_TARGET), ...Array.from({length: 119}, (_, i) => ({instanceId: String(i + 1).padStart(64, '0'),
    project: 'ordinary-' + i, file: 'server/ordinary-' + i + '.test.ts', pool: 'forks'}))]
  const dispatch = {selectedScope: {kind: 'complete-original-default-selection', files: null},
    candidatePolicy: PROPERTY47_PROFILE, candidateProfile: copy(PROPERTY47_VALUE),
    supervisorPolicy: {candidateProfile: copy(PROPERTY47_VALUE), candidateProfileSelectorSha256: PROPERTY47_SELECTOR_SHA},
    exitCode: 0, fullJobHit: false, selectedInstances: 120, candidateInstances: 1, initialOrdinaryInstances: 119,
    replayedInstances: Number(hit), skippedCompilations: Number(hit), managedExecutions: Number(!hit),
    nativeSpecsExecuted: hit ? 119 : 120, ordinaryInstances: 119, recordedReceipts: Number(!hit),
    stickyManagedFailure: false, logicalSha256: 'a'.repeat(64), logicalStates: 4131,
    instances: files.map((row, i) => ({...row, candidate: i === 0}))}
  const event = {...copy(dispatch), cacheTransport: {scopeInput: {candidateProfile: PROPERTY47_PROFILE}}}
  const logical = {files, rows: Array.from({length: 47}, (_, i) => ({...copy(PROPERTY47_TARGET), name: 'property ' + i, state: 'pass'}))}
  return {event, dispatch, logical}
}
test('window profile resolver accepts only the two primitive reviewed labels and preserves old108 defaults', () => {
  assert.equal(resolveWindowProfile().label, DEFAULT_PROFILE)
  assert.equal(resolveWindowProfile().managedMode, 'matrix-research')
  assert.equal(resolveWindowProfile().branchPrefix, 'matrix-wj')
  assert.equal(resolveWindowProfile(DEFAULT_PROFILE).controlMode, 'matrix-control')
  assert.equal(resolveWindowProfile(PROPERTY47_PROFILE).managedMode, 'matrix-property47')
  assert.equal(resolveWindowProfile(PROPERTY47_PROFILE).controlMode, 'matrix-property47-control')
  for (const value of [null, {}, [], new String(PROPERTY47_PROFILE), 47, '', 'property47', 'future'])
    assert.throws(() => resolveWindowProfile(value))
})
test('property evidence binds the exact one-instance roster and keeps full120 native cold or native119 hit', () => {
  for (const hit of [false, true]) assert.deepEqual(property47Evidence(admissionFixture(hit)), PROPERTY47_VALUE)
  assert.equal(PROPERTY47_VALUE.rosterSha256, sha(JSON.stringify([[PROPERTY47_TARGET.instanceId,
    PROPERTY47_TARGET.project, PROPERTY47_TARGET.file, PROPERTY47_TARGET.pool]])))
})
test('collection, keyed supervisor and actual selected candidate identities cannot cross profiles', () => {
  for (const mutate of [
    f => {f.event.cacheTransport.scopeInput.candidateProfile = DEFAULT_PROFILE},
    f => {f.dispatch.candidatePolicy = DEFAULT_PROFILE},
    f => {f.dispatch.candidateProfile.roster[0].project = 'foreign'},
    f => {f.dispatch.supervisorPolicy.candidateProfile.rosterSha256 = '0'.repeat(64)},
    f => {f.dispatch.supervisorPolicy.candidateProfileSelectorSha256 = '0'.repeat(64)},
    f => {f.dispatch.instances[0].instanceId = '0'.repeat(64)},
    f => {f.dispatch.instances[0].project = 'foreign'},
    f => {f.dispatch.instances[0].file = 'server/other.test.ts'},
    f => {f.dispatch.instances[0].pool = 'threads'},
    f => {f.dispatch.instances[1].candidate = true},
    f => {f.dispatch.instances[1].instanceId = f.dispatch.instances[0].instanceId},
  ]) {const fixture = admissionFixture(); mutate(fixture); assert.throws(() => property47Evidence(fixture))}
})
test('reduced scope, missing original47 states, mismatched summary and impossible reuse counts fail closed', () => {
  for (const mutate of [
    f => {f.dispatch.selectedScope.files = [PROPERTY47_TARGET.file]},
    f => {f.dispatch.selectedInstances = f.event.selectedInstances = 1},
    f => {f.dispatch.initialOrdinaryInstances = 0},
    f => {f.logical.files.pop()},
    f => {f.logical.rows.pop()},
    f => {f.logical.files[0].project = 'foreign'},
    f => {f.event.managedExecutions = 0},
    f => {f.event.replayedInstances = f.dispatch.replayedInstances = 2},
    f => {f.event.nativeSpecsExecuted = f.dispatch.nativeSpecsExecuted = 118},
    f => {f.event.skippedCompilations = f.dispatch.skippedCompilations = 1},
  ]) {const fixture = admissionFixture(); mutate(fixture); assert.throws(() => property47Evidence(fixture))}
})

function reportFixture() {
  const settings = {schema: 'quod-matrix-original-window-settings-v1', coordinatorRun: '777', harnessSha: 'a'.repeat(40),
    actionSha: 'b'.repeat(40), sourceSha: 'c'.repeat(40), runtimeArchiveSha256: 'd'.repeat(64), candidateProfile: PROPERTY47_PROFILE,
    cold: true, repeatFirst: false, commands: copy(manifest.commands)}
  const expected = [], rows = [], observedRuns = []
  let id = 1000
  for (const variant of ['floor', 'plain', 'managed-control', 'managed']) {
    const branch = `bench/property47-wj-777-convex-helpers-${variant}`, runs = []
    for (const known of manifest.commits) {
      const run = ++id, seconds = variant === 'plain' ? 120 : variant === 'managed' ? 30 : 60
      const start = '2026-11-07T00:00:00.000Z', end = new Date(Date.parse(start) + seconds * 1000).toISOString()
      const identity = {id: 'convex-helpers', variant, i: known.i, commit: known.sha}
      expected.push(identity); runs.push({id: run})
      const row = {...identity, run, branch, cacheNamespace: variant.startsWith('managed') ? `property47-777-convex-helpers-${variant}` : '',
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
          files: known.files, tests: known.tests, projectionSha256: 'e'.repeat(64), raw: {sha256: 'f'.repeat(64), bytes: 123},
          ordinarySemanticSha256: variant === 'plain' ? known.ordinarySemanticSha256 : null}
        if (variant !== 'plain') {
          const hit = variant === 'managed' && known.i > 0
          Object.assign(row.matrix.states, {strongLogicalSha256: '1'.repeat(64), fileStatesSha256: '2'.repeat(64),
            bridgeSummarySha256: '3'.repeat(64), candidateProfile: copy(PROPERTY47_VALUE), dispatchRaw: {sha256: '4'.repeat(64), bytes: 234},
            transport: {namespace: `property47-777-convex-helpers-${variant}-`, sdkRestoreEvents: variant === 'managed' ? 1 : 0,
              sdkSaveEvents: variant === 'managed' && !hit ? 1 : 0, entryEvents: Number(hit), restoreReason: hit ? 'hit' : 'miss'}})
          row.matrix.event = {schema: 'quod-managed-matrix-action-result-v1', mode: variant === 'managed' ? 'matrix-property47' : 'matrix-property47-control',
            exitCode: 0, fullJobHit: false, stickyManagedFailure: false, selectedScope: {kind: 'complete-original-default-selection'},
            selectedInstances: known.files, logicalStates: known.tests, logicalSha256: row.matrix.states.strongLogicalSha256,
            candidateInstances: 1, managedExecutions: Number(!hit), replayedInstances: Number(hit), nativeSpecsExecuted: hit ? 119 : 120,
            skippedCompilations: Number(hit), recordedReceipts: Number(variant === 'managed' && !hit),
            cacheTransport: {namespace: `property47-777-convex-helpers-${variant}-`, scopeInput: {runtimeArchiveSha256: settings.runtimeArchiveSha256,
              candidateProfile: PROPERTY47_PROFILE}}}
        }
      }
      rows.push(row)
    }
    observedRuns.push({branch, total_count: 12, workflow_runs: runs})
  }
  return {settings, expected, rows, observedRuns, manifest: copy(manifest)}
}
const reportModule = () => import(pathToFileURL(path.join(__dirname, 'matrix-report.mjs')).href)
test('property48 reporting retains complete API durations, per-job ceilings and the original manifest', async () => {
  const {buildMatrixReport} = await reportModule(), report = buildMatrixReport(reportFixture())
  assert.equal(report.passed, true, report.issues.join('\n'))
  assert.deepEqual(report.candidateProfile, PROPERTY47_VALUE)
  assert.equal(report.variants.managed.runnerSeconds, 360); assert.equal(report.variants.managed.modeledMinutes, 12)
  assert.equal(report.variants.managed.replayedInstances, 11); assert.equal(report.variants.managed.managedExecutions, 1)
  assert.equal(report.variants.managed.nativeSpecsExecuted, 120 + 11 * 119)
  assert.equal(report.fullJobHit, false); assert.match(report.independentArtifactAudit, /pending/)
  assert.equal(sha(fs.readFileSync(path.join(__dirname, 'managed-window.json'))), 'cda867393ad8d174a725a5cc74efd99557ce8531d690115200deebdf21a1b897')
})
test('property48 rejects cross-profile authority, extra candidates and changed native/control work', async () => {
  const {buildMatrixReport} = await reportModule()
  for (const mutate of [
    row => {row.matrix.event.mode = 'matrix-research'},
    row => {row.matrix.event.cacheTransport.scopeInput.candidateProfile = DEFAULT_PROFILE},
    row => {row.matrix.states.candidateProfile.roster[0].instanceId = '0'.repeat(64)},
    row => {row.matrix.states.dispatchRaw.sha256 = null},
    row => {row.matrix.event.candidateInstances = 108},
    row => {row.matrix.event.replayedInstances = 2},
    row => {row.matrix.event.nativeSpecsExecuted = 118},
    row => {row.branch = row.run_meta.head_branch = 'bench/matrix-wj-777-convex-helpers-managed'},
    row => {row.cacheNamespace = 'matrix-777-convex-helpers-managed'},
  ]) {
    const fixture = reportFixture(); mutate(fixture.rows.find(row => row.variant === 'managed' && row.i === 2))
    assert.equal(buildMatrixReport(fixture).passed, false)
  }
  const control = reportFixture(); control.rows.find(row => row.variant === 'managed-control').matrix.states.transport.sdkSaveEvents = 1
  assert.equal(buildMatrixReport(control).passed, false)
  const unknown = reportFixture(); unknown.settings.candidateProfile = {label: PROPERTY47_PROFILE}
  assert.equal(buildMatrixReport(unknown).passed, false)
})
test('pending Action pin prevents any child dispatch or branch write and preserves original command geometry', () => {
  const driver = fs.readFileSync(path.join(__dirname, 'matrix-drive.sh'), 'utf8')
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/bench-job-one.yml'), 'utf8')
  const input = /MATRIX_ACTION_SHA: '([a-f0-9]{40})'/.exec(workflow)[1]
  const uses = /uses: pango07\/quod-action@([a-f0-9]{40}) # MATRIX_ACTION_SHA/.exec(workflow)[1]
  assert.equal(uses, input)
  assert(driver.indexOf("!/^0+$/.test(action)") < driver.indexOf('gh api -X POST'))
  assert(driver.indexOf("!/^0+$/.test(action)") < driver.indexOf('gh workflow run'))
  assert(workflow.includes("'matrix-property47-control' || 'matrix-property47'"))
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_PRESERVE_SYMLINKS', 'NODE_COMPILE_CACHE', 'ESBUILD_BINARY_PATH'])
    assert(workflow.includes(key + ": ''"))
  assert.equal(manifest.count, 12); assert.deepEqual(manifest.variants, ['floor', 'plain', 'managed-control', 'managed'])
  assert.deepEqual(manifest.commands, {install: 'npm ci', build: 'npm run build', test: 'npm run test'})
})
