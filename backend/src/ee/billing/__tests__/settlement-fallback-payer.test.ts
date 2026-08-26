/**
 * The settlement TS fallbacks are PAYER-AWARE (billing-04/H22, second-review
 * finding 2026-08-26): when the commit/refund RPC fails and the usage log is
 * WORKSPACE-paid, the fallback must refuse — leave the row `reserved` and
 * touch no balance. The old zero-split branch would otherwise MINT the
 * class's money into the member's personal topup pool (workspace rows never
 * carry from_sub/from_topup), and a status flip would strand the workspace's
 * reserved headroom beyond any reconciliation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    updates: [] as Array<Record<string, unknown>>,
    usageLogRow: {} as Record<string, unknown>,
  }
  const chain = (result: () => unknown) => {
    const obj: Record<string, unknown> = {}
    for (const m of ["select", "eq", "insert"]) obj[m] = vi.fn(() => obj)
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
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args })
      // The settlement RPCs fail; everything else (add_*_credits) succeeds.
      if (fn === "commit_credits" || fn === "refund_credits") {
        return { data: null, error: { message: "deadlock detected" } }
      }
      return { data: true, error: null }
    }),
  }
})

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: h.from, rpc: h.rpc } }))

const { CreditsService } = await import("../credits.js")

beforeEach(() => {
  vi.clearAllMocks()
  h.state.rpcCalls.length = 0
  h.state.updates.length = 0
})

describe("workspace-paid rows are NEVER settled by the TS fallbacks", () => {
  it("refund fallback: no balance write, no status flip — the row stays reserved for an RPC retry", async () => {
    h.state.usageLogRow = {
      user_id: "u-1",
      job_id: "j-1",
      credits_used: 40,
      status: "reserved",
      metadata: { payer: { kind: "workspace" } }, // no from_sub/from_topup — by construction
      workspace_id: "ws-1",
    }
    await CreditsService.refundCredits("log-ws")
    const balanceWrites = h.state.rpcCalls.filter((c) => c.fn.startsWith("add_"))
    expect(balanceWrites).toHaveLength(0)
    expect(h.state.updates).toHaveLength(0)
  })

  it("commit fallback: refuses the status flip that would strand the class's reserved headroom", async () => {
    h.state.usageLogRow = { workspace_id: "ws-1" }
    await CreditsService.commitCredits("log-ws", 12)
    expect(h.state.updates).toHaveLength(0)
  })

  it("personal rows keep the old fallback behavior — the zero-split branch restores to topup", async () => {
    h.state.usageLogRow = {
      user_id: "u-1",
      job_id: "j-1",
      credits_used: 40,
      status: "reserved",
      metadata: {},
      workspace_id: null,
    }
    await CreditsService.refundCredits("log-personal")
    const topup = h.state.rpcCalls.find((c) => c.fn === "add_topup_credits")
    expect(topup?.args).toMatchObject({ p_user_id: "u-1", p_credits: 40 })
  })
})
