#!/usr/bin/env bash
# A Convex backend tested the standard convex-test way, as a git repo whose
# commits are the cases of the "glob entries" experiment: what of
# tests/helpers.ts's `import.meta.glob("../convex/**/*.ts")` each test
# actually consumes (class-management's setup: convex-test 0.0.61, convex
# 1.46.0, vitest 4.1.11, vite 8.3.4, edge-runtime, convex-test inlined).
#
#   make-repo.sh <dir>        then: shadow.sh <dir> main 10 run
#
# 35 test files: 31 call functions of one or two modules through
# convexTest(schema, modules) (helpers.ts); registry.test enumerates the
# map; contract.test globs eagerly; missing.test expects api.legacy.get to
# be missing ("Could not find module"); pure-money imports convex/lib
# directly. convex/_generated is hand-written as codegen writes it (api.js
# is anyApi; api.d.ts lists the modules and changes when one is added).
#
# Commits after the base:
#   1 add convex/closures.ts            (a new module no test calls)
#   2 edit notes.edit                   (a function only notes-edit calls)
#   3 type-only: convex/types.ts        (imported as a type only)
#   4 add convex/legacy.ts              (missing.test's absent lookup: it fails, like plain)
#   5 runtime: lib/money.ts rounds down (billing tests break)
#   6 revert money; delete convex/tags.ts (the tags tests fail, like plain)
#   7 restore convex/tags.ts
#   8 add convex/A_generated.ts         (moves convex-test's "_generated" root: every lookup misses)
#   9 remove convex/A_generated.ts
#  10 schema.ts: a new optional field   (every convex-test file runs)
set -euo pipefail
d=$1
rm -rf "$d"; mkdir -p "$d"; cd "$d"
git init -q -b main
git config user.email bench@example.com; git config user.name bench
mkdir -p convex/lib convex/_generated tests
cat > package.json <<'J'
{
  "name": "convex-glob-entries",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.34.9",
  "devDependencies": {
    "@edge-runtime/vm": "5.0.0",
    "convex": "1.46.0",
    "convex-test": "0.0.61",
    "vite": "8.3.4",
    "vitest": "4.1.11"
  }
}
J
printf 'node_modules\n' > .gitignore
cat > vitest.config.mts <<'J'
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
J

# --- _generated, as `npx convex codegen` writes it -------------------------
cat > convex/_generated/api.js <<'J'
/* eslint-disable */
/**
 * Generated `api` utility.
 */
import { anyApi } from "convex/server";
export const api = anyApi;
export const internal = anyApi;
J
cat > convex/_generated/server.js <<'J'
/* eslint-disable */
/**
 * Generated utilities for implementing server-side Convex query and mutation functions.
 */
import {
  actionGeneric,
  httpActionGeneric,
  queryGeneric,
  mutationGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
} from "convex/server";
export const query = queryGeneric;
export const internalQuery = internalQueryGeneric;
export const mutation = mutationGeneric;
export const internalMutation = internalMutationGeneric;
export const action = actionGeneric;
export const internalAction = internalActionGeneric;
export const httpAction = httpActionGeneric;
J
cat > convex/_generated/server.d.ts <<'J'
/* eslint-disable */
export declare const query: any;
export declare const internalQuery: any;
export declare const mutation: any;
export declare const internalMutation: any;
export declare const action: any;
export declare const internalAction: any;
export declare const httpAction: any;
J
cat > convex/_generated/dataModel.d.ts <<'J'
/* eslint-disable */
export type Id<T extends string> = string & { __tableName: T };
J
gen_api() { # the modules under convex/, as codegen lists them
  {
    echo '/* eslint-disable */'
    echo '/** Generated `api` utility. */'
    echo 'import type { ApiFromModules } from "convex/server";'
    for f in $(cd convex && find . -name '*.ts' ! -path './_generated/*' ! -name '*.d.ts' ! -name schema.ts | sed 's|^\./||; s|\.ts$||' | sort); do
      echo "import type * as $(echo "$f" | tr '/' '_') from \"../$f.js\";"
    done
    echo 'declare const fullApi: ApiFromModules<{'
    for f in $(cd convex && find . -name '*.ts' ! -path './_generated/*' ! -name '*.d.ts' ! -name schema.ts | sed 's|^\./||; s|\.ts$||' | sort); do
      echo "  \"$f\": typeof $(echo "$f" | tr '/' '_');"
    done
    echo '}>;'
    echo 'export declare const api: any;'
    echo 'export declare const internal: any;'
  } > convex/_generated/api.d.ts
}

# --- the backend ------------------------------------------------------------
cat > convex/schema.ts <<'J'
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  families: defineTable({ name: v.string(), kids: v.number() }).index("by_name", ["name"]),
  notes: defineTable({ body: v.string(), edits: v.number() }),
  tags: defineTable({ label: v.string() }),
  lessons: defineTable({ title: v.string(), seats: v.number() }),
  payments: defineTable({ cents: v.number(), family: v.string() }),
  staff: defineTable({ name: v.string(), role: v.string() }),
  messages: defineTable({ to: v.string(), text: v.string() }),
  attendance: defineTable({ kid: v.string(), present: v.boolean() }),
  invoices: defineTable({ family: v.string(), cents: v.number() }),
});
J
cat > convex/types.ts <<'J'
// Shapes the modules share; imported as types only.
export type Cents = number;
export interface Line {
  label: string;
  cents: Cents;
}
J
cat > convex/lib/money.ts <<'J'
export function round(cents: number): number {
  return Math.round(cents);
}
export function format(cents: number): string {
  return `$${(round(cents) / 100).toFixed(2)}`;
}
J
cat > convex/lib/util.ts <<'J'
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
J
# a module per table: add, get, list (and one more where a test needs it)
crud() { # module table field type value-expr
  cat > convex/$1.ts <<J
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const add = mutation({
  args: { $3: v.$4() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("$2", { ...args, $5 });
  },
});

export const get = query({
  args: { id: v.id("$2") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("$2").collect();
  },
});
J
}
crud notes notes body string 'edits: 0'
cat >> convex/notes.ts <<'J'

export const edit = mutation({
  args: { id: v.id("notes"), body: v.string() },
  handler: async (ctx, { id, body }) => {
    const n = await ctx.db.get(id);
    if (!n) throw new Error("no such note");
    await ctx.db.patch(id, { body, edits: n.edits + 1 });
  },
});
J
crud tags tags label string ''
crud families families name string 'kids: 1'
crud lessons lessons title string 'seats: 8'
crud staff staff name string 'role: "coach"'
crud messages messages to string 'text: "hi"'
crud attendance attendance kid string 'present: true'
cat > convex/payments.ts <<'J'
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { format } from "./lib/money";
import type { Cents } from "./types";

export const charge = mutation({
  args: { family: v.string(), cents: v.number() },
  handler: async (ctx, { family, cents }) => {
    const c: Cents = cents;
    await ctx.db.insert("payments", { family, cents: c });
    return format(c);
  },
});

export const total = query({
  args: { family: v.string() },
  handler: async (ctx, { family }) => {
    const all = await ctx.db.query("payments").collect();
    return all.filter((p) => p.family === family).reduce((a, p) => a + p.cents, 0);
  },
});
J
cat > convex/billing.ts <<'J'
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { format, round } from "./lib/money";
import type { Line } from "./types";

export const invoice = mutation({
  args: { family: v.string(), lines: v.array(v.object({ label: v.string(), cents: v.number() })) },
  handler: async (ctx, { family, lines }) => {
    const ls: Line[] = lines;
    const cents = ls.reduce((a, l) => a + round(l.cents), 0);
    await ctx.db.insert("invoices", { family, cents });
    return format(cents);
  },
});

export const owed = query({
  args: { family: v.string() },
  handler: async (ctx, { family }) => {
    const all = await ctx.db.query("invoices").collect();
    return all.filter((i) => i.family === family).reduce((a, i) => a + i.cents, 0);
  },
});
J
cat > convex/reports.ts <<'J'
import { query } from "./_generated/server";
import { format } from "./lib/money";
import { slug } from "./lib/util";

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const fams = await ctx.db.query("families").collect();
    const pays = await ctx.db.query("payments").collect();
    return { families: fams.map((f) => slug(f.name)), paid: format(pays.reduce((a, p) => a + p.cents, 0)) };
  },
});
J
gen_api

cat > tests/helpers.ts <<'J'
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../convex/schema";

export const modules = import.meta.glob("../convex/**/*.ts");

export function newTest() {
  return convexTest(schema, modules);
}

/** A studio's worth of rows (the work a real test's setup does). */
export async function seed(t: ReturnType<typeof newTest>, n = 150) {
  await t.run(async (ctx) => {
    for (let i = 0; i < n; i++) await ctx.db.insert("families", { name: `Family ${i}`, kids: (i % 3) + 1 });
  });
}
J

n=0
t() { # name module-calls (a test body)
  cat > "tests/$1.test.ts" <<J
import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest, seed } from "./helpers";

test("$1", async () => {
  const t = newTest();
  await seed(t);
$2
});
J
}
for i in 1 2 3; do t notes-$i "  const id = await t.mutation(api.notes.add, { body: \"note $i\" });
  expect(await t.query(api.notes.get, { id })).toMatchObject({ body: \"note $i\", edits: 0 });"; done
t notes-edit '  const id = await t.mutation(api.notes.add, { body: "a" });
  await t.mutation(api.notes.edit, { id, body: "b" });
  expect(await t.query(api.notes.get, { id })).toMatchObject({ body: "b", edits: 1 });'
for i in 1 2 3; do t tags-$i "  await t.mutation(api.tags.add, { label: \"t$i\" });
  expect((await t.query(api.tags.list, {})).map((x) => x.label)).toEqual([\"t$i\"]);"; done
for i in 1 2 3 4; do t families-$i "  const id = await t.mutation(api.families.add, { name: \"Ng $i\" });
  expect(await t.query(api.families.get, { id })).toMatchObject({ name: \"Ng $i\", kids: 1 });
  expect((await t.query(api.families.list, {})).length).toBe(151);"; done
for m in lessons staff messages attendance; do
  case $m in lessons) f=title;; staff) f=name;; messages) f=to;; attendance) f=kid;; esac
  for i in 1 2 3; do t $m-$i "  const id = await t.mutation(api.$m.add, { $f: \"$m $i\" });
  expect(await t.query(api.$m.get, { id })).toMatchObject({ $f: \"$m $i\" });"; done
done
for i in 1 2 3; do t payments-$i "  expect(await t.mutation(api.payments.charge, { family: \"f\", cents: ${i}05 })).toBe(\"\$$i.05\");
  expect(await t.query(api.payments.total, { family: \"f\" })).toBe(${i}05);"; done
for i in 1 2 3; do t billing-$i "  expect(await t.mutation(api.billing.invoice, { family: \"f\", lines: [{ label: \"tuition\", cents: ${i}00.6 }] })).toBe(\"\$$i.01\");
  expect(await t.query(api.billing.owed, { family: \"f\" })).toBe(${i}01);"; done
t reports-1 '  await t.mutation(api.payments.charge, { family: "f", cents: 250 });
  const s = await t.query(api.reports.summary, {});
  expect(s.paid).toBe("$2.50");
  expect(s.families[0]).toBe("family-0");'
t reports-2 '  const s = await t.query(api.reports.summary, {});
  expect(s.families.length).toBe(150);'
cat > tests/missing.test.ts <<'J'
import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { newTest } from "./helpers";

test("the legacy module is gone", async () => {
  const t = newTest();
  await expect(t.query(api.legacy.get, {})).rejects.toThrow(/Could not find module/);
});
J
cat > tests/registry.test.ts <<'J'
import { expect, test } from "vitest";
import { modules } from "./helpers";

test("the backend has its modules", () => {
  const mods = Object.keys(modules).filter((k) => !k.includes("_generated") && !k.endsWith(".d.ts"));
  expect(mods.length).toBeGreaterThanOrEqual(10);
});
J
cat > tests/contract.test.ts <<'J'
import { expect, test } from "vitest";

const all = import.meta.glob<Record<string, unknown>>(["../convex/**/*.ts", "!../convex/**/*.d.ts", "!../convex/_generated/**"], { eager: true });

test("every module exports functions or a schema", () => {
  for (const [p, m] of Object.entries(all)) {
    for (const [k, v] of Object.entries(m)) expect(["function", "object"], `${p} ${k}`).toContain(typeof v);
  }
});
J
cat > tests/pure-money.test.ts <<'J'
import { expect, test } from "vitest";
import { format, round } from "../convex/lib/money";

test("money", () => {
  expect(round(100.6)).toBe(101);
  expect(format(250)).toBe("$2.50");
});
J

pnpm install --silent >/dev/null
git add -A; git commit -qm 'base: convex backend, convex-test helpers glob'

cat > convex/closures.ts <<'J'
import { v } from "convex/values";
import { query } from "./_generated/server";

export const forDay = query({
  args: { day: v.string() },
  handler: async (_ctx, { day }) => day === "2026-12-25",
});
J
gen_api; git add -A; git commit -qm 'add convex/closures.ts'

sed -i.bak 's/edits: n.edits + 1 });/edits: n.edits + 1 }); \/\/ count every edit/' convex/notes.ts; rm -f convex/notes.ts.bak
git commit -qam 'edit notes.edit'

sed -i.bak 's/  cents: Cents;/  cents: Cents;\n  note?: string;/' convex/types.ts; rm -f convex/types.ts.bak
grep -q 'note?' convex/types.ts
git commit -qam 'type-only: convex/types.ts'

cat > convex/legacy.ts <<'J'
import { query } from "./_generated/server";

export const get = query({ args: {}, handler: async () => "legacy" });
J
gen_api; git add -A; git commit -qm 'add convex/legacy.ts'

sed -i.bak 's/return Math.round(cents);/return Math.floor(cents);/' convex/lib/money.ts; rm -f convex/lib/money.ts.bak
grep -q floor convex/lib/money.ts
git commit -qam 'runtime: money rounds down'

git revert --no-edit HEAD >/dev/null
git rm -q convex/tags.ts; gen_api; git add -A; git commit -q --amend -m 'revert money; delete convex/tags.ts'

git checkout -q HEAD~2 -- convex/tags.ts; gen_api; git add -A; git commit -qm 'restore convex/tags.ts'

echo 'export const shadow = 1;' > convex/A_generated.ts
gen_api; git add -A; git commit -qm 'add convex/A_generated.ts'

git rm -q convex/A_generated.ts; gen_api; git add -A; git commit -qm 'remove convex/A_generated.ts'

sed -i.bak 's/notes: defineTable({ body: v.string(), edits: v.number() }),/notes: defineTable({ body: v.string(), edits: v.number(), pinned: v.optional(v.boolean()) }),/' convex/schema.ts; rm -f convex/schema.ts.bak
grep -q pinned convex/schema.ts
git commit -qam 'schema.ts: a new optional field'
git log --oneline | cat
