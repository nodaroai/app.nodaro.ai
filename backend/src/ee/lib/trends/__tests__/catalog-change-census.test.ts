// @test-watches backend/src/**/*.ts backend/scripts/**/*.ts
/**
 * Every write that can change what a public trend read shows must tell the
 * guest answers kept from before it (catalog-stamp.ts): a write that does
 * not leaves guests on an old catalog until the kept answers expire.
 *
 * The census: every top-level function of the trend store (store.ts,
 * tags.ts; `function` or `const … = (…) =>`) that writes (`.insert(` /
 * `.update(` / `.upsert(` / `.delete(` / `.rpc(`) calls
 * `trendCatalogChanged()` in its code (a comment does not count), or is
 * listed in NO_PUBLIC_CHANGE with the reason no public read can see what it
 * writes. And no other file of the backend queries the trend tables: the
 * store is the one door, so the census is total.
 *
 * What a census cannot see: a function with two write paths where only one
 * moves the stamp. Each public writer's every path is pinned by a behavioural
 * test instead (catalog-change-writers.test.ts, tags.test.ts).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const TRENDS_LIB = join(HERE, "..")
const BACKEND_SRC = join(HERE, "..", "..", "..", "..")

const STORE_FILES = ["store.ts", "tags.ts"]

/** Writers whose writes no public trend read can see. A writer that starts to matter calls `trendCatalogChanged()` instead. */
const NO_PUBLIC_CHANGE: Readonly<Record<string, string>> = {
  writeUnpublished: "edits a version only while it was never published (`published_at IS NULL`): a draft",
  reclaimOrphan: "rewrites an unpublished version + 1 row: a draft",
  copyForward: "writes the draft's next version and moves the DRAFT pointer only",
  saveDraft: "writes the draft only (through the three above); a draft reaches guests when it is published",
  restore: "an archived trend comes back unpublished or as a draft: not public before, not public after",
  attachPreviewClip: "the preview's input clip: read by a run, in no public answer",
  createTrend: "a new trend is a draft",
  setFavorite: "a user's favorite: a guest's answer has none, a signed-in one is never kept",
}

const WRITE_RE = /\.(insert|update|upsert|delete|rpc)\(/

/** The source without its comments, so a call named only in a comment does not count. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

/**
 * Each top-level function of a source file (a `function` declaration, or a
 * `const` bound to a function), by name, with its code up to the next
 * top-level declaration of any kind.
 */
function functionsOf(source: string): Array<{ name: string; body: string }> {
  const code = withoutComments(source)
  const starts = [...code.matchAll(/^(?:export )?(?:async )?function (\w+)|^(?:export )?(?:const|let) (\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function\b|\w+\s*=>)|^(?:export )?(?:const|let|class|interface|type|enum) (\w+)/gm)]
  return starts
    .map((m, i) => ({
      name: (m[1] ?? m[2] ?? m[3])!,
      isFunction: m[1] !== undefined || m[2] !== undefined,
      body: code.slice(m.index!, i + 1 < starts.length ? starts[i + 1]!.index : code.length),
    }))
    .filter((f) => f.isFunction)
    .map(({ name, body }) => ({ name, body }))
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "__tests__" ? [] : tsFiles(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
  })
}

describe("every trend store write that a public read can see moves the catalog stamp", () => {
  const writers = STORE_FILES.flatMap((file) =>
    functionsOf(readFileSync(join(TRENDS_LIB, file), "utf8"))
      .filter((f) => WRITE_RE.test(f.body))
      .map((f) => ({ ...f, file })),
  )

  it("finds the writers (the census reads the files it means to)", () => {
    expect(writers.map((w) => w.name)).toEqual(expect.arrayContaining(["publish", "unpublish", "saveDraft", "saveTagLabels"]))
  })

  it("each writer calls trendCatalogChanged() or says why no public read can see its write", () => {
    const silent = writers
      .filter((w) => !w.body.includes("trendCatalogChanged()") && !Object.hasOwn(NO_PUBLIC_CHANGE, w.name))
      .map((w) => `${w.file}: ${w.name}`)
    expect(silent, "call trendCatalogChanged() after the write, or add it to NO_PUBLIC_CHANGE with the reason").toEqual([])
  })

  it("the exempt list names only writers that exist and do not already move the stamp", () => {
    const byName = new Map(writers.map((w) => [w.name, w]))
    for (const name of Object.keys(NO_PUBLIC_CHANGE)) {
      expect(byName.has(name), `${name} no longer writes (or was renamed): drop it from NO_PUBLIC_CHANGE`).toBe(true)
      expect(byName.get(name)!.body.includes("trendCatalogChanged()"), `${name} moves the stamp: drop it from NO_PUBLIC_CHANGE`).toBe(false)
    }
  })
})

describe("the census reads what it means to", () => {
  it("finds an arrow-function writer, ignores a call named only in a comment, and counts rpc as a write", () => {
    const found = functionsOf(
      [
        "export async function publish() {",
        "  await supabase.from('trends').update({})",
        "  await trendCatalogChanged()",
        "}",
        "export const setSortOrder = async (id: string) => {",
        "  // trendCatalogChanged()",
        "  await supabase.from('trends').update({ id })",
        "}",
        "const archiveViaRpc = async () => supabase.rpc('archive_trend')",
        "interface Row { id: string }",
      ].join("\n"),
    )
    expect(found.map((f) => f.name)).toEqual(["publish", "setSortOrder", "archiveViaRpc"])
    expect(found[0]!.body).not.toContain("setSortOrder")
    expect(found[1]!.body.includes("trendCatalogChanged()")).toBe(false)
    expect(WRITE_RE.test(found[2]!.body)).toBe(true)
  })
})

describe("the trend store is the only door to the trend tables", () => {
  it("no backend file outside store.ts and tags.ts names trends, trend_versions or trend_tags in a query", () => {
    const allowed = new Set(STORE_FILES.map((f) => join(TRENDS_LIB, f)))
    const offenders = [...tsFiles(BACKEND_SRC), ...tsFiles(join(BACKEND_SRC, "..", "scripts"))]
      .filter((path) => !allowed.has(path))
      .filter((path) => /\.from\(\s*["'`](trends|trend_versions|trend_tags)["'`]\s*\)/.test(readFileSync(path, "utf8")))
      .map((path) => relative(BACKEND_SRC, path).split(sep).join("/"))
    expect(offenders, "read and write the trend tables through ee/lib/trends/store.ts (or tags.ts)").toEqual([])
  })
})
