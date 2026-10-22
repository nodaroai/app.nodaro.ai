/**
 * Trend tag labels (ee/lib/trends/tags.ts, migration 555).
 *
 * What must hold: the public tag list counts only PUBLISHED trends' tags; a
 * label is the reader's language, else English, else the tag itself; labels
 * are keyed by the exact tag string; saving no label removes the tag's row;
 * a database without the tables reads as `TrendsUnavailableError`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { has, type QueryResult, type RecordedQuery } from "../../../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

import { TrendsUnavailableError } from "../store.js"
import { allTagUsage, publishedTagUsage, readTagLabels, saveTagLabels, tagLabel } from "../tags.js"

beforeEach(() => {
  db.log.length = 0
  db.respond = () => ({ data: null, error: null })
})

const MISSING = { code: "PGRST205", message: "Could not find the table" }

describe("publishedTagUsage", () => {
  it("counts the tags of published trends only, most used first, then by tag", async () => {
    db.respond = () => ({
      data: [{ tags: ["dance", "duo"] }, { tags: ["dance"] }, { tags: ["pets", "Dance"] }, { tags: null }],
      error: null,
    })
    expect(await publishedTagUsage()).toEqual([
      { tag: "dance", count: 2 },
      { tag: "Dance", count: 1 },
      { tag: "duo", count: 1 },
      { tag: "pets", count: 1 },
    ])
    const [q] = db.log
    expect(q!.table).toBe("trends")
    expect(has(q!, "eq", "status", "published")).toBe(true)
  })

  it("a database without the trend tables is TrendsUnavailableError", async () => {
    db.respond = () => ({ data: null, error: MISSING })
    await expect(publishedTagUsage()).rejects.toBeInstanceOf(TrendsUnavailableError)
  })

  it("any other read error throws", async () => {
    db.respond = () => ({ data: null, error: { message: "down" } })
    await expect(publishedTagUsage()).rejects.toThrow(/down/)
  })
})

describe("allTagUsage", () => {
  it("counts every trend's tags (any status) and the published ones apart", async () => {
    db.respond = () => ({
      data: [
        { status: "published", tags: ["dance"] },
        { status: "draft", tags: ["dance", "wip"] },
        { status: "unpublished", tags: ["old"] },
      ],
      error: null,
    })
    const usage = await allTagUsage()
    expect(Object.fromEntries(usage)).toEqual({
      dance: { trends: 2, published: 1 },
      wip: { trends: 1, published: 0 },
      old: { trends: 1, published: 0 },
    })
  })
})

describe("readTagLabels", () => {
  it("reads the given tags' labels, keeping only string labels of platform languages", async () => {
    db.respond = () => ({
      data: [
        { tag: "dance", labels: { en: "Dance", he: "ריקוד", xx: "nope", ja: 5 } },
        { tag: "pets", labels: "not an object" },
        { tag: "other", labels: { en: "Other" } },
      ],
      error: null,
    })
    const labels = await readTagLabels(["dance", "pets"])
    expect(Object.fromEntries(labels)).toEqual({ dance: { en: "Dance", he: "ריקוד" }, pets: {} })
    const [q] = db.log
    expect(q!.table).toBe("trend_tags")
  })

  it("matches the tags in memory: no tag is ever put in the query, whatever it holds", async () => {
    const odd = ['say "hi"', "it's", "a,b", "(x)", "back\\slash"]
    db.respond = () => ({ data: odd.map((tag) => ({ tag, labels: { en: tag.toUpperCase() } })), error: null })
    const labels = await readTagLabels(odd)
    expect([...labels.keys()]).toEqual(odd)
    expect(db.log).toHaveLength(1)
    expect(db.log[0]!.ops.some((op) => op.m === "in")).toBe(false)
    expect(JSON.stringify(db.log[0]!.ops)).not.toContain("hi")
  })

  it("reads nothing for no tags", async () => {
    expect((await readTagLabels([])).size).toBe(0)
    expect(db.log).toHaveLength(0)
  })

  it("without a list, reads every row", async () => {
    db.respond = () => ({ data: [{ tag: "a", labels: {} }], error: null })
    await readTagLabels()
    expect(db.log[0]!.ops.some((op) => op.m === "in")).toBe(false)
  })

  it("a database without trend_tags is TrendsUnavailableError", async () => {
    db.respond = () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } })
    await expect(readTagLabels(["a"])).rejects.toBeInstanceOf(TrendsUnavailableError)
  })
})

describe("saveTagLabels", () => {
  it("upserts the tag's non-empty labels, trimmed", async () => {
    db.respond = () => ({ data: null, error: null })
    const saved = await saveTagLabels("dance", { en: " Dance ", he: "ריקוד", ja: "  " })
    expect(saved).toEqual({ en: "Dance", he: "ריקוד" })
    const [q] = db.log
    expect(q!.table).toBe("trend_tags")
    const upsert = q!.ops.find((op) => op.m === "upsert")!
    expect(upsert.a[0]).toMatchObject({ tag: "dance", labels: { en: "Dance", he: "ריקוד" } })
    expect(typeof (upsert.a[0] as { updated_at?: unknown }).updated_at).toBe("string")
    expect(upsert.a[1]).toEqual({ onConflict: "tag" })
  })

  it("no label left deletes the tag's row", async () => {
    db.respond = () => ({ data: null, error: null })
    expect(await saveTagLabels("dance", { en: "", he: " " })).toEqual({})
    const [q] = db.log
    expect(q!.ops.some((op) => op.m === "delete")).toBe(true)
    expect(has(q!, "eq", "tag", "dance")).toBe(true)
  })

  it("a database without trend_tags is TrendsUnavailableError", async () => {
    db.respond = () => ({ data: null, error: MISSING })
    await expect(saveTagLabels("dance", { en: "Dance" })).rejects.toBeInstanceOf(TrendsUnavailableError)
  })
})

describe("tagLabel", () => {
  it("is the locale's label, else English, else the tag itself", () => {
    expect(tagLabel("dance", { en: "Dance", he: "ריקוד" }, "he")).toBe("ריקוד")
    expect(tagLabel("dance", { en: "Dance" }, "he")).toBe("Dance")
    expect(tagLabel("dance", { he: "ריקוד" }, "ja")).toBe("dance")
    expect(tagLabel("dance", undefined, "he")).toBe("dance")
    expect(tagLabel("dance", { en: "" }, "en")).toBe("dance")
  })
})
