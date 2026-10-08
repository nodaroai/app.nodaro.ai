/**
 * Totality of the template seeder claim (decided 2026-10-08): no path writes
 * template rows on its own say-so.
 *
 * 1. Inside the seeder (`lib/tutorial-seed/`), the claim's licence is the only
 *    handle on the database: nothing but seeder-claim.ts imports the Supabase
 *    client, statically or with a dynamic `import()`/`require()`, and no
 *    module the seeder imports from outside the directory holds one either. A
 *    new writer added to the seeder (another lane, another table) has no
 *    client to write with unless it goes through the claim.
 * 2. Across the backend, every template-row write site is accounted for below,
 *    by file AND by count. The seeder is the only AUTOMATIC writer (it runs at
 *    boot, in every environment that shares the database); the rest act on a
 *    user's or an operator's explicit request. A new write site — in a new
 *    file or inside a file already listed — fails here until it is either
 *    routed through the seeder (and so the claim) or counted with the reason
 *    it needs no claim.
 *
 * Both checks read source text, so they are heuristics: they catch the ways a
 * writer is normally spelled in this codebase, not every possible one.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const SEEDER_DIR = join(SRC, "lib", "tutorial-seed")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(p))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(p)
    }
  }
  return out
}

const rel = (p: string) => relative(SRC, p).split("\\").join("/")

/** A specifier naming the shared client module: relative, or via the `@/` alias. */
const CLIENT_MODULE = String.raw`["'](?:@\/(?:lib\/)?|(?:\.\.?\/)+(?:lib\/)?)supabase(?:\.js)?["']`
/** Imports a Supabase client — the shared one (static, dynamic or required), or a fresh one. */
const CLIENT_IMPORT = new RegExp(
  String.raw`(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)` + CLIENT_MODULE +
    String.raw`|@supabase\/supabase-js|\bcreateClient\s*\(`,
)
/** Relative imports that leave a directory (`../x.js`), static or dynamic. */
const OUTSIDE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](\.\.\/[^"']+)["']/g

const TEMPLATE_TABLES = /\.from\(\s*["'](workflow_templates|tutorial_categories)["']\s*\)/g
const WRITE_CALL = /\.(insert|update|upsert|delete)\s*\(/
const PER_MINUTE_WRITE = /writeWithPerMinute\s*\(\s*["']workflow_templates["']/

const PER_MINUTE_WRITES = new RegExp(PER_MINUTE_WRITE.source, "g")

/**
 * The template-row write sites in a file: each `.from(<template table>)` chain
 * that writes, plus each `writeWithPerMinute("workflow_templates", ...)` call.
 * Empty when the file only reads those tables.
 */
function templateWriteSites(source: string): string[] {
  const sites: string[] = []
  for (const m of source.matchAll(TEMPLATE_TABLES)) {
    // The chain that follows `.from(...)`, up to the end of the statement.
    const rest = source.slice(m.index! + m[0].length)
    const end = rest.search(/;|\n\s*\n|\.from\(/)
    if (WRITE_CALL.test(end === -1 ? rest : rest.slice(0, end))) sites.push(m[1]!)
  }
  for (const _ of source.matchAll(PER_MINUTE_WRITES)) sites.push("workflow_templates")
  return sites
}

/** The tables a file writes template rows to; empty when it only reads them. */
function templateTableWrites(source: string): string[] {
  return [...new Set(templateWriteSites(source))].sort()
}

/**
 * Every file allowed to write template rows, how many write sites it has, and
 * why it needs no claim. A count that moves means a writer was added or
 * removed: re-check the reason, then update the count. (A per-minute write is
 * counted twice — the wrapper call and the `.from(...)` chain inside it.)
 */
const TEMPLATE_ROW_WRITERS: Record<string, { sites: number; reason: string }> = {
  "lib/tutorial-seed/index.ts": {
    sites: 5,
    reason: "THE seeder: the boot-time writer, gated by the claim (its only client is the licence's, part 1)",
  },
  "routes/workflow-templates.ts": {
    sites: 9,
    reason: "a user publishing or editing their own template, on request",
  },
  "ee/routes/admin-tutorial-categories.ts": {
    sites: 3,
    reason: "an admin managing tutorial categories and listings, on request",
  },
  "scripts/backfill-template-previews.ts": {
    sites: 1,
    reason: "a one-off script an operator runs by hand against a database they choose",
  },
  "ee/scripts/backfill-speech-app-prices.ts": {
    sites: 1,
    reason: "a one-off script an operator runs by hand (--include-templates) against a database they choose",
  },
}

describe("template seeder claim — totality", () => {
  it("inside the seeder, only seeder-claim.ts holds a Supabase client", () => {
    const holders = sourceFiles(SEEDER_DIR)
      .filter((p) => CLIENT_IMPORT.test(readFileSync(p, "utf8")))
      .map(rel)
    expect(holders).toEqual(["lib/tutorial-seed/seeder-claim.ts"])
  })

  it("no module the seeder imports from outside its directory holds a Supabase client", () => {
    const helpers = new Set<string>()
    for (const p of sourceFiles(SEEDER_DIR)) {
      if (rel(p) === "lib/tutorial-seed/seeder-claim.ts") continue
      for (const m of readFileSync(p, "utf8").matchAll(OUTSIDE_IMPORT)) {
        helpers.add(join(dirname(p), m[1]!.replace(/\.js$/, ".ts")))
      }
    }
    expect(helpers.size).toBeGreaterThan(0)
    const holders = [...helpers].filter((p) => CLIENT_IMPORT.test(readFileSync(p, "utf8"))).map(rel)
    expect(holders).toEqual([])
  })

  it("the client check sees every way of importing the client", () => {
    for (const src of [
      `import { supabase } from "../supabase.js"`,
      `import { supabase } from "../../lib/supabase.js"`,
      `import { supabase } from "@/lib/supabase.js"`,
      `const { supabase } = await import("../supabase.js")`,
      `const { supabase } = await import( '../../lib/supabase' )`,
      `const { supabase } = require("../supabase.js")`,
      `export { supabase } from "./supabase.js"`,
      `import { createClient } from "@supabase/supabase-js"`,
    ]) {
      expect(CLIENT_IMPORT.test(src), src).toBe(true)
    }
    expect(CLIENT_IMPORT.test(`import { x } from "../supabase-helpers.js"`)).toBe(false)
    expect(CLIENT_IMPORT.test(`import { config } from "../config.js"`)).toBe(false)
  })

  it("the seeder's database calls all go through the licence's client", () => {
    const seeder = readFileSync(join(SEEDER_DIR, "index.ts"), "utf8")
    expect(seeder).toMatch(/await claimTemplateSeeding\(\)/)
    expect(seeder).not.toMatch(/\bsupabase\s*\.\s*(from|auth|rpc|storage)\b/)
  })

  it("every template-row write site is the seeder's or a counted on-request writer's", () => {
    const found: Record<string, number> = {}
    for (const p of sourceFiles(SRC)) {
      const n = templateWriteSites(readFileSync(p, "utf8")).length
      if (n > 0) found[rel(p)] = n
    }
    const expected = Object.fromEntries(
      Object.entries(TEMPLATE_ROW_WRITERS).map(([file, { sites }]) => [file, sites]),
    )
    expect(found).toEqual(expected)
  })

  it("the census sees a write and ignores a read", () => {
    expect(templateTableWrites(`await db\n  .from("workflow_templates")\n  .update(row)\n  .eq("id", id)`)).toEqual(["workflow_templates"])
    expect(templateTableWrites(`supabase.from('tutorial_categories').insert({ slug })`)).toEqual(["tutorial_categories"])
    expect(templateTableWrites(`await writeWithPerMinute("workflow_templates", row, write)`)).toEqual(["workflow_templates"])
    expect(templateTableWrites(`supabase.from("workflow_templates").select("id").eq("slug", s)`)).toEqual([])
    expect(templateTableWrites(`supabase.from("workflow_templates").select("id");\nsupabase.from("jobs").update(x)`)).toEqual([])
    expect(templateWriteSites(`db.from("workflow_templates").insert(a);\ndb.from("workflow_templates").update(b)`)).toHaveLength(2)
  })
})
