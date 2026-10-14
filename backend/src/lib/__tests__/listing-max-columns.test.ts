/**
 * The "up to" listing columns (migration 517) reach the shared database only at
 * the dev→main promotion, and staging runs ahead of them: a read or a write that
 * names one must survive their absence — the listing then shows its "from"
 * figure alone.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { maxOf, resetMaxColumnsForTest, selectWithMax, withMaxColumns, withoutMax, writeWithMax } from "../listing-max-columns.js"

const MISSING = { code: "42703", message: "column published_apps.max_estimated_credits does not exist" }

beforeEach(() => resetMaxColumnsForTest())

describe("a read", () => {
  it("names the columns while they exist, the listed ones alone when asked", () => {
    expect(withMaxColumns("workflow_templates", "id")).toBe("id, max_estimated_credits, max_estimated_per_minute_credits")
    expect(withMaxColumns("published_apps", "id", "listed")).toBe("id, max_estimated_credits, max_per_minute_credits, max_per_item_credits")
  })

  it("retries without them once they are missing, and stops naming them", async () => {
    const asked: string[] = []
    const build = async (columns: string) => {
      asked.push(columns)
      return columns.includes("max_") ? { data: null, error: MISSING } : { data: [{ id: "a" }], error: null }
    }
    expect((await selectWithMax("published_apps", "id", build)).data).toEqual([{ id: "a" }])
    expect((await selectWithMax("published_apps", "id", build)).data).toEqual([{ id: "a" }])
    expect(asked).toHaveLength(3)
    expect(asked.slice(1)).toEqual(["id", "id"])
  })

  it("hands another missing column back to the caller", async () => {
    const other = { code: "42703", message: "column published_apps.per_minute_credits does not exist" }
    const r = await selectWithMax("published_apps", "id", async () => ({ data: null, error: other }))
    expect(r.error).toBe(other)
  })
})

describe("a write", () => {
  it("is retried without the columns, dropping them (the from figure stays true)", async () => {
    const written: Record<string, unknown>[] = []
    const res = await writeWithMax("published_apps", { estimated_credits: 10, max_estimated_credits: 40, base_max_estimated_credits: 30 }, async (row) => {
      written.push(row)
      return { error: "max_estimated_credits" in row ? MISSING : null }
    })
    expect(res.error).toBeNull()
    expect(written[1]).toEqual({ estimated_credits: 10 })
    expect(withoutMax("workflow_templates", { a: 1, max_estimated_credits: 2 })).toEqual({ a: 1 })
  })
})

describe("maxOf", () => {
  it("reads a figure, undefined when not computed", () => {
    expect(maxOf({ m: 40 }, "m")).toBe(40)
    expect(maxOf({ m: null }, "m")).toBeUndefined()
    expect(maxOf(undefined, "m")).toBeUndefined()
  })
})

// Every file that names an "up to" column goes through the helper, so a new read
// or write cannot fail a whole statement on staging.
describe("every site that names an up-to column goes through the helper", () => {
  const SRC = join(__dirname, "..", "..")
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(path)
      return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
    })
  }
  const NAMES = /\b(?:base_max_estimated_credits|max_estimated_credits|base_max_per_minute_credits|max_per_minute_credits|base_max_per_item_credits|max_per_item_credits|max_estimated_per_minute_credits)\b/
  const files = sources(SRC)
    .map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, "utf8") }))
    .filter((f) => NAMES.test(f.text))

  it("finds the sites", () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(["lib/listing-max-columns.ts", "lib/app-listing-price.ts", "routes/workflow-templates.ts"]))
  })

  it.each(files.map((f) => f.rel).filter((rel) => rel !== "lib/listing-max-columns.ts" && rel !== "lib/app-listing-price.ts"))(
    "%s imports the helper",
    (rel) => {
      expect(files.find((f) => f.rel === rel)!.text).toMatch(/from "(?:\.\.?\/)+(?:lib\/)?listing-max-columns\.js"/)
    },
  )
})
