// The matrix for bench-dropin.yml: corpus.json, filtered by a comma list of
// ids (empty: all). Only what the workflow's set-up steps read goes into the
// matrix (a job output that may hold a secret-looking value is dropped by
// GitHub); env.mjs gives the bench step the rest by id.
//   node matrix.mjs "<ids>"
import fs from 'node:fs'
const [only = ''] = process.argv.slice(2)
const ids = only.split(',').map((s) => s.trim()).filter(Boolean)
const corpus = JSON.parse(fs.readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'))
const pick = ({ id, repo, pnpm = false, bun = false, corepack = false, corepack_first = false, node = '', node_file = '', bun_file = '' }) =>
  ({ id, repo, pnpm, bun, corepack, corepack_first, node, node_file, bun_file })
console.log(JSON.stringify(corpus.filter((e) => !ids.length || ids.includes(e.id)).map(pick)))
