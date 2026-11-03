// The bench step's environment for one corpus entry, as GITHUB_ENV lines.
//   node env.mjs <id> <commits>  >> "$GITHUB_ENV"
import fs from 'node:fs'
const [id, commits = '12'] = process.argv.slice(2)
const e = JSON.parse(fs.readFileSync(new URL('./corpus.json', import.meta.url), 'utf8')).find((x) => x.id === id)
if (!e) throw new Error(`no corpus entry ${id}`)
const v = {
  DROPIN_SHA: e.sha, DROPIN_COMMITS: String(Math.min(Number(commits), e.commits ?? Infinity)),
  DROPIN_INSTALL: e.install, DROPIN_BUILD: e.build ?? '', DROPIN_TEST: e.test, DROPIN_WORKDIR: e.workdir ?? '.',
  DROPIN_EXTRA_ENV: e.env ?? '', DROPIN_PROBE: e.probe ?? '', DROPIN_PROBE_DISABLE: String(!!e.probe_disable), DROPIN_META: JSON.stringify(e),
}
for (const [k, x] of Object.entries(v)) {
  const d = `EOF_${Math.random().toString(36).slice(2)}`
  console.log(`${k}<<${d}\n${x}\n${d}`)
}
