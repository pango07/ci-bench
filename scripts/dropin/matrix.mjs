// The matrix for bench-dropin.yml: corpus.json, filtered by a comma list of
// ids (empty: all), every entry with the fields the workflow reads.
//   node matrix.mjs "<ids>" <commits>
import fs from 'node:fs'
const [only = '', commits = '12'] = process.argv.slice(2)
const ids = only.split(',').map((s) => s.trim()).filter(Boolean)
const corpus = JSON.parse(fs.readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'))
const m = corpus
  .filter((e) => !ids.length || ids.includes(e.id))
  .map((e) => ({
    pnpm: false, bun: false, probe: "", probe_disable: false, corepack: false, corepack_first: false, node: '', node_file: '', bun_file: '',
    build: '', env: '', workdir: '.', ...e,
    commits: String(Math.min(Number(commits), e.commits ?? Infinity)),
    meta: JSON.stringify(e),
  }))
console.log(JSON.stringify(m))
