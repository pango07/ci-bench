// Complete API job durations; no component timer substitutes for billed work.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const {sha} = require('./matrix-evidence.cjs')
const {resolveWindowProfile, PROPERTY47_VALUE} = require('./property47-window-profile.cjs')
const VARIANTS = ['floor', 'plain', 'managed-control', 'managed']
const MANIFEST_SHA = 'cda867393ad8d174a725a5cc74efd99557ce8531d690115200deebdf21a1b897'
const fullSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value)
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const identity = row => JSON.stringify([row.id, row.variant, row.i, row.commit])
const finite = value => Number.isFinite(value) && value >= 0
const sum = rows => rows.reduce((a, b) => a + b, 0)
const time = value => Date.parse(value) / 1000
export function buildMatrixReport({rows, expected, settings, manifest, observedRuns}) {
  const issues = [], metrics = [], fail = message => issues.push(message)
  let profile
  try {profile = resolveWindowProfile(settings?.candidateProfile)}
  catch {fail('unknown closed window candidate profile'); profile = resolveWindowProfile()}
  if (!settings || settings.schema !== 'quod-matrix-original-window-settings-v1' || settings.cold !== true ||
      settings.repeatFirst !== false || !/^\d+$/.test(settings.coordinatorRun || '') ||
      !fullSha(settings.harnessSha) || !fullSha(settings.actionSha) || !fullSha(settings.sourceSha)) fail('missing approved full-pin cold-window provenance')
  if (JSON.stringify(settings?.commands) !== JSON.stringify(manifest.commands)) fail('original install/build/test commands changed')
  const wanted = manifest.commits.flatMap(row => VARIANTS.map(variant => ({id: 'convex-helpers', variant, i: row.i, commit: row.sha})))
  const keys = rows.map(identity)
  if (rows.length !== 48 || new Set(keys).size !== 48 || [...keys].sort().join('\n') !== wanted.map(identity).sort().join('\n')) fail('missing/extra/duplicate original48 job identities')
  if (expected.length !== 48 || expected.map(identity).sort().join('\n') !== wanted.map(identity).sort().join('\n')) fail('dispatch expected roster differs from original48')
  if (new Set(rows.map(row => row.run)).size !== rows.length || new Set(rows.map(row => row.job?.id)).size !== rows.length) fail('duplicate run/job IDs')
  if (!Array.isArray(observedRuns) || observedRuns.length !== 4) fail('missing independently enumerated four branch-run sets')
  else for (const variant of VARIANTS) {
    const branch = `bench/${profile.branchPrefix}-${settings?.coordinatorRun}-convex-helpers-${variant}`
    const actual = observedRuns.filter(row => row.branch === branch)
    if (actual.length !== 1 || actual[0].total_count !== 12 || actual[0].workflow_runs?.length !== 12 ||
        actual[0].workflow_runs.map(row => row.id).sort().join(',') !== rows.filter(row => row.variant === variant).map(row => row.run).sort().join(',')) fail('extra/missing independently enumerated executions for ' + variant)
  }
  const find = (variant, i) => rows.find(row => row.variant === variant && row.i === i)
  const releaseExpected = ['cancelled 0', 'fail 0', 'pass 20', 'skipped 0', 'tests 20', 'todo 0'].sort()
  for (const row of rows) {
    const label = `${row.variant}/c${row.i}/${row.run}`, known = manifest.commits[row.i]
    const j = row.job, run = row.run_meta
    if (!known || known.sha !== row.commit || row.id !== 'convex-helpers' || !VARIANTS.includes(row.variant)) {fail(label + ': unknown selected input'); continue}
    const branch = `bench/${profile.branchPrefix}-${settings?.coordinatorRun}-convex-helpers-${row.variant}`
    if (row.branch !== branch || run?.head_branch !== branch || run?.head_sha !== settings?.harnessSha ||
        run?.event !== 'workflow_dispatch' || run?.run_attempt !== 1 || run?.path !== '.github/workflows/bench-job-one.yml') fail(label + ': workflow source/branch/attempt changed')
    if (run?.id !== row.run || run?.conclusion !== 'success' || j?.conclusion !== 'success' || j?.status !== 'completed') fail(label + ': measured run/job failed or incomplete')
    if (!row.image || !Array.isArray(j?.steps) || !j.steps.length) fail(label + ': missing complete job/runner image evidence')
    const runner = time(j?.completed_at) - time(j?.started_at), queue = time(j?.started_at) - time(j?.created_at)
    if (!finite(runner) || runner === 0 || !finite(queue)) fail(label + ': invalid API job timing')
    const groups = {setup: 0, action: 0, install: 0, build: 0, test: 0, post: 0}
    for (const step of j?.steps || []) if (step.conclusion !== 'skipped') {
      const seconds = time(step.completed_at) - time(step.started_at)
      if (!finite(seconds)) {fail(label + ': invalid step timestamps'); continue}
      const group = step.name === 'quod' ? 'action' : ['install', 'build', 'test'].includes(step.name) ? step.name :
        step.name.startsWith('Post ') || step.name === 'Complete job' ? 'post' : 'setup'
      groups[group] += seconds
    }
    for (const stepName of ['install', 'build', 'test']) {
      const steps = j?.steps?.filter(step => step.name === stepName) || []
      if (steps.length !== 1 || steps[0].conclusion !== (row.variant === 'floor' ? 'skipped' : 'success')) fail(label + ': original ' + stepName + ' work missing/failed')
    }
    metrics.push({variant: row.variant, i: row.i, commit: row.commit, run: row.run, job: j?.id,
      runnerSeconds: runner, modeledMinutes: Math.ceil(runner / 60), queueSeconds: queue, ...groups})
    if (row.variant === 'floor') {
      if (row.matrix?.event || row.matrix?.states) fail(label + ': floor unexpectedly executed tests')
      continue
    }
    const parsed = row.matrix, evidence = parsed?.states
    if (parsed?.invalid || !evidence || evidence.schema !== 'quod-matrix-window-evidence-v1' ||
        evidence.variant !== row.variant || evidence.commit !== row.commit || evidence.harnessSha !== settings?.harnessSha ||
        evidence.actionSha !== settings?.actionSha || evidence.sourceSha !== settings?.sourceSha ||
        evidence.files !== known.files || evidence.tests !== known.tests || !digest(evidence.projectionSha256) ||
        !digest(evidence.raw?.sha256) || !Number.isSafeInteger(evidence.raw?.bytes) || evidence.raw.bytes <= 0) fail(label + ': incomplete full logical/native evidence')
    if (JSON.stringify(parsed?.releaseSignature) !== JSON.stringify(known.releaseTests ? releaseExpected : [])) fail(label + ': original20 release-test tail missing/changed')
    if (row.variant === 'plain') {
      if (parsed?.event || evidence?.ordinarySemanticSha256 !== known.ordinarySemanticSha256) fail(label + ': fresh ordinary full native fingerprint differs from frozen manifest')
      continue
    }
    const event = parsed?.event, plain = find('plain', row.i)?.matrix?.states
    if (!event || event.schema !== 'quod-managed-matrix-action-result-v1' || event.exitCode !== 0 || event.fullJobHit !== false ||
        event.mode !== (row.variant === 'managed' ? profile.managedMode : profile.controlMode) || event.stickyManagedFailure !== false ||
        event.selectedScope?.kind !== 'complete-original-default-selection' || event.selectedInstances !== known.files ||
        event.logicalStates !== known.tests || event.logicalSha256 !== evidence?.strongLogicalSha256 ||
        !digest(evidence?.fileStatesSha256) || !digest(evidence?.bridgeSummarySha256)) fail(label + ': invalid full matrix result contract')
    if (!plain || plain.projectionSha256 !== evidence?.projectionSha256) fail(label + ': all projected file/test names/states differ from fresh ordinary')
    const n = key => Number.isSafeInteger(event?.[key]) && event[key] >= 0
    for (const key of ['candidateInstances', 'managedExecutions', 'replayedInstances', 'nativeSpecsExecuted', 'skippedCompilations', 'recordedReceipts']) if (!n(key)) fail(label + ': invalid count ' + key)
    if (event && (event.replayedInstances + event.nativeSpecsExecuted !== known.files ||
        event.replayedInstances + event.managedExecutions > event.candidateInstances || event.candidateInstances > known.files ||
        event.skippedCompilations > event.replayedInstances)) fail(label + ': omitted/duplicated actual specification work')
    const namespace = `${profile.namespacePrefix}-${settings?.coordinatorRun}-convex-helpers-${row.variant}`
    if (row.cacheNamespace !== namespace) fail(label + ': cold namespace changed')
    if (event?.cacheTransport?.namespace !== namespace + '-' || evidence?.transport?.namespace !== namespace + '-') fail(label + ': actual collection used a different namespace')
    if (row.variant === 'managed-control' && (event?.replayedInstances !== 0 || event?.skippedCompilations !== 0 || event?.recordedReceipts !== 0 ||
        evidence?.transport?.sdkRestoreEvents !== 0 || evidence?.transport?.sdkSaveEvents !== 0 || evidence?.transport?.entryEvents !== 0)) fail(label + ': independent uncached control performed cache operations/reused/published')
    if (event?.cacheTransport?.scopeInput?.runtimeArchiveSha256 !== settings?.runtimeArchiveSha256) fail(label + ': runtime archive differs from the full-pinned Action manifest')
    if (profile.property47 && (event?.candidateInstances !== 1 || event?.replayedInstances > 1 || event?.managedExecutions > 1 ||
        event?.recordedReceipts > 1 || event?.nativeSpecsExecuted !== known.files - event?.replayedInstances ||
        event?.cacheTransport?.scopeInput?.candidateProfile !== profile.label ||
        JSON.stringify(evidence?.candidateProfile) !== JSON.stringify(PROPERTY47_VALUE) ||
        !digest(evidence?.dispatchRaw?.sha256) || !Number.isSafeInteger(evidence?.dispatchRaw?.bytes) || evidence.dispatchRaw.bytes <= 0))
      fail(label + ': finite property47 roster, collection scope or raw dispatch evidence differs')
    if (row.variant === 'managed') {
      const control = find('managed-control', row.i)?.matrix?.states
      if (!control || evidence?.strongLogicalSha256 !== control.strongLogicalSha256 || evidence?.fileStatesSha256 !== control.fileStatesSha256) fail(label + ': project-aware rows/file states differ from independent control')
      if (row.i === 0 && event?.replayedInstances !== 0) fail(label + ': cold c0 reused cached tests')
      if (row.i === 0 && evidence?.transport?.restoreReason === 'hit') fail(label + ': cold c0 restored a prior collection')
    }
  }
  const variants = Object.fromEntries(VARIANTS.map(variant => {
    const group = metrics.filter(row => row.variant === variant), after = group.filter(row => row.i > 0)
    const source = rows.filter(row => row.variant === variant)
    return [variant, {jobs: group.length, runnerSeconds: sum(group.map(row => row.runnerSeconds)),
      modeledMinutes: sum(group.map(row => row.modeledMinutes)),
      afterFirst: {runnerSeconds: sum(after.map(row => row.runnerSeconds)), modeledMinutes: sum(after.map(row => row.modeledMinutes))},
      replayedInstances: sum(source.map(row => row.matrix?.event?.replayedInstances || 0)),
      managedExecutions: sum(source.map(row => row.matrix?.event?.managedExecutions || 0)),
      nativeSpecsExecuted: sum(source.map(row => row.matrix?.event?.nativeSpecsExecuted || 0)), fullJobHits: 0}]
  }))
  const managed = variants.managed, plain = variants.plain, prior = {runnerSeconds: 1735, modeledMinutes: 36}
  return {schema: 'quod-matrix-original-window-report-v1', passed: issues.length === 0, issues,
    provenance: settings, ...(profile.property47 ? {candidateProfile: PROPERTY47_VALUE} : {}), prior, variants, per: metrics, fullJobHit: false, independentArtifactAudit: 'pending separate archive/data verification',
    objectives: {evaluable: issues.length === 0,
      runnerSeconds: {halfFresh: issues.length ? null : managed.runnerSeconds <= plain.runnerSeconds / 2, halfPrior: issues.length ? null : managed.runnerSeconds <= prior.runnerSeconds / 2},
      modeledMinutes: {halfFresh: issues.length ? null : managed.modeledMinutes <= plain.modeledMinutes / 2, halfPrior: issues.length ? null : managed.modeledMinutes <= prior.modeledMinutes / 2}},
    limits: ['Complete jobs include setup, install/build/test, post and all artifact transfer; queue is separate.',
      'Minutes are sum(ceil(each complete job seconds/60)); public GitHub compute charge is zero.',
      'Ordinary JSON lacks project names: cross-mode equality is a multiplicity-preserving file/name/state projection without native file.status.',
      'Independent managed control additionally checks exact project/file/pool/name/state and actual logical file states.',
      'Coordinator markers are in-job checks, not an independent archive audit; raw file SHA/SDK/receipt chains require the post-run data reader.',
      'Native nonhits and original release tests remain actual work; there are no full-job hits.']}
}
export function markdown(report) {
  const lines = [`Matrix cold original48 in-job/API verification: **${report.passed ? 'PASS' : 'FAIL'}**, ${report.issues.length} issues. Independent raw artifact audit remains pending.`, '',
    '| Variant | Complete jobs | Runner seconds | Modeled minutes | Replayed instances | Managed executions | Native instances |',
    '|---|---:|---:|---:|---:|---:|---:|']
  for (const [variant, row] of Object.entries(report.variants)) lines.push(`| ${variant} | ${row.jobs} | ${row.runnerSeconds} | ${row.modeledMinutes} | ${row.replayedInstances} | ${row.managedExecutions} | ${row.nativeSpecsExecuted} |`)
  lines.push('', 'Half-window objectives: ' + JSON.stringify(report.objectives), '', ...report.limits.map(value => '- ' + value))
  if (report.issues.length) lines.push('', ...report.issues.map(value => '- ' + value))
  return lines.join('\n') + '\n'
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [file, out] = process.argv.slice(2), manifestBytes = fs.readFileSync(new URL('./managed-window.json', import.meta.url))
    if (sha(manifestBytes) !== MANIFEST_SHA) throw Error('frozen original window manifest changed')
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    const expected = fs.readFileSync(path.join(out, 'expected.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    const settings = JSON.parse(fs.readFileSync(path.join(out, 'settings.json')))
    const observedRuns = JSON.parse(fs.readFileSync(path.join(out, 'observed-runs.json')))
    const report = buildMatrixReport({rows, expected, settings, manifest: JSON.parse(manifestBytes), observedRuns})
    fs.writeFileSync(path.join(out, 'job-metrics.json'), JSON.stringify(report, null, 2) + '\n')
    const text = markdown(report); fs.writeFileSync(path.join(out, 'report.md'), text); console.log(text)
    if (!report.passed) process.exitCode = 1
  } catch (error) {console.error(error.stack || error); process.exitCode = 1}
}
