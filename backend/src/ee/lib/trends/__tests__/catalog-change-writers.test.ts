/**
 * Each store write a public trend read can see moves the catalog stamp after
 * it succeeded (catalog-stamp.ts) — on every path that writes, which the
 * census (catalog-change-census.test.ts) cannot see — and a write that failed
 * moves nothing. Tag labels: tags.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { QueryResult, RecordedQuery } from "../../../../lib/__tests__/fake-supabase-query.js"
import type { TrendVersionData, TrendWebCopy } from "../types.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

import { archive, attachDisplayCopy, attachWebCopies, publish, unpublish, updateTrendMeta } from "../store.js"
import { _resetTrendCatalogCacheForTests } from "../catalog-stamp.js"

const T = "00000000-0000-4000-8000-0000000000a1"
const SOURCE = "https://cdn.example/trends/t1/source.mp4"
const EXAMPLE = "https://cdn.example/trends/t1/ex1.mp4"

const TREND_ROW = {
  id: T,
  slug: "neon-dance",
  status: "published",
  tags: ["dance"],
  badges: [],
  sort_order: 0,
  draft_version: 2,
  published_version: 2,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
}

function versionData(): TrendVersionData {
  return {
    source: { videoUrl: SOURCE, durationSec: 12, width: 720, height: 1280 },
    examples: [{ videoUrl: EXAMPLE, width: 720, height: 1280, durationSec: 12, slots: {} }],
  } as unknown as TrendVersionData
}

const isWrite = (q: RecordedQuery) => q.ops.some((op) => ["update", "insert", "upsert", "delete"].includes(op.m))
const stampWrites = () => db.log.filter((q) => q.table === "app_settings" && isWrite(q)).length

/**
 * A database where every trend read finds the published trend and every write
 * lands (`refuseWrites`: every write fails). The fake records no `maybeSingle`,
 * so a write's answer is told by what it selects: the pointer moves select
 * `id` and get rows; the catalog-field update selects the row.
 */
function database(opts: { refuseWrites?: boolean } = {}): void {
  db.respond = (q) => {
    if (q.table === "app_settings") return { data: null, error: null }
    if (isWrite(q)) {
      if (opts.refuseWrites) return { data: null, error: { message: "down" } }
      if (q.table === "trend_versions") return { data: [{ version: 2 }], error: null }
      const selected = q.ops.find((op) => op.m === "select")?.a[0]
      return { data: selected === "id" ? [{ id: T }] : TREND_ROW, error: null }
    }
    if (q.table === "trends") return { data: TREND_ROW, error: null }
    return { data: { data: versionData(), revision: "r1", published_at: null }, error: null }
  }
}

beforeEach(() => {
  db.log.length = 0
  database()
  _resetTrendCatalogCacheForTests()
})

const WRITERS: Array<[string, () => Promise<unknown>]> = [
  ["publish", () => publish(T)],
  ["unpublish", () => unpublish(T)],
  ["archive", () => archive(T)],
  ["updateTrendMeta", () => updateTrendMeta(T, { tags: ["dance", "duo"] })],
  [
    "attachDisplayCopy",
    () => attachDisplayCopy(T, 2, { videoUrl: "https://cdn.example/trends/t1/display.mp4", posterUrl: "https://cdn.example/trends/t1/display.png", width: 720, height: 1280, durationSec: 12 }),
  ],
  [
    "attachWebCopies",
    () => attachWebCopies(T, 2, [{ videoUrl: "https://cdn.example/trends/t1/ex1-web.mp4", madeFrom: EXAMPLE, sizeBytes: 1000 } as TrendWebCopy]),
  ],
]

describe("a public write moves the catalog stamp once it landed", () => {
  for (const [name, write] of WRITERS) {
    it(`${name}`, async () => {
      await write()
      expect(stampWrites(), name).toBe(1)
    })
  }

  it("a write the database refused moves nothing", async () => {
    database({ refuseWrites: true })
    for (const [name, write] of WRITERS) {
      db.log.length = 0
      const outcome = await write().then(() => "resolved", () => "rejected")
      expect(`${name}: ${outcome}`).toBe(`${name}: rejected`)
      expect(stampWrites(), name).toBe(0)
    }
  })
})
