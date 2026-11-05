// Skipped job definitions do not allocate a runner. Never select by API order.
'use strict'
function selectJob(response) {
  if (!response || !Array.isArray(response.jobs)) throw Error('missing jobs API response')
  const active = response.jobs.filter(job => job.conclusion !== 'skipped')
  if (active.length !== 1 || active[0].status !== 'completed' || !active[0].conclusion || !active[0].id || !Array.isArray(active[0].steps) || !active[0].steps.length) {
    throw Error('expected exactly one completed measured job with step evidence')
  }
  return { ...response, jobs: active }
}
module.exports = { selectJob }
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(selectJob(JSON.parse(require('node:fs').readFileSync(0, 'utf8'))))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
