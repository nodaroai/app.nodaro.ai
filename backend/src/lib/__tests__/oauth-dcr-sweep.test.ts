import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The sweep deletes `developer_apps` rows, and `app_id` cascades to
 * authorizations and tokens — so "unclaimed" must never be treated as
 * "never consented". See the module docstring (#708 review finding).
 */
const state = vi.hoisted(() => ({
  candidates: [] as Array<{ id: string }>,
  authorized: [] as Array<{ app_id: string }>,
  deletedIds: [] as string[],
  findError: null as { message: string } | null,
}))

vi.mock("../supabase.js", () => {
  const from = vi.fn((table: string) => {
    if (table === "developer_apps") {
      const q: Record<string, unknown> = {}
      q.select = vi.fn(() => q)
      q.in = vi.fn((_c: string, v: string[]) => { q.__in = v; return q })
      q.is = vi.fn(() => q)
      q.lt = vi.fn(() => q)
      q.limit = vi.fn(() => Promise.resolve({ data: state.candidates, error: state.findError }))
      q.delete = vi.fn(() => {
        const d: Record<string, unknown> = {}
        d.in = vi.fn((_c: string, ids: string[]) => {
          state.deletedIds = ids
          return { select: vi.fn(() => Promise.resolve({ data: ids.map((id) => ({ id })), error: null })) }
        })
        return d
      })
      return q
    }
    return {
      select: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: state.authorized, error: null })) })),
    }
  })
  return { supabase: { from } }
})

const { sweepStaleDcrRegistrations, STALE_DCR_REGISTRATION_AGE_MS } = await import("../oauth-dcr-sweep.js")

describe("sweepStaleDcrRegistrations (#708)", () => {
  beforeEach(() => { state.candidates = []; state.authorized = []; state.deletedIds = []; state.findError = null })

  it("deletes unclaimed rows nobody ever consented to", async () => {
    state.candidates = [{ id: "a" }, { id: "b" }]
    const res = await sweepStaleDcrRegistrations(Date.UTC(2026, 7, 18, 12))
    expect(res).toEqual({ deleted: 2, keptAuthorized: 0 })
    expect(state.deletedIds).toEqual(["a", "b"])
  })

  it("NEVER deletes a row that has an authorization, even when owner_user_id is null", async () => {
    // The production shape the day this shipped: community_instance rows whose
    // consent completed before oauth.ts learned to claim them. Deleting one
    // cascades to developer_app_authorizations → developer_app_tokens and
    // disconnects a live install.
    state.candidates = [{ id: "consented-but-unclaimed" }, { id: "truly-abandoned" }]
    state.authorized = [{ app_id: "consented-but-unclaimed" }]
    const res = await sweepStaleDcrRegistrations(Date.UTC(2026, 7, 18, 12))
    expect(state.deletedIds).toEqual(["truly-abandoned"])
    expect(res).toEqual({ deleted: 1, keptAuthorized: 1 })
  })

  it("deletes nothing when every candidate is authorized", async () => {
    state.candidates = [{ id: "x" }]
    state.authorized = [{ app_id: "x" }]
    const res = await sweepStaleDcrRegistrations()
    expect(state.deletedIds).toEqual([])
    expect(res).toEqual({ deleted: 0, keptAuthorized: 1 })
  })

  it("no candidates → no delete call, no authorization lookup", async () => {
    expect(await sweepStaleDcrRegistrations()).toEqual({ deleted: 0, keptAuthorized: 0 })
    expect(state.deletedIds).toEqual([])
  })

  it("surfaces a read failure instead of deleting on partial knowledge", async () => {
    state.findError = { message: "boom" }
    await expect(sweepStaleDcrRegistrations()).rejects.toThrow(/stale DCR sweep failed: boom/)
    expect(state.deletedIds).toEqual([])
  })

  it("keeps the 24h window", () => {
    expect(STALE_DCR_REGISTRATION_AGE_MS).toBe(24 * 60 * 60 * 1000)
  })
})
