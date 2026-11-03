// row.mjs <out.json>: this job's stamps (scripts/floor/stamp.sh) and facts as one JSON row.
import fs from 'node:fs'
const st = {}
for (const l of fs.readFileSync(`${process.env.RUNNER_TEMP}/stamps`, 'utf8').trim().split('\n')) {
  const [k, v] = l.split(' ')
  st[k] = +v
}
const d = (a, b) => (st[a] != null && st[b] != null ? st[b] - st[a] : null)
const log = fs.existsSync('typecheck.log') ? fs.readFileSync('typecheck.log', 'utf8') : ''
const cached = /Cached:\s+(\d+) cached, (\d+) total/.exec(log)
const e = process.env
const row = {
  strategy: e.STRATEGY, case: e.CASE, rep: +e.REP, job: e.JOB_NAME,
  nm_hit: e.NM_HIT === 'true', tc_hit: e.TC_HIT || '', tsbi_hit: e.TSBI_HIT || '', rc: +(e.TC_RC ?? -1),
  turbo_cached: cached ? `${cached[1]}/${cached[2]}` : null,
  type_errors: (log.match(/error TS\d+/g) ?? []).length,
  ms: {
    setup: d('start', 'setup'), nm_restore: d('setup', 'nm_restored'), install: d('nm_restored', 'installed'),
    nm_save: d('installed', 'nm_saved'), tc_restore: d('nm_saved', 'tc_restored'), typecheck: d('tc_restored', 'typechecked'),
    save: d('typechecked', 'saved'), fast: d('start', 'typechecked'), total: d('start', 'saved'),
  },
}
fs.writeFileSync(process.argv[2], JSON.stringify(row) + '\n')
console.log(JSON.stringify(row))
