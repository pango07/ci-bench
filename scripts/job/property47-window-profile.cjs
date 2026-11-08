'use strict'
// Evidence policy only. This selector cannot authenticate a cache receipt or
// change the original Vitest selection. Runtime admission remains independent.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const DEFAULT_PROFILE = 'reviewed-original-c11-108-instances-v1-research'
const PROPERTY47_PROFILE = 'reviewed-original-property47-single-instance-v1-research'
const PROPERTY47_SELECTOR_SHA = '840ef60f36368ace3edb40a23d6984d0366c6a9a89a3f4d8d5d34c7a46bc3fce'
const PROPERTY47_TARGET = Object.freeze({
  instanceId: 'ccda7135f8d1ede102763427b3efabcef8130aaed24822ce92a5ec7ef94a05b3',
  project: 'convex-helpers', file: 'packages/convex-helpers/server/stream.property.test.ts', pool: 'forks',
})
const tuple = row => [row.instanceId, row.project, row.file, row.pool]
const PROPERTY47_VALUE = Object.freeze({schema: 'quod-managed-matrix-candidate-profile-v1-research',
  label: PROPERTY47_PROFILE, roster: Object.freeze([PROPERTY47_TARGET]),
  rosterSha256: crypto.createHash('sha256').update(JSON.stringify([tuple(PROPERTY47_TARGET)])).digest('hex')})
function resolveWindowProfile(label = DEFAULT_PROFILE) {
  assert(typeof label === 'string' && [DEFAULT_PROFILE, PROPERTY47_PROFILE].includes(label), 'unknown closed window candidate profile')
  const property47 = label === PROPERTY47_PROFILE
  return {label, property47, branchPrefix: property47 ? 'property47-wj' : 'matrix-wj',
    namespacePrefix: property47 ? 'property47' : 'matrix',
    managedMode: property47 ? 'matrix-property47' : 'matrix-research',
    controlMode: property47 ? 'matrix-property47-control' : 'matrix-control'}
}
function property47Evidence({event, dispatch, logical}) {
  assert.equal(event.cacheTransport.scopeInput.candidateProfile, PROPERTY47_PROFILE, 'collection scope must bind property47')
  assert.equal(dispatch.candidatePolicy, PROPERTY47_PROFILE)
  assert.deepEqual(dispatch.candidateProfile, PROPERTY47_VALUE, 'runtime profile roster differs')
  assert.deepEqual(dispatch.supervisorPolicy.candidateProfile, PROPERTY47_VALUE, 'execution policy must bind the finite roster')
  assert.equal(dispatch.supervisorPolicy.candidateProfileSelectorSha256, PROPERTY47_SELECTOR_SHA)
  assert.deepEqual(dispatch.selectedScope, {kind: 'complete-original-default-selection', files: null})
  assert.equal(dispatch.selectedInstances, 120); assert.equal(dispatch.candidateInstances, 1)
  assert.equal(dispatch.initialOrdinaryInstances, 119); assert.equal(dispatch.fullJobHit, false)
  const candidates = dispatch.instances.filter(row => row.candidate)
  assert.equal(dispatch.instances.length, 120); assert.equal(candidates.length, 1)
  assert.equal(new Set(dispatch.instances.map(row => row.instanceId)).size, 120)
  assert.deepEqual(tuple(candidates[0]), tuple(PROPERTY47_TARGET), 'different managed candidate identity')
  assert.equal(logical.files.length, 120)
  const selected = logical.files.filter(row => row.instanceId === PROPERTY47_TARGET.instanceId)
  assert.equal(selected.length, 1); assert.deepEqual(tuple(selected[0]), tuple(PROPERTY47_TARGET))
  const rows = logical.rows.filter(row => row.project === PROPERTY47_TARGET.project && row.file === PROPERTY47_TARGET.file && row.pool === PROPERTY47_TARGET.pool)
  assert.equal(rows.length, 47, 'all original property states must remain present')
  for (const key of ['exitCode', 'fullJobHit', 'selectedInstances', 'candidateInstances', 'replayedInstances',
    'skippedCompilations', 'managedExecutions', 'nativeSpecsExecuted', 'ordinaryInstances', 'recordedReceipts',
    'stickyManagedFailure', 'logicalSha256', 'logicalStates']) assert.equal(dispatch[key], event[key], 'summary/dispatch mismatch: ' + key)
  for (const key of ['replayedInstances', 'skippedCompilations', 'managedExecutions', 'recordedReceipts'])
    assert(Number.isSafeInteger(event[key]) && event[key] >= 0 && event[key] <= 1, 'invalid finite property count: ' + key)
  assert.equal(event.replayedInstances + event.nativeSpecsExecuted, 120)
  assert(event.replayedInstances + event.managedExecutions <= 1)
  assert(event.skippedCompilations <= event.replayedInstances)
  return PROPERTY47_VALUE
}
module.exports = {DEFAULT_PROFILE, PROPERTY47_PROFILE, PROPERTY47_SELECTOR_SHA, PROPERTY47_TARGET, PROPERTY47_VALUE,
  resolveWindowProfile, property47Evidence}
