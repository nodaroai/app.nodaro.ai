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

// ---------------------------------------------------------------------------
// Track A: the DEPLOYMENT analogue of the same defect (F5)
// ---------------------------------------------------------------------------
//
// An ENFORCED reservation is held in two places: the payer's pools, and
// `deployment_user_allowances.reserved_credits`. Only the SQL settlers move the
// second (382:689 commit, 382:855 refund). The ledger arithmetic this pins,
// reproduced on the rehearsal DB: payer sub 1000, requester granted 100,
// enforce on, reserve 60 → ledger g=100 r=60 s=0 and payer_sub=940. If the TS
// fallback flips `status` to 'refunded' and restores 60 to the payer, the money
// is right and the requester is left at r=60 FOREVER — both SQL settlers key on
// `status='reserved'` and nothing recomputes `reserved_credits` — so the user
// sees remaining 40 of 100 for a job that failed and was fully refunded.
//
// The guard is the SAME PAIR the SQL branches on: `metadata.payer.
// allowance_enforced` (stamped at reserve time, D4) AND a non-null
// `on_behalf_of`. Not `on_behalf_of` alone: a row reserved before the
// `billing.allowances` flip carries attribution but never bumped a ledger and
// must settle normally.
const ENFORCED_ROW = {
  user_id: "payer-1", // the DEBIT user is the payer under a deployment payer
  job_id: "j-9",
  credits_used: 60,
  status: "reserved",
  metadata: { from_sub: 60, from_topup: 0, payer: { kind: "deployment", account: "payer-1", allowance_enforced: true } },
  workspace_id: null,
  on_behalf_of: "u-1",
}

describe("allowance-enforced rows are NEVER settled by the TS fallbacks", () => {
  it("refund fallback: no status flip, no pool restore — the reservation stays healable", async () => {
    h.state.usageLogRow = { ...ENFORCED_ROW }

    await CreditsService.refundCredits("log-allow")

    // A flip to 'refunded' is the unrecoverable step: it takes the row out of
    // reach of `refund_credits`, which is the only thing that can release the
    // 60 reserved credits.
    expect(h.state.updates).toHaveLength(0)
    expect(h.state.rpcCalls.filter((c) => c.fn.startsWith("add_"))).toHaveLength(0)
  })

  it("commit fallback: refuses the status flip that would strand the requester's quota", async () => {
    h.state.usageLogRow = { workspace_id: null, on_behalf_of: "u-1", metadata: { payer: { allowance_enforced: true } } }

    await CreditsService.commitCredits("log-allow", 55)

    expect(h.state.updates).toHaveLength(0)
  })

  it("a payer row reserved BEFORE the enforcement flip still settles — the ledger was never touched", async () => {
    // `allowance_enforced: false` is what `reserve_credits` stamps while
    // `billing.allowances` is off. Refusing these would strand ordinary rows
    // for no reason, which is why the guard is the conjunction and not
    // `on_behalf_of != null`.
    h.state.usageLogRow = {
      ...ENFORCED_ROW,
      metadata: { ...ENFORCED_ROW.metadata, payer: { kind: "deployment", account: "payer-1", allowance_enforced: false } },
    }

    await CreditsService.refundCredits("log-preflip")

    expect(h.state.updates).toEqual([{ status: "refunded" }])
    const sub = h.state.rpcCalls.find((c) => c.fn === "add_subscription_credits")
    expect(sub?.args).toMatchObject({ p_user_id: "payer-1", p_credits: 60 })
  })

  it("the payer's OWN run (no on_behalf_of) settles exactly as it does today", async () => {
    h.state.usageLogRow = {
      ...ENFORCED_ROW,
      metadata: { from_sub: 60, from_topup: 0 },
      on_behalf_of: null,
    }

    await CreditsService.refundCredits("log-payer-own")

    expect(h.state.updates).toEqual([{ status: "refunded" }])
    expect(h.state.rpcCalls.find((c) => c.fn === "add_subscription_credits")?.args).toMatchObject({ p_credits: 60 })
  })
})
