import { describe, it, expect, vi } from "vitest"

const chain = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = []
  const q: Record<string, unknown> = {}
  for (const m of ["delete", "in", "is", "lt"]) q[m] = vi.fn((...a: unknown[]) => { calls.push([m, a]); return q })
  q.select = vi.fn(() => Promise.resolve({ data: [{ id: "a" }, { id: "b" }], error: null }))
  return { q, calls }
})
vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn(() => chain.q) } }))

const { sweepStaleDcrRegistrations, STALE_DCR_REGISTRATION_AGE_MS } = await import("../oauth-dcr-sweep.js")

describe("sweepStaleDcrRegistrations (#708)", () => {
  it("deletes only DCR kinds, only unconsented, only older than the cap window", async () => {
    const now = Date.UTC(2026, 7, 17, 12, 0, 0)
    const { deleted } = await sweepStaleDcrRegistrations(now)
    expect(deleted).toBe(2)
    const by = (m: string) => chain.calls.filter(([n]) => n === m).map(([, a]) => a)
    expect(by("in")).toEqual([["kind", ["dynamic_mcp", "community_instance"]]])
    expect(by("is")).toEqual([["owner_user_id", null]])
    expect(by("lt")).toEqual([["created_at", new Date(now - STALE_DCR_REGISTRATION_AGE_MS).toISOString()]])
    expect(STALE_DCR_REGISTRATION_AGE_MS).toBe(24 * 60 * 60 * 1000)
  })
})
