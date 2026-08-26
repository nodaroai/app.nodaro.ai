/**
 * `GET /v1/library` paging — the boundary between two pages.
 *
 * The listing orders by `created_at DESC`, and `created_at` defaults to
 * `NOW()`, which is the TRANSACTION timestamp: every asset written by one
 * multi-file upload shares a value to the microsecond. A bare
 * `created_at.lt.<ts>` cursor therefore SKIPS every row tied with the last
 * row of a page — land a boundary inside such a group and the rest of it
 * silently disappears from the listing.
 *
 * `lib/keyset-cursor.ts` documents this at length and exists because of it.
 * This route predates its own paging consumer; the copilot's `@` picker is
 * the first surface that scrolls it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const calls = vi.hoisted(() => ({ or: [] as string[], order: [] as unknown[][] }))

vi.mock("@/lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 })
      }
      if (prop === "single" || prop === "maybeSingle") {
        // The cursor lookup: the row whose id the client sent.
        return async () => ({ data: { created_at: "2026-08-01T00:00:00+00:00" }, error: null })
      }
      return (...args: unknown[]) => {
        if (prop === "or") calls.or.push(String(args[0]))
        if (prop === "order") calls.order.push(args)
        return proxy
      }
    },
  })
  return { supabase: { from: () => proxy } }
})
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", R2_PUBLIC_URL: "https://pub-test.r2.dev" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

const { libraryRoutes } = await import("../library.js")

const USER = "11111111-1111-4111-8111-111111111111"
const CURSOR = "22222222-2222-4222-8222-222222222222"
let app: FastifyInstance

beforeEach(async () => {
  calls.or = []
  calls.order = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const q = req.query as Record<string, unknown> | undefined
    if (typeof q?.userId === "string") req.userId = q.userId
  })
  await app.register(async (i) => libraryRoutes(i))
  await app.ready()
})
afterEach(async () => app.close())

describe("the page boundary", () => {
  it("orders by created_at THEN id — without the tie-break there is no defined boundary", async () => {
    await app.inject({ method: "GET", url: `/v1/library?userId=${USER}` })
    expect(calls.order[0]).toEqual(["created_at", { ascending: false }])
    expect(calls.order[1]).toEqual(["id", { ascending: false }])
  })

  it("asks for rows strictly AFTER the cursor row, ties included", async () => {
    await app.inject({ method: "GET", url: `/v1/library?userId=${USER}&cursor=${CURSOR}` })
    const predicate = calls.or.find((o) => o.includes("created_at.lt."))
    expect(predicate, "the cursor predicate is missing").toBeTruthy()
    // The second clause is the whole point: rows sharing the cursor's
    // timestamp are still reachable, ordered by id.
    expect(predicate).toContain(`and(created_at.eq.2026-08-01T00:00:00+00:00,id.lt.${CURSOR})`)
  })

  it("does not fall back to a bare timestamp comparison", async () => {
    // `.lt("created_at", …)` as a standalone filter is what silently drops
    // every row tied with the boundary.
    const bare = calls.or.filter((o) => o.startsWith("created_at.lt.") && !o.includes("and("))
    expect(bare).toEqual([])
  })

  it("applies no cursor predicate on the first page", async () => {
    await app.inject({ method: "GET", url: `/v1/library?userId=${USER}` })
    expect(calls.or.some((o) => o.includes("created_at.lt."))).toBe(false)
  })
})
