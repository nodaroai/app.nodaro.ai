// P14/W4e — the pipeline lane's ONE payer, read from the durable stamp.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getPipelineBillingContext, clearPipelineBillingContextCache, stampPipelineConfig } from "../pipeline-payer.js"
import type { BillingContext } from "../../../lib/billing-context.js"

const WS_CTX: BillingContext = {
  payer: "workspace",
  userId: "creator-1",
  workspaceId: "ws-1",
  orgId: "org-1",
  memberCap: null,
  entitlements: {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business",
    freeTierBlocklist: false,
    webFreeMode: false,
    appCreditsAllowance: false,
  },
}

function makeSupabase(row: { user_id?: string; config?: unknown } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { client: { from } as never, from }
}

beforeEach(() => {
  clearPipelineBillingContextCache()
})

describe("getPipelineBillingContext", () => {
  it("returns the stamped workspace payer verbatim", async () => {
    const { client } = makeSupabase({ user_id: "creator-1", config: { billingContext: WS_CTX } })
    const ctx = await getPipelineBillingContext(client, "p-1", "caller-1")
    expect(ctx).toEqual(WS_CTX)
  })

  it("an UNSTAMPED pipeline (pre-P14) reads as the creator's personal payer", async () => {
    const { client } = makeSupabase({ user_id: "creator-1", config: { music_enabled: true } })
    const ctx = await getPipelineBillingContext(client, "p-1", "caller-1")
    expect(ctx).toEqual({ payer: "user", userId: "creator-1" })
  })

  it("a MALFORMED stamp degrades to personal — never a trusted cast", async () => {
    const { client } = makeSupabase({
      user_id: "creator-1",
      config: { billingContext: { payer: "workspace", workspaceId: "evil" } },
    })
    const ctx = await getPipelineBillingContext(client, "p-1", "caller-1")
    expect(ctx).toEqual({ payer: "user", userId: "creator-1" })
  })

  it("a missing row falls back to the caller's personal payer", async () => {
    const { client } = makeSupabase(null)
    const ctx = await getPipelineBillingContext(client, "p-1", "caller-1")
    expect(ctx).toEqual({ payer: "user", userId: "caller-1" })
  })

  it("caches per pipeline — the payer is immutable once stamped", async () => {
    const { client, from } = makeSupabase({ user_id: "creator-1", config: { billingContext: WS_CTX } })
    await getPipelineBillingContext(client, "p-1", "caller-1")
    await getPipelineBillingContext(client, "p-1", "caller-1")
    expect(from).toHaveBeenCalledTimes(1)
  })

  it("a DB READ ERROR answers DEGRADED personal and caches NOTHING — the next read retries", async () => {
    // A transient blip must not silently and durably re-point a
    // workspace-paid pipeline at a member's pocket (the caching was the
    // sharp edge the review caught).
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValueOnce({ data: { user_id: "creator-1", config: { billingContext: WS_CTX } }, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    const client = { from } as never

    const first = await getPipelineBillingContext(client, "p-err", "caller-1")
    expect(first).toEqual({ payer: "user", userId: "caller-1", degraded: true })

    const second = await getPipelineBillingContext(client, "p-err", "caller-1")
    expect(second).toEqual(WS_CTX)
    expect(from).toHaveBeenCalledTimes(2)
  })
})

describe("stampPipelineConfig — the ONE strip-then-stamp rule (create/seed/branch)", () => {
  it("a FORGED caller-supplied stamp never survives — even when nothing replaces it", () => {
    const forged = { payer: "workspace", workspaceId: "evil" }
    const out = stampPipelineConfig({ music_enabled: true, billingContext: forged }, undefined)
    expect(out).toEqual({ music_enabled: true })
  })

  it("the RESOLVED payer replaces whatever rode in", () => {
    const out = stampPipelineConfig(
      { music_enabled: false, billingContext: { payer: "workspace", workspaceId: "evil" } },
      WS_CTX,
    )
    expect(out).toEqual({ music_enabled: false, billingContext: WS_CTX })
  })

  it("null/absent config stamps cleanly", () => {
    expect(stampPipelineConfig(null, WS_CTX)).toEqual({ billingContext: WS_CTX })
    expect(stampPipelineConfig(undefined, undefined)).toEqual({})
  })
})

describe("getPipelineBillingContext — deployment payer stamps (SAI item 9)", () => {
  const DEP_CTX: BillingContext = {
    payer: "deployment",
    userId: "creator-1",
    payerId: "payer-acct",
    entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "basic" },
  }

  it("a stamped DEPLOYMENT payer is honored verbatim — never degraded to the creator's pocket", async () => {
    // isBillingContext guards the PLUGIN boundary and rejects this shape;
    // without the second guard every pipeline on a deployment-payer
    // instance would silently bill the requester's frozen grant.
    const { client } = makeSupabase({ user_id: "creator-1", config: { billingContext: DEP_CTX } })
    const ctx = await getPipelineBillingContext(client, "p-1", "caller-1")
    expect(ctx).toEqual(DEP_CTX)
  })

  it("a FORGED deployment stamp that relaxes a literal degrades to personal", async () => {
    for (const relaxed of [{ watermark: true }, { dailyCapCredits: 500 }, { parallelism: "lots" }]) {
      clearPipelineBillingContextCache()
      const { client } = makeSupabase({
        user_id: "creator-1",
        config: { billingContext: { ...DEP_CTX, entitlements: { ...DEP_CTX.entitlements, ...relaxed } } },
      })
      const ctx = await getPipelineBillingContext(client, "p-1", "caller-1")
      expect(ctx, JSON.stringify(relaxed)).toEqual({ payer: "user", userId: "creator-1" })
    }
  })

  it("a deployment stamp missing payerId degrades to personal", async () => {
    const { client } = makeSupabase({
      user_id: "creator-1",
      config: { billingContext: { payer: "deployment", userId: "creator-1" } },
    })
    const ctx = await getPipelineBillingContext(client, "p-1", "caller-1")
    expect(ctx).toEqual({ payer: "user", userId: "creator-1" })
  })
})
