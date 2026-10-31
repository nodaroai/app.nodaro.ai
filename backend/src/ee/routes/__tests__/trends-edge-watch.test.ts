/**
 * The trend routes start the API process's edge watch (catalog-stamp.ts):
 * registering them is what makes this process drop the edge's copies when the
 * catalog stamp moves, wherever the change was made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import type { QueryResult, RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

const purges = vi.hoisted(() => ({ requested: 0 }))
vi.mock("../../lib/trends/edge-purge.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/trends/edge-purge.js")>()),
  trendCatalogEdgeConfigured: () => true,
  requestTrendCatalogEdgePurge: () => {
    purges.requested += 1
  },
}))

import { trendRoutes } from "../trends.js"
import { EDGE_WATCH_MS, _resetTrendCatalogCacheForTests } from "../../lib/trends/catalog-stamp.js"

beforeEach(() => {
  vi.useFakeTimers()
  db.log.length = 0
  purges.requested = 0
  _resetTrendCatalogCacheForTests()
})

afterEach(() => {
  _resetTrendCatalogCacheForTests()
  vi.useRealTimers()
})

describe("registering the trend routes", () => {
  it("starts the edge watch: a stamp moved by another process is purged within one look", async () => {
    db.respond = () => ({ data: { value: "s1" }, error: null })
    const app = Fastify({ logger: false })
    await app.register(trendRoutes)
    await app.ready()
    try {
      await vi.advanceTimersByTimeAsync(EDGE_WATCH_MS)
      expect(purges.requested).toBe(0)
      db.respond = () => ({ data: { value: "s2" }, error: null })
      await vi.advanceTimersByTimeAsync(EDGE_WATCH_MS)
      expect(purges.requested).toBe(1)
    } finally {
      await app.close()
    }
  })
})
