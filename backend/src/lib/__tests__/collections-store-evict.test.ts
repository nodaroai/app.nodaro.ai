/**
 * Eviction past the cap is BOUNDED per write: a cap that fell at once (a lapsed
 * plan, billing briefly reading "free") trims a big collection a little per
 * write instead of deleting most of it in one go.
 */
import { describe, expect, it, vi } from "vitest"
import { COLLECTION_EVICT_MAX_PER_WRITE } from "@nodaro/shared"

type Step = { data?: unknown; error?: { message: string } | null; count?: number | null }
const steps = vi.hoisted(() => ({ queue: [] as Step[], calls: [] as Array<{ method: string; args: unknown[] }> }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const result = steps.queue.shift() ?? {}
      const resolved = { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }
      const qb: Record<string, unknown> = {}
      for (const name of ["select", "delete", "eq", "or", "in", "order", "limit", "range"]) {
        qb[name] = vi.fn((...args: unknown[]) => {
          steps.calls.push({ method: name, args })
          return qb
        })
      }
      qb.maybeSingle = vi.fn(() => Promise.resolve({ data: resolved.data, error: resolved.error }))
      qb.then = (resolve: (v: unknown) => unknown) => resolve(resolved)
      return qb
    },
  },
}))
vi.mock("@/lib/config.js", () => ({ config: { EDITION: "cloud" }, hasCredits: () => true, isCloud: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true }))

import { evictPastCap } from "../collections-store.js"

const req = { log: { warn: vi.fn() } } as never
const COLL = "00000000-0000-4000-8000-0000000000c1"
const USER = "00000000-0000-4000-8000-000000000001"

describe("evictPastCap", () => {
  it("removes the oldest records past the boundary, at most COLLECTION_EVICT_MAX_PER_WRITE of them, by a bounded id list", async () => {
    const ids = Array.from({ length: COLLECTION_EVICT_MAX_PER_WRITE }, (_, i) => `id-${i}`)
    steps.calls.length = 0
    steps.queue = [
      { count: 5_000 }, // the collection holds 5,000 records
      { data: { created_at: "2026-10-06T08:00:00.000Z", id: "edge" } }, // the 500th newest
      { data: ids.map((id) => ({ id })) }, // the oldest 100 past it
      { count: ids.length }, // deleted
    ]
    const evicted = await evictPastCap(req, COLL, USER, 500)
    expect(evicted).toBe(COLLECTION_EVICT_MAX_PER_WRITE)
    const limit = steps.calls.find((c) => c.method === "limit")
    expect(limit?.args).toEqual([COLLECTION_EVICT_MAX_PER_WRITE])
    const del = steps.calls.find((c) => c.method === "in")
    expect(del?.args).toEqual(["id", ids])
    // Oldest first: the boundary filter, then ascending order.
    const orders = steps.calls.filter((c) => c.method === "order").map((c) => c.args)
    expect(orders).toContainEqual(["created_at", { ascending: true }])
  })

  it("within the cap, nothing is touched; with no cap, nothing is counted", async () => {
    steps.calls.length = 0
    steps.queue = [{ count: 120 }]
    expect(await evictPastCap(req, COLL, USER, 500)).toBe(0)
    expect(steps.calls.some((c) => c.method === "delete")).toBe(false)
    steps.calls.length = 0
    expect(await evictPastCap(req, COLL, USER, null)).toBe(0)
    expect(steps.calls).toEqual([])
  })
})
