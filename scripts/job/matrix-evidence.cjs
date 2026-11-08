'use strict'
// Full logical comparisons are intentionally separate from native JSON metadata.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const {states: ordinaryStates} = require('./evidence.cjs')
const MAX_BYTES = 32 * 1024 * 1024, MAX_LOG = 128 * 1024 * 1024
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const fullSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value)
const sort = rows => rows.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0)
const state = value => ({passed: 'pass', failed: 'fail', skipped: 'skip', todo: 'todo', pending: 'pending'})[value]
const relative = value => {
  assert(typeof value === 'string' && value && !path.isAbsolute(value) && !value.includes('\\') &&
    !value.split('/').some(part => !part || part === '.' || part === '..'), 'relative logical project file required')
  return value
}
const stable = value => JSON.stringify((function visit(item) {
  if (item === null || typeof item !== 'object') return item
  if (Array.isArray(item)) return item.map(visit)
  return Object.fromEntries(Object.keys(item).sort().map(key => [key, visit(item[key])]))
})(value))
function readRegular(file) {
  const before = fs.lstatSync(file)
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= MAX_BYTES, 'bounded regular evidence required')
  const bytes = fs.readFileSync(file)
  assert.equal(bytes.length, before.size)
  return {bytes, data: JSON.parse(bytes.toString('utf8')), sha256: sha(bytes)}
}
function nativeEvidence(report, root) {
  const ordinary = ordinaryStates(report, root)
  const groups = report.testResults.map(file => {
    const name = relative(path.relative(root, file.name).split(path.sep).join('/'))
    return [name, sort(file.assertionResults.map(row => {
      assert(typeof row.fullName === 'string' && state(row.status), 'unknown native test state')
      return [row.fullName, state(row.status)]
    }))]
  })
  const projection = sort(groups)
  return {files: groups.length, tests: ordinary.tests, ordinarySemanticSha256: ordinary.hash,
    projectionSha256: sha(JSON.stringify(projection)), strongLogicalSha256: null, fileStatesSha256: null,
    fidelity: 'native complete JSON fingerprint plus file/name/state projection; native JSON has no project labels'}
}
function logicalEvidence(report) {
  assert.equal(report.schema, 'quod-managed-matrix-input-logical-results-v1')
  assert(Array.isArray(report.files) && Array.isArray(report.rows) && Array.isArray(report.instances), 'complete logical arrays required')
  assert.equal(report.files.length, report.instances.length)
  assert([0, 1].includes(report.exitCode), 'complete logical exit required')
  const groups = new Map(), ids = new Set(), fileStates = []
  for (const file of report.files) {
    const key = JSON.stringify([file.project, file.file, file.pool])
    assert(typeof file.project === 'string' && file.project && file.pool === 'forks' && digest(file.instanceId), 'actual logical project identity required')
    relative(file.file)
    assert(!groups.has(key) && !ids.has(file.instanceId), 'duplicate logical specification identity')
    assert(['pass', 'fail', 'skip', 'todo'].includes(file.state) && typeof file.name === 'string', 'actual logical file state required')
    groups.set(key, {file: file.file, rows: []}); ids.add(file.instanceId)
    fileStates.push([file.project, file.file, file.pool, file.name, file.state])
  }
  assert.deepEqual(sort(report.instances.map(row => [row.instanceId, row.project, row.file, row.pool])),
    sort(report.files.map(row => [row.instanceId, row.project, row.file, row.pool])), 'logical instance/file identities differ')
  const strong = []
  for (const row of report.rows) {
    assert(typeof row.name === 'string' && ['pass', 'fail', 'skip', 'todo'].includes(row.state), 'actual logical test state required')
    const group = groups.get(JSON.stringify([row.project, row.file, row.pool]))
    assert(group, 'logical row outside complete actual file selection')
    group.rows.push([row.name, row.state]); strong.push([row.project, row.file, row.pool, row.name, row.state])
  }
  const strongLogicalSha256 = sha(JSON.stringify(sort(strong)))
  assert.equal(strongLogicalSha256, report.sha256, 'runtime full logical digest differs')
  const projection = sort([...groups.values()].map(group => [group.file, sort(group.rows)]))
  return {files: report.files.length, tests: report.rows.length, ordinarySemanticSha256: null,
    projectionSha256: sha(JSON.stringify(projection)), strongLogicalSha256,
    fileStatesSha256: sha(JSON.stringify(sort(fileStates))),
    fidelity: 'actual project/file/pool/full-name/state and actual logical file states; no native reporter metadata reconstruction'}
}
function fromLog(text) {
  assert(Buffer.byteLength(text) <= MAX_LOG, 'job log bound exceeded')
  const events = [], evidence = [], releaseSignature = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[0-9TZ:.-]+ /, '').replace(/\u001b\[[0-9;]*m/g, '')
    for (const [marker, destination] of [['QUOD_MANAGED_MATRIX_INPUT_RESULT ', events], ['QUOD_BENCH_MATRIX_STATES ', evidence]]) {
      if (line.startsWith(marker)) {
        assert(line.length <= 65536, 'summary marker bound exceeded')
        const value = JSON.parse(line.slice(marker.length))
        assert(value && typeof value === 'object' && !Array.isArray(value), 'invalid evidence marker')
        destination.push(value)
      }
    }
    if (/^(?:# |ℹ )(?:tests|pass|fail|cancelled|skipped|todo) \d+$/.test(line)) releaseSignature.push(line.replace(/^(?:# |ℹ )/, ''))
  }
  assert(events.length <= 1 && evidence.length <= 1, 'ambiguous invocation evidence')
  if (events.length && evidence.length) assert.equal(sha(Buffer.from(JSON.stringify(events[0]))), evidence[0].bridgeSummarySha256,
    'actual bridge marker differs from retained summary')
  return {event: events[0] || null, states: evidence[0] || null, releaseSignature: releaseSignature.sort(), invalid: false}
}
function transportEvidence({event, temporary, out, namespace, variant}) {
  const directory = path.join(temporary, 'quod'), execution = event.evidenceDirectory
  assert(path.dirname(execution) === directory && /^matrix-run-[A-Za-z0-9]+$/.test(path.basename(execution)), 'owned invocation evidence directory required')
  assert.equal(event.cacheTransport.file, path.join(execution, 'cache-transport.json'))
  assert.equal(event.cacheTransport.namespace, namespace + '-', 'actual collection namespace differs from this cold chain')
  assert.equal(sha(Buffer.from(stable(event.cacheTransport.scopeInput))), event.cacheTransport.scope)
  const transport = readRegular(event.cacheTransport.file), records = transport.data.events
  assert.equal(transport.data.schema, 'quod-managed-matrix-action-cache-v1')
  assert(Array.isArray(records) && records.length <= 2048, 'bounded actual SDK operation evidence required')
  const restores = records.filter(row => ['collection-restore', 'collection-restore-error'].includes(row.operation))
  const saves = records.filter(row => ['collection-save', 'collection-save-error'].includes(row.operation))
  const entries = records.filter(row => row.operation === 'collection-entry')
  assert(restores.length <= 1 && saves.length <= 1, 'unexpected repeated collection SDK operations')
  if (variant === 'managed-control') assert.equal(records.length, 0, 'uncached control performed collection operations')
  fs.writeFileSync(path.join(out, 'cache-transport.json'), transport.bytes, {flag: 'wx'})
  const packs = {}, retained = event.retainedCollections || {}
  assert(Object.keys(retained).every(kind => ['restored', 'published'].includes(kind)), 'unknown retained collection role')
  for (const [kind, descriptor] of Object.entries(retained)) {
    const authority = records.find(row => kind === 'restored' ? row.operation === 'collection-restore' && row.reason === 'hit' : row.operation === 'collection-save')
    assert(authority, 'collection copy lacks acknowledged SDK operation')
    assert.equal(descriptor.file, path.join(execution, kind + '-collection.json'))
    const value = readRegular(descriptor.file), key = kind === 'restored' ? authority.matchedServiceKey : authority.key
    const prefix = 'quod-managed-collection-v1-' + namespace + '-' + event.cacheTransport.scope + '-'
    assert.equal(key, prefix + value.sha256); assert.equal(descriptor.serviceKey, key)
    assert.equal(descriptor.sha256, value.sha256); assert.equal(descriptor.bytes, value.bytes.length)
    assert.equal(authority.collectionSha256, value.sha256)
    if (kind === 'published') assert(Number.isSafeInteger(authority.cacheId) && authority.cacheId > 0 && descriptor.cacheId === authority.cacheId)
    const data = value.data
    assert.equal(data.schema, 'quod-managed-collection-v1'); assert.equal(data.scope, event.cacheTransport.scope)
    assert.deepEqual(Object.keys(data), ['schema', 'scope', 'entries'], 'collection schema fields differ')
    assert(Array.isArray(data.entries) && data.entries.length <= 512)
    let previous = ''
    for (const row of data.entries) {
      assert.deepEqual(Object.keys(row), ['executionKey', 'receiptSha256', 'receiptBase64'], 'collection entry fields differ')
      assert(digest(row.executionKey) && row.executionKey > previous && digest(row.receiptSha256) && typeof row.receiptBase64 === 'string')
      const bytes = Buffer.from(row.receiptBase64, 'base64')
      assert(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024 && bytes.toString('base64') === row.receiptBase64 && sha(bytes) === row.receiptSha256)
      previous = row.executionKey
    }
    assert(Buffer.from(JSON.stringify(data) + '\n').equals(value.bytes), 'noncanonical collection evidence')
    assert.equal(authority.entries, data.entries.length)
    fs.writeFileSync(path.join(out, kind + '-collection.json'), value.bytes, {flag: 'wx'})
    packs[kind] = {sha256: value.sha256, bytes: value.bytes.length, serviceKey: key, entries: data.entries.length,
      ...(kind === 'published' ? {cacheId: authority.cacheId} : {})}
    if (kind === 'restored') {
      const actual = new Map(data.entries.map(row => [row.executionKey, row.receiptSha256]))
      for (const row of entries) assert(row.matchedServiceKey === key && row.collectionSha256 === value.sha256 && actual.get(row.executionKey) === row.receiptSha256,
        'entry authority differs from exact restored collection bytes')
    }
  }
  if (event.replayedInstances > 0) assert(packs.restored && entries.length >= event.replayedInstances, 'replays lack actual restored service authority')
  if (event.publication?.saved) assert(packs.published && event.publication.cacheId === packs.published.cacheId, 'publication lacks acknowledged raw bytes')
  return {namespace: event.cacheTransport.namespace, sdkRestoreEvents: restores.length, sdkSaveEvents: saves.length, entryEvents: entries.length,
    restoreReason: restores[0]?.reason || null, rawSha256: transport.sha256, packs}
}
function collect({variant, project, out, temporary, actionSha, sourceSha, harnessSha, commit, namespace}) {
  assert(['plain', 'managed-control', 'managed'].includes(variant), 'measured variant required')
  assert(fullSha(actionSha) && fullSha(sourceSha) && fullSha(harnessSha) && fullSha(commit), 'all approved full source pins required')
  fs.mkdirSync(out, {recursive: true})
  let result
  if (variant === 'plain') {
    const file = path.join(temporary, 'bench-vitest-report.json'), value = readRegular(file)
    result = {...nativeEvidence(value.data, project), raw: {file: 'native-report.json', sha256: value.sha256, bytes: value.bytes.length}}
    fs.writeFileSync(path.join(out, result.raw.file), value.bytes, {flag: 'wx'})
  } else {
    const directory = path.join(temporary, 'quod/matrix-reports'), names = fs.readdirSync(directory).filter(name => name.endsWith('.summary.json'))
    assert.equal(names.length, 1, 'exactly one full matrix bridge invocation required')
    const summary = readRegular(path.join(directory, names[0])), event = summary.data
    assert.equal(event.schema, 'quod-managed-matrix-action-result-v1')
    assert.equal(event.mode, variant === 'managed' ? 'matrix-research' : 'matrix-control')
    assert.equal(event.fullJobHit, false)
    assert.equal(event.selectedScope.kind, 'complete-original-default-selection')
    assert.equal(event.cacheTransport.scopeInput.source.commit, sourceSha, 'different runtime source')
    const expected = path.join(directory, names[0].replace(/\.summary\.json$/, '.logical.json'))
    assert.equal(event.logicalReport.file, expected, 'bridge logical path must name its exact invocation')
    const logical = readRegular(expected), fingerprint = logicalEvidence(logical.data)
    assert.equal(logical.sha256, event.logicalReport.sha256); assert.equal(logical.bytes.length, event.logicalReport.bytes)
    assert.equal(logical.data.exitCode, event.exitCode); assert.equal(event.logicalReport.schema, logical.data.schema)
    assert.equal(fingerprint.files, event.selectedInstances); assert.equal(fingerprint.tests, event.logicalStates)
    assert.equal(event.logicalReport.instances, fingerprint.files); assert.equal(event.logicalReport.states, fingerprint.tests)
    assert.equal(fingerprint.strongLogicalSha256, event.logicalSha256)
    assert.equal(event.authLifecycle.sessionConsumedBeforeVitestDispatch, true)
    assert.equal(event.authLifecycle.authAbsentOutsideSdk, true)
    result = {...fingerprint, bridgeSummarySha256: sha(Buffer.from(JSON.stringify(event))),
      transport: transportEvidence({event, temporary, out, namespace, variant}),
      raw: {file: 'logical-results.json', sha256: logical.sha256, bytes: logical.bytes.length},
      summaryRaw: {file: 'bridge-summary.json', sha256: summary.sha256, bytes: summary.bytes.length}}
    fs.writeFileSync(path.join(out, result.raw.file), logical.bytes, {flag: 'wx'})
    fs.writeFileSync(path.join(out, result.summaryRaw.file), summary.bytes, {flag: 'wx'})
  }
  const data = {schema: 'quod-matrix-window-evidence-v1', variant, project, commit, harnessSha, actionSha, sourceSha, ...result}
  fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(data, null, 2) + '\n', {flag: 'wx'})
  console.log('QUOD_BENCH_MATRIX_STATES ' + JSON.stringify(data))
  if (variant === 'plain') console.log(`QUOD_BENCH_STATES ${result.ordinarySemanticSha256} ${result.files} ${result.tests}`)
  return data
}
module.exports = {nativeEvidence, logicalEvidence, fromLog, collect, transportEvidence, sort, sha}
if (require.main === module) {
  try {
    const [mode, ...args] = process.argv.slice(2)
    if (mode === 'log') console.log(JSON.stringify(fromLog(fs.readFileSync(args[0], 'utf8'))))
    else if (mode === 'collect') collect({variant: args[0], project: fs.realpathSync(args[1]), out: path.resolve(args[2]),
      temporary: fs.realpathSync(process.env.RUNNER_TEMP), actionSha: process.env.MATRIX_ACTION_SHA,
      sourceSha: process.env.MATRIX_RUNTIME_SOURCE, harnessSha: process.env.GITHUB_SHA, commit: process.env.PROJECT_COMMIT,
      namespace: process.env.MATRIX_CACHE_NAMESPACE})
    else throw Error('usage: matrix-evidence.cjs collect VARIANT PROJECT OUT | log FILE')
  } catch (error) {console.error(error.stack || error); process.exitCode = 1}
}
