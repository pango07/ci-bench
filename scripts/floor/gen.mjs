// The floor fixture: a Next.js + Convex monorepo shaped like the pilot's
// (npm workspaces, turbo, tsc per package), generated.
//
//   node gen.mjs <dir> [--incremental] [--variant base|source|docs|lock|typeerror] [--scale 1]
//
//   packages/shared   zod models (z.infer, mapped types)
//   packages/backend  Convex: a schema of tables with indexes, queries and
//                     mutations over them, the codegen'd api/dataModel/server
//   apps/web          Next app router pages using convex/react's useQuery on
//                     the backend's typed api, and the shared models
// Every package typechecks with `tsc --noEmit` (`--incremental`: with a
// .tsbuildinfo next to its tsconfig). turbo.json is the pilot's: typecheck
// depends on ^typecheck and a transit task; the lockfile is an input.
//
// Variants are a commit on top of the base:
//   source     two backend functions and two pages change (shared does not)
//   docs       README and docs/ only
//   lock       convex 1.46.0 -> 1.47.0 (package.json and package-lock.json)
//   typeerror  a shared model's patch type drops `amount`: two web pages
//              that did not change no longer typecheck
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const dir = path.resolve(args[0])
const incremental = args.includes('--incremental')
const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'base'
const scale = args.includes('--scale') ? +args[args.indexOf('--scale') + 1] : 1
const here = path.dirname(new URL(import.meta.url).pathname)

const S = Math.round(150 * scale) // shared models
const T = Math.round(40 * scale) // tables
const F = Math.round(150 * scale) // backend function modules
const W = Math.round(250 * scale) // web pages
const B = 10 // shared base schemas
const pad = (n) => String(n).padStart(3, '0')
const convex = variant === 'lock' ? '1.47.0' : '1.46.0'

const files = new Map()
const put = (p, s) => files.set(p, s)
const json = (o) => JSON.stringify(o, null, 2) + '\n'
const tc = (extra = '') => `tsc --noEmit${incremental ? ' --incremental --tsBuildInfoFile .tsbuildinfo' : ''}${extra}`

put('package.json', json({
  name: 'fx',
  private: true,
  packageManager: 'npm@11.6.2',
  workspaces: ['apps/*', 'packages/*'],
  scripts: { typecheck: 'turbo run typecheck' },
  devDependencies: { turbo: '2.11.7', typescript: '5.9.3' },
}))
put('.gitignore', 'node_modules\n.turbo\n.next\n*.tsbuildinfo\n.tsbuildinfo\n')
put('turbo.json', json({
  $schema: 'https://turborepo.com/schema.json',
  tasks: {
    transit: { dependsOn: ['^transit'] },
    typecheck: { dependsOn: ['^typecheck', 'transit'], inputs: ['$TURBO_DEFAULT$', '$TURBO_ROOT$/package-lock.json'] },
  },
}))
put('README.md', '# fx\n\nA Next.js + Convex monorepo.\n')
put('docs/notes.md', '# Notes\n\nNothing yet.\n')
const tsconfig = (extra) => json({
  compilerOptions: {
    target: 'ES2022', lib: ['ES2023'], module: 'ESNext', moduleResolution: 'Bundler', strict: true,
    skipLibCheck: true, noEmit: true, isolatedModules: true, esModuleInterop: true, resolveJsonModule: true,
    ...extra.compilerOptions,
  },
  include: extra.include,
  exclude: ['node_modules'],
})

// shared
put('packages/shared/package.json', json({
  name: '@fx/shared', version: '0.0.0', private: true, type: 'module',
  main: './src/index.ts', types: './src/index.ts',
  scripts: { typecheck: tc() },
  dependencies: { zod: '4.6.7', 'date-fns': '4.1.0' },
}))
put('packages/shared/tsconfig.json', tsconfig({ compilerOptions: {}, include: ['src'] }))
let idx = ''
for (let b = 0; b < B; b++) {
  put(`packages/shared/src/models/base${b}.ts`, `import { z } from 'zod'
export const Base${b}Schema = z.object({ code: z.string().length(${b + 3}), weight: z.number().min(0), unit: z.enum(['kg', 'lb', 'u${b}']) })
export type Base${b} = z.infer<typeof Base${b}Schema>
`)
  idx += `export * from './models/base${b}'\n`
}
for (let i = 0; i < S; i++) {
  const n = pad(i)
  const b = i % B
  const patch = variant === 'typeerror' && i === 3 ? `Partial<Omit<M${n}, 'id' | 'amount'>>` : `Partial<Omit<M${n}, 'id'>>`
  put(`packages/shared/src/models/m${n}.ts`, `import { z } from 'zod'
import { format } from 'date-fns'
import { Base${b}Schema } from './base${b}'
export const M${n}Schema = z.object({
  id: z.string(),
  name: z.string().min(1),
  kind: z.enum(['a', 'b', 'c${i}']),
  amount: z.number().int().nonnegative(),
  tags: z.array(z.string()).max(10),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  base: Base${b}Schema,
  createdAt: z.number(),
  status: z.discriminatedUnion('type', [
    z.object({ type: z.literal('open'), since: z.number() }),
    z.object({ type: z.literal('closed'), reason: z.string(), at: z.number().optional() }),
  ]),
})
export type M${n} = z.infer<typeof M${n}Schema>
export type M${n}Patch = ${patch}
export type M${n}StringKeys = { [K in keyof M${n}]-?: M${n}[K] extends string ? K : never }[keyof M${n}]
export type M${n}Event = { [K in keyof M${n} as \`changed\${Capitalize<string & K>}\`]: { before: M${n}[K]; after: M${n}[K] } }
export function apply${n}(x: M${n}, p: M${n}Patch): M${n} {
  return { ...x, ...p }
}
export function label${n}(x: M${n}): string {
  const s = x.status.type === 'open' ? \`open since \${format(x.status.since, 'yyyy-MM-dd')}\` : \`closed: \${x.status.reason}\`
  return \`\${x.name} (\${x.kind}, \${x.base.code}) \${s}\`
}
export function pick${n}<K extends M${n}StringKeys>(x: M${n}, k: K): string {
  return String(x[k])
}
export function parse${n}(u: unknown): M${n} | null {
  const r = M${n}Schema.safeParse(u)
  return r.success ? r.data : null
}
`)
  idx += `export * from './models/m${n}'\n`
}
put('packages/shared/src/index.ts', idx)

// backend
put('packages/backend/package.json', json({
  name: '@fx/backend', version: '0.0.0', private: true, type: 'module',
  scripts: { typecheck: tc() },
  dependencies: { convex, zod: '4.6.7', stripe: '22.6.0', '@fx/shared': '*' },
  devDependencies: { 'convex-test': '0.0.61', '@edge-runtime/vm': '5.0.0', vitest: '4.1.11', '@types/node': '20.19.43' },
}))
put('packages/backend/tsconfig.json', tsconfig({ compilerOptions: { types: ['node'] }, include: ['convex'] }))
let schema = `import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
export default defineSchema({
`
for (let t = 0; t < T; t++) {
  schema += `  t${pad(t)}: defineTable({
    name: v.string(),
    kind: v.union(v.literal('a'), v.literal('b'), v.literal('c')),
    amount: v.number(),
    tags: v.array(v.string()),
    ownerId: v.optional(v.id('t${pad((t + 1) % T)}')),
    meta: v.optional(v.record(v.string(), v.string())),
    status: v.union(v.object({ type: v.literal('open'), since: v.number() }), v.object({ type: v.literal('closed'), reason: v.string() })),
  })
    .index('by_name', ['name'])
    .index('by_kind_amount', ['kind', 'amount'])
    .index('by_owner', ['ownerId']),
`
}
schema += '})\n'
put('packages/backend/convex/schema.ts', schema)
put('packages/backend/convex/_generated/dataModel.ts', `/* Generated by convex codegen (the shape of it). */
import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel } from 'convex/server'
import type { GenericId } from 'convex/values'
import type schema from '../schema'
export type DataModel = DataModelFromSchemaDefinition<typeof schema>
export type TableNames = TableNamesInDataModel<DataModel>
export type Doc<T extends TableNames> = DocumentByName<DataModel, T>
export type Id<T extends TableNames> = GenericId<T>
`)
put('packages/backend/convex/_generated/server.ts', `/* Generated by convex codegen (the shape of it). */
import { mutationGeneric, queryGeneric, type MutationBuilder, type QueryBuilder } from 'convex/server'
import type { DataModel } from './dataModel'
export const query: QueryBuilder<DataModel, 'public'> = queryGeneric
export const mutation: MutationBuilder<DataModel, 'public'> = mutationGeneric
`)
let api = `/* Generated by convex codegen (the shape of it). */
import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server'
import { anyApi } from 'convex/server'
`
let apiMods = ''
for (let f = 0; f < F; f++) {
  const n = pad(f)
  const t = pad(f % T)
  const s = pad(f % S)
  const changed = variant === 'source' && (f === 7 || f === 8)
  put(`packages/backend/convex/f${n}.ts`, `import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { label${s}, type M${s} } from '@fx/shared'
export const list${n} = query({
  args: { kind: v.union(v.literal('a'), v.literal('b')), min: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('t${t}')
      .withIndex('by_kind_amount', (q) => q.eq('kind', args.kind).gte('amount', args.min))
      .collect()
    return rows.map((r) => ({ id: r._id, name: r.name, total: r.amount * 2, tags: r.tags.length${changed ? ', rank: rows.indexOf(r)' : ''} }))
  },
})
export const get${n} = query({
  args: { id: v.id('t${t}') },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id)
    if (!r) return null
    const owner = r.ownerId ? await ctx.db.get(r.ownerId) : null
    return { ...r, ownerName: owner?.name ?? null, open: r.status.type === 'open' }
  },
})
export const set${n} = mutation({
  args: { id: v.id('t${t}'), amount: v.number(), tags: v.array(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { amount: args.amount, tags: args.tags })
    return args.amount
  },
})
export function describe${n}(m: M${s}): string {
  return label${s}(m) + ' f${n}'
}
`)
  api += `import type * as f${n} from '../f${n}'\n`
  apiMods += `  f${n}: typeof f${n}\n`
}
api += `declare const fullApi: ApiFromModules<{
${apiMods}}>
export const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>> = anyApi as any
`
put('packages/backend/convex/_generated/api.ts', api)

// web
put('apps/web/package.json', json({
  name: '@fx/web', version: '0.0.0', private: true,
  scripts: { typecheck: tc() },
  dependencies: {
    next: '16.4.3', react: '19.3.0', 'react-dom': '19.3.0', convex, '@clerk/nextjs': '7.9.14', 'posthog-js': '1.438.9',
    'lucide-react': '1.55.0', '@radix-ui/react-dialog': '1.1.15', zod: '4.6.7', '@fx/shared': '*', '@fx/backend': '*',
  },
  devDependencies: {
    '@types/react': '19.3.0', '@types/react-dom': '19.3.0', '@types/node': '20.19.43', tailwindcss: '4.3.3',
    '@tailwindcss/postcss': '4.3.3', eslint: '9.39.5', 'eslint-config-next': '16.4.3', vitest: '4.1.11',
    '@vitejs/plugin-react': '5.0.4', jsdom: '27.0.0', '@testing-library/react': '16.3.0',
  },
}))
put('apps/web/tsconfig.json', tsconfig({
  compilerOptions: { lib: ['dom', 'dom.iterable', 'ES2023'], jsx: 'preserve', allowJs: false, incremental: undefined, plugins: [{ name: 'next' }], paths: { '@/*': ['./src/*'] } },
  include: ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx'],
}))
put('apps/web/next-env.d.ts', '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n')
put('apps/web/src/app/layout.tsx', `import type { ReactNode } from 'react'
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`)
for (let i = 0; i < W; i++) {
  const n = pad(i)
  const f = pad(i % F)
  const t = pad((i % F) % T)
  const s = pad(i % S)
  const changed = variant === 'source' && (i === 7 || i === 157)
  put(`apps/web/src/app/p${n}/page.tsx`, `'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@fx/backend/convex/_generated/api'
import type { Id } from '@fx/backend/convex/_generated/dataModel'
import { apply${s}, label${s}, type M${s} } from '@fx/shared'

type Props = { initial: M${s}; ownerId: Id<'t${t}'> }

export function Panel${n}({ initial, ownerId }: Props) {
  const rows = useQuery(api.f${f}.list${f}, { kind: 'a', min: 0 })
  const one = useQuery(api.f${f}.get${f}, { id: ownerId })
  const set = useMutation(api.f${f}.set${f})
  const [m, setM] = useState<M${s}>(initial)
  return (
    <section>
      <h2>{label${s}(m)}</h2>
      <p>{one?.ownerName ?? '-'} {one?.open ? 'open' : 'closed'}${changed ? ' {rows?.length ?? 0} rows' : ''}</p>
      <ul>
        {rows?.map((r) => (
          <li
            key={r.id}
            onClick={() => {
              void set({ id: ownerId, amount: r.total, tags: [] })
              setM(apply${s}(m, { amount: r.total }))
            }}
          >
            {r.name} {r.tags}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Page() {
  return (
    <div>
      page ${i} <Link href="/p${pad((i + 1) % W)}">next</Link>
    </div>
  )
}
`)
}

// variants that are not code
if (variant === 'docs') {
  put('README.md', '# fx\n\nA Next.js + Convex monorepo. Run `npm run typecheck`.\n')
  put('docs/notes.md', '# Notes\n\nThe typecheck is cached per package.\n')
}
for (const [p, s] of files) {
  const full = path.join(dir, p)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, s)
}
const lock = path.join(here, 'locks', variant === 'lock' ? 'bumped.json' : 'base.json')
if (fs.existsSync(lock)) fs.copyFileSync(lock, path.join(dir, 'package-lock.json'))
console.log(`fx: ${files.size} files (${S} models, ${T} tables, ${F} function modules, ${W} pages), variant ${variant}${incremental ? ', incremental' : ''}`)
