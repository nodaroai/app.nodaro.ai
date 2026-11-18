// @test-units-by-name names no node type: it settles usage logs through CreditsService.commitCredits
/**
 * `CreditsService.commitCredits(…, { collectOverHold: true })` settles through
 * `commit_credits_metered` (migration 551), which collects a metered overrun
 * beyond the hold from the payer's balance. Without the option the RPC and its
 * payload are exactly today's — every existing settle caller is unchanged.
 *
 * The TS fallback never settles a collect-over-hold row: flipping it to
 * committed (or retrying through plain `commit_credits`, which records the
 * actual with no pool movement) would silently under-collect. The row stays
 * `reserved` and loud for an RPC retry, as billing-04/H22 does for workspace
 * rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    updates: [] as Array<Record<string, unknown>>,
    usageLogRow: {} as Record<string, unknown>,
  }
  const chain = (result: () => unknown) => {
    const obj: Record<string, unknown> = {}
    for (const m of ["select", "eq", "insert", "in", "limit"]) obj[m] = vi.fn(() => obj)
    obj.update = vi.fn((patch: Record<string, unknown>) => {
      state.updates.push(patch)
      return obj
    })
    obj.single = vi.fn(async () => ({ data: result(), error: null }))
    obj.maybeSingle = vi.fn(async () => ({ data: result(), error: null }))
    return obj
  }
  return {
    state,
    from: vi.fn(() => chain(() => state.usageLogRow)),
    rpc: vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: null, error: null }) as {
      data: unknown
      error: { message: string } | null
    }),
  }
})

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: h.from, rpc: h.rpc } }))

const { CreditsService } = await import("../credits.js")

const rpc = h.rpc

beforeEach(() => {
  vi.clearAllMocks()
  h.state.updates.length = 0
  h.state.usageLogRow = { workspace_id: null, metadata: { from_sub: 368, from_topup: 0 }, on_behalf_of: null }
  rpc.mockImplementation(async () => ({ data: null, error: null }))
})

const settleCalls = () => rpc.mock.calls.filter(([fn]) => String(fn).startsWith("commit_credits"))

describe("commitCredits — collectOverHold", () => {
  it("commitCredits without collectOverHold sends the same RPC payload as today", async () => {
    await CreditsService.commitCredits("log", 27)
    expect(rpc).toHaveBeenCalledWith("commit_credits", { p_usage_log_id: "log", p_actual_credits: 27 })
    expect(settleCalls()).toHaveLength(1)
  })

  it("collectOverHold: false is today's call too", async () => {
    await CreditsService.commitCredits("log", 27, { collectOverHold: false })
    expect(settleCalls()).toEqual([["commit_credits", { p_usage_log_id: "log", p_actual_credits: 27 }]])
  })

  it("collectOverHold calls commit_credits_metered and returns its outcome", async () => {
    rpc.mockResolvedValue({ data: { charged: 468, collected_over_hold: 100, shortfall: 449, payer: "personal" }, error: null })
    expect(await CreditsService.commitCredits("log", 917, { collectOverHold: true })).toEqual({
      charged: 468,
      collectedOverHold: 100,
      shortfall: 449,
    })
    expect(settleCalls()).toEqual([["commit_credits_metered", { p_usage_log_id: "log", p_actual_credits: 917 }]])
  })

  it("the TS fallback leaves a collectOverHold row reserved", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "commit_credits_metered"
        ? { data: null, error: { message: "deadlock detected" } }
        : { data: null, error: null },
    )
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const outcome = await CreditsService.commitCredits("log", 917, { collectOverHold: true })
    expect(outcome).toBeUndefined()
    // No status flip, and no retry through plain commit_credits (which would
    // record 917 with no pool movement — a silent under-collection).
    expect(h.state.updates).toHaveLength(0)
    expect(settleCalls().map(([fn]) => fn)).toEqual(["commit_credits_metered"])
    expect(errors.mock.calls.some(([m]) => String(m).includes("left reserved"))).toBe(true)
    errors.mockRestore()
  })

  it("an RPC answer that is not a settle receipt is refused loudly, never trusted", async () => {
    rpc.mockResolvedValue({ data: { charged: "468" }, error: null })
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await CreditsService.commitCredits("log", 917, { collectOverHold: true })).toBeUndefined()
    expect(h.state.updates).toHaveLength(0)
    errors.mockRestore()
  })

  it("a managed (job-once) reservation still settles from its saved decision first", async () => {
    h.state.usageLogRow = { metadata: { reservation_mode: "job-once" } }
    rpc.mockImplementation(async (fn: string) =>
      fn === "settle_checkpointed_job_reservation"
        ? { data: { managed: true, deferred: true }, error: null }
        : { data: null, error: null },
    )
    expect(await CreditsService.commitCredits("log", 917, { collectOverHold: true })).toBeUndefined()
    expect(settleCalls()).toHaveLength(0)
  })
})

describe("a covered step (lib/covered-step.ts) collects nothing over its hold", () => {
  it("settles at 0 through plain commit_credits, never the metered RPC", async () => {
    h.state.usageLogRow = { workspace_id: null, metadata: { status: "reserved", covered: { by: "pack-1", credits: 120 } }, on_behalf_of: null }
    expect(await CreditsService.commitCredits("log", 917, { collectOverHold: true })).toEqual({ charged: 0, collectedOverHold: 0, shortfall: 0 })
    expect(settleCalls()).toEqual([["commit_credits", { p_usage_log_id: "log", p_actual_credits: 0 }]])
  })

  it("a log whose mark cannot be read is left reserved, never collected", async () => {
    // The managed-settle check reads the log first (managed-job-settlement.ts); the cover read is the
    // second read of its metadata, and only it fails here.
    let metadataReads = 0
    const failing = () => {
      let cols = ""
      const obj: Record<string, unknown> = {}
      for (const m of ["eq", "insert", "in", "limit", "update"]) obj[m] = vi.fn(() => obj)
      obj.select = vi.fn((c: string) => { cols = c; return obj })
      obj.single = vi.fn(async () => ({ data: h.state.usageLogRow, error: null }))
      obj.maybeSingle = vi.fn(async () => {
        if (cols === "metadata" && ++metadataReads === 2) return { data: null, error: { message: "boom" } }
        return { data: h.state.usageLogRow, error: null }
      })
      return obj
    }
    h.from.mockImplementation(failing)
    try {
      expect(await CreditsService.commitCredits("log", 917, { collectOverHold: true })).toBeUndefined()
      expect(settleCalls()).toEqual([])
    } finally {
      h.from.mockImplementation(() => {
        const obj: Record<string, unknown> = {}
        for (const m of ["select", "eq", "insert", "in", "limit", "update"]) obj[m] = vi.fn(() => obj)
        obj.single = vi.fn(async () => ({ data: h.state.usageLogRow, error: null }))
        obj.maybeSingle = vi.fn(async () => ({ data: h.state.usageLogRow, error: null }))
        return obj
      })
    }
  })

  it("an ordinary metered log still collects its overrun", async () => {
    rpc.mockResolvedValue({ data: { charged: 917, collected_over_hold: 549, shortfall: 0, payer: "personal" }, error: null })
    expect(await CreditsService.commitCredits("log", 917, { collectOverHold: true })).toEqual({ charged: 917, collectedOverHold: 549, shortfall: 0 })
  })
})
