/**
 * Deployment payer (item 9) at the RESERVATION — what these pin:
 * the debit user becomes the PAYER account (`p_user_id`) while the
 * positional requester keeps the job; the requester is stamped into
 * `usage_logs.on_behalf_of` — and, since Track A, by the RPC's OWN insert
 * rather than by a second statement afterwards (D5); auto-recharge never
 * fires for a deployment payer (prepaid-only); the ledger row is payer-keyed;
 * and — the merge condition — a call WITHOUT a deployment context is
 * byte-identical to pre-payer behavior.
 *
 * Track A adds the two trailing RPC parameters (D3): `p_on_behalf_of` is
 * ATTRIBUTION and rides from rollout step 3; `p_enforce_allowance` is
 * ENFORCEMENT and stays FALSE until the step-8 flip. They are separate
 * switches, and the tests below pin that they can be set independently —
 * a single combined condition would have made step 3 refuse the instance.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockFrom, mockRpc, mockAutoRecharge, mockEnforce, mockPayerActive, mockInvalidate,
  tableResponses, updateCalls, insertCalls,
} = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const updateCalls: Array<{ table: string; values: unknown; eq: unknown[] }> = []
  const insertCalls: Array<{ table: string; values: unknown }> = []

  function createChain(table: string, response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockImplementation((values: unknown) => {
        insertCalls.push({ table, values })
        return chain
      }),
      update: vi.fn().mockImplementation((values: unknown) => {
        const call = { table, values, eq: [] as unknown[] }
        updateCalls.push(call)
        return {
          eq: vi.fn().mockImplementation((...args: unknown[]) => {
            call.eq.push(args)
            return Promise.resolve({ error: null })
          }),
        }
      }),
    }
    return chain
  }

  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(table, tableResponses.get(table) ?? null))
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockAutoRecharge = vi.fn().mockResolvedValue(undefined)
  const mockEnforce = vi.fn().mockReturnValue(false)
  const mockPayerActive = vi.fn().mockReturnValue(false)
  const mockInvalidate = vi.fn()

  return {
    mockFrom, mockRpc, mockAutoRecharge, mockEnforce, mockPayerActive, mockInvalidate,
    tableResponses, updateCalls, insertCalls,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: mockRpc },
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("../auto-recharge.js", () => ({ attemptAutoRecharge: mockAutoRecharge }))
// The enforcement switch is boot state in the real module; here it is a dial,
// so a single test can prove attribution-without-enforcement (the step-3
// window) and enforcement-on independently.
vi.mock("@/lib/deployment-payer.js", () => ({
  allowanceEnforcementActive: mockEnforce,
  deploymentPayerActive: mockPayerActive,
}))
// `credits.ts` reaches the balance cache through `await import()` — a static
// ee/billing -> ee/routes edge would close a cycle (routes/credits.ts imports
// billing/credits.ts). Mocked so a unit test does not drag the whole route
// module (openapi-registry, signup-grant, oauth-register) into its graph.
// Precedent: free-grant-activation.test.ts:30.
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: mockInvalidate }))

import { CreditsService, invalidateModelPricingCache } from "../credits.js"
import type { BillingContext } from "../../../lib/billing-context.js"

const REQUESTER = "user-123"
const PAYER = "payer-acct-uuid"
const DEP_CTX: BillingContext = {
  payer: "deployment",
  userId: REQUESTER,
  payerId: PAYER,
  entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "basic" },
}

function mockTable(table: string, data: unknown, error: unknown = null): void {
  tableResponses.set(table, { data, error })
}

beforeEach(() => {
  tableResponses.clear()
  updateCalls.length = 0
  insertCalls.length = 0
  mockFrom.mockClear()
  mockRpc.mockClear()
  mockAutoRecharge.mockClear()
  mockInvalidate.mockClear()
  mockEnforce.mockClear()
  mockEnforce.mockReturnValue(false)
  mockPayerActive.mockClear()
  mockPayerActive.mockReturnValue(false)
  invalidateModelPricingCache()
  mockTable("model_pricing", { credit_cost: 5, is_enabled: true, tier_restriction: null })
  // The profile read is the DEBIT user's — a free-tier row here would
  // watermark a personal call but must not watermark a deployment one.
  mockTable("profiles", { tier: "free", subscription_tier: null, lifetime_topup_credits: 0, subscription_credits: 100, topup_credits: 0 })
  mockTable("usage_logs", { id: "log-1", metadata: { from_sub: 5, from_topup: 0 } })
})

describe("reserveCredits under a deployment payer", () => {
  it("debits the PAYER: p_user_id is the payer account, daily cap off, watermark off", async () => {
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    const result = await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, {
      billingContext: DEP_CTX,
    })
    expect(mockRpc).toHaveBeenCalledWith(
      "reserve_credits",
      expect.objectContaining({ p_user_id: PAYER, p_credits: 5, p_job_id: "job-1", p_daily_limit: null }),
    )
    // The requester's free tier must NOT watermark deployment-paid work —
    // the payer's grade (watermark: false, literal) decides.
    expect(result.watermark).toBe(false)
    expect(result.usageLogId).toBe("log-1")
  })

  it("attribution rides IN the RPC — the post-hoc usage_logs UPDATE is gone (D5)", async () => {
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, { billingContext: DEP_CTX })
    // Migration 382's reserve names `on_behalf_of` in its OWN insert. The
    // second statement that used to stamp it could fail on its own (and did,
    // loudly, on a DB that predated 362), leaving a row whose money moved but
    // whose attribution did not. Nothing may write it afterwards.
    expect(updateCalls.filter((c) => c.table === "usage_logs")).toEqual([])
    expect(mockRpc).toHaveBeenCalledWith(
      "reserve_credits",
      expect.objectContaining({ p_on_behalf_of: REQUESTER }),
    )
  })

  it("D3: p_on_behalf_of and p_enforce_allowance are SEPARATE switches", async () => {
    // Rollout step 3 turns attribution on for every call site while the
    // allowance tables are still empty and no default is configured. With one
    // combined condition that window would create a zero-granted row on every
    // requester's first reserve and refuse the whole instance.
    mockEnforce.mockReturnValue(false)
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, { billingContext: DEP_CTX })
    expect(mockRpc).toHaveBeenCalledWith(
      "reserve_credits",
      expect.objectContaining({ p_on_behalf_of: REQUESTER, p_enforce_allowance: false }),
    )

    // …and the step-8 flip turns exactly one of them true.
    mockRpc.mockClear()
    mockEnforce.mockReturnValue(true)
    mockRpc.mockResolvedValueOnce({ data: "log-2", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-2", "flux", 0.05, 0.0625, { billingContext: DEP_CTX })
    expect(mockRpc).toHaveBeenCalledWith(
      "reserve_credits",
      expect.objectContaining({ p_on_behalf_of: REQUESTER, p_enforce_allowance: true }),
    )
  })

  it("the PAYER's own run passes neither parameter (D13 — the payer holds real credits)", async () => {
    // The payer has no allowance; it owns the pool. Passing p_on_behalf_of =
    // p_user_id would lean on the RPC's own exemption to save us, and
    // answering `remaining: 0` for the payer would refuse its own runs at the
    // canvas precheck. The exemption exists in SQL as well (behaviour case 8);
    // this is the belt.
    mockEnforce.mockReturnValue(true)
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    const payerCtx: BillingContext = { ...DEP_CTX, userId: PAYER }
    await CreditsService.reserveCredits(PAYER, "job-1", "flux", 0.05, 0.0625, { billingContext: payerCtx })
    const args = mockRpc.mock.calls.at(-1)![1] as Record<string, unknown>
    expect(args).not.toHaveProperty("p_on_behalf_of")
    expect(args).not.toHaveProperty("p_enforce_allowance")
  })

  it("invalidates the REQUESTER's balance cache — their allowance just moved", async () => {
    // The balance read is cached for 15 s. Under a payer that read carries the
    // requester's allowance, not the payer's wallet, so a reserve that does
    // not invalidate leaves the sidebar showing credits the user no longer has.
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, { billingContext: DEP_CTX })
    expect(mockInvalidate).toHaveBeenCalledWith(REQUESTER)
  })

  it("NEVER auto-recharges a deployment payer — prepaid-only, no card to pump", async () => {
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, { billingContext: DEP_CTX })
    expect(mockAutoRecharge).not.toHaveBeenCalled()
  })

  it("the ledger row is PAYER-keyed — the payer's transaction page is the audit trail", async () => {
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, { billingContext: DEP_CTX })
    const tx = insertCalls.find((c) => c.table === "credit_transactions")
    expect(tx).toBeDefined()
    expect(tx!.values).toMatchObject({ user_id: PAYER, amount: -5 })
    expect((tx!.values as { description: string }).description).toContain(REQUESTER)
  })

  it("zero-cost path: the row stays REQUESTER-owned, marked with the payer, unwatermarked", async () => {
    mockTable("model_pricing", { credit_cost: 0, is_enabled: true, tier_restriction: null })
    const result = await CreditsService.reserveCredits(REQUESTER, "job-1", "free-model", 0, 0, {
      billingContext: DEP_CTX,
    })
    expect(mockRpc).not.toHaveBeenCalledWith("reserve_credits", expect.anything())
    const log = insertCalls.find((c) => c.table === "usage_logs")
    expect(log).toBeDefined()
    const values = log!.values as { user_id: string; credits_used: number; on_behalf_of?: string; metadata: Record<string, unknown> }
    expect(values.user_id).toBe(REQUESTER)
    expect(values.credits_used).toBe(0)
    // The bypass writes the row itself, so it must mirror what the RPC writes
    // — the COLUMN and the payer object — or commit and refund cannot read it.
    expect(values.on_behalf_of).toBe(REQUESTER)
    // `allowance_enforced: false` is load-bearing, not decoration: commit and
    // refund branch on `COALESCE(metadata->'payer'->>'allowance_enforced', FALSE)`,
    // and a bypass row that ever said true would settle against a reservation
    // that never happened. No cost was reserved here, so it is always false.
    expect(values.metadata.payer).toEqual({
      kind: "deployment",
      account: PAYER,
      allowance_enforced: false,
    })
    expect(result.watermark).toBe(false)
  })

  it("zero-cost MAINLINE: no on_behalf_of key, no payer object", async () => {
    mockTable("model_pricing", { credit_cost: 0, is_enabled: true, tier_restriction: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "free-model", 0, 0, {})
    const values = insertCalls.find((c) => c.table === "usage_logs")!.values as Record<string, unknown>
    expect(values).not.toHaveProperty("on_behalf_of")
    expect(values.metadata).not.toHaveProperty("payer")
  })

  it("BYTE-EQUIVALENCE control: without a deployment context nothing above happens", async () => {
    // Enforcement ON at the deployment level, to prove the gate is the
    // billing CONTEXT and not the switch: a personal call on a payer instance
    // (there is no such thing today, but the code must not assume it) still
    // sends the pre-Track-A wire shape.
    mockEnforce.mockReturnValue(true)
    mockPayerActive.mockReturnValue(true)
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, {})
    // The KEY SET, not a subset match: `objectContaining` and `toEqual` both
    // pass an object that grew a parameter, and "the personal call's wire
    // shape is unchanged" is exactly a claim about keys that are ABSENT.
    const args = mockRpc.mock.calls.at(-1)![1] as Record<string, unknown>
    expect(Object.keys(args).sort()).toEqual([
      "p_credits",
      "p_daily_limit",
      "p_display_cost_usd",
      "p_is_app_run",
      "p_job_id",
      "p_model_identifier",
      "p_provider_cost_usd",
      "p_user_id",
      "p_web_free_mode",
    ])
    expect(args.p_user_id).toBe(REQUESTER)
    expect(updateCalls.filter((c) => c.table === "usage_logs")).toEqual([])
    expect(mockInvalidate).not.toHaveBeenCalled()
    const tx = insertCalls.find((c) => c.table === "credit_transactions")
    expect(tx!.values).toMatchObject({ user_id: REQUESTER })
    expect(mockAutoRecharge).toHaveBeenCalledWith(REQUESTER)
  })
})

/**
 * The D12 rider. `commitCredits` / `refundCredits` are given only a usage-log
 * id, so the requester whose ALLOWANCE just moved has to be read back off the
 * row. That read is the one thing here that costs a query, so it is gated on
 * `deploymentPayerActive()` — mainline settles exactly as it did before,
 * issuing no extra statement at all.
 */
describe("settlement drops the requester's cached balance", () => {
  it("commit on a payer instance invalidates the REQUESTER, not the payer", async () => {
    mockPayerActive.mockReturnValue(true)
    mockTable("usage_logs", { id: "log-1", user_id: PAYER, on_behalf_of: REQUESTER, metadata: {} })
    await CreditsService.commitCredits("log-1", 5)
    expect(mockInvalidate).toHaveBeenCalledWith(REQUESTER)
    expect(mockInvalidate).not.toHaveBeenCalledWith(PAYER)
  })

  it("refund on a payer instance invalidates the REQUESTER — the allowance came back", async () => {
    mockPayerActive.mockReturnValue(true)
    mockTable("usage_logs", { id: "log-1", user_id: PAYER, on_behalf_of: REQUESTER, metadata: {} })
    await CreditsService.refundCredits("log-1")
    expect(mockInvalidate).toHaveBeenCalledWith(REQUESTER)
  })

  it("a payer-instance row with no requester (the payer's own run) invalidates nothing", async () => {
    mockPayerActive.mockReturnValue(true)
    mockTable("usage_logs", { id: "log-1", user_id: PAYER, on_behalf_of: null, metadata: {} })
    await CreditsService.commitCredits("log-1", 5)
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it("MAINLINE control: commit and refund issue no extra read and invalidate nothing", async () => {
    mockPayerActive.mockReturnValue(false)
    await CreditsService.commitCredits("log-1", 5)
    await CreditsService.refundCredits("log-1")
    // The RPC succeeds and both wrappers return before touching a table. A
    // single `usage_logs` read here would be a new query on every settled job
    // of every mainline deployment.
    expect(mockFrom.mock.calls.filter((c) => c[0] === "usage_logs")).toEqual([])
    expect(mockInvalidate).not.toHaveBeenCalled()
  })
})

/**
 * The two DIRECT-RPC reserve lanes. `reservePipelineCredits` and
 * `reserveHelperCredits` call `reserve_credits` themselves rather than going
 * through `CreditsService.reserveCredits`, so every rule proved above has to
 * be proved again here — a lane that kept the post-hoc stamp, or that never
 * learned `p_enforce_allowance`, would let a user spend past their allowance
 * simply by starting a pipeline instead of pressing Generate.
 */
describe("the direct-RPC reserve lanes", () => {
  /** Minimal injected client: these two functions take their own. */
  function fakeClient(rpcResult: { data: unknown; error: unknown }) {
    const rpc = vi.fn().mockResolvedValue(rpcResult)
    const updates: Array<{ table: string; values: unknown }> = []
    const from = vi.fn().mockImplementation((table: string) => ({
      update: (values: unknown) => {
        updates.push({ table, values })
        return { eq: async () => ({ error: null }) }
      },
    }))
    return { client: { rpc, from } as never, rpc, from, updates }
  }

  it("pipeline reserve: both parameters ride, and nothing stamps afterwards", async () => {
    const { reservePipelineCredits } = await import("../../pipelines/credits.js")
    mockEnforce.mockReturnValue(true)
    const f = fakeClient({ data: "log-1", error: null })
    const res = await reservePipelineCredits({
      supabase: f.client, userId: REQUESTER, pipelineId: "pl-1", credits: 40, billingContext: DEP_CTX,
    })
    expect(res.ok).toBe(true)
    expect(f.rpc).toHaveBeenCalledWith(
      "reserve_credits",
      expect.objectContaining({ p_user_id: PAYER, p_on_behalf_of: REQUESTER, p_enforce_allowance: true }),
    )
    // The only UPDATE left is the reservation link on `pipelines` — the
    // `usage_logs` attribution write is the RPC's job now (D5).
    expect(f.updates.filter((u) => u.table === "usage_logs")).toEqual([])
    expect(f.updates.map((u) => u.table)).toEqual(["pipelines"])
  })

  it("scene-helper reserve: both parameters ride, and nothing stamps afterwards", async () => {
    const { reserveHelperCredits } = await import("../../pipelines/scene-helper-credits.js")
    mockEnforce.mockReturnValue(true)
    const f = fakeClient({ data: "log-1", error: null })
    const res = await reserveHelperCredits({
      supabase: f.client, userId: REQUESTER, helperName: "reword" as never, billingContext: DEP_CTX,
    })
    expect(res.ok).toBe(true)
    expect(f.rpc).toHaveBeenCalledWith(
      "reserve_credits",
      expect.objectContaining({ p_user_id: PAYER, p_on_behalf_of: REQUESTER, p_enforce_allowance: true }),
    )
    expect(f.updates).toEqual([])
  })

  it("MAINLINE control: a personal pipeline reserve's key set is unchanged", async () => {
    const { reservePipelineCredits } = await import("../../pipelines/credits.js")
    mockEnforce.mockReturnValue(true)
    const f = fakeClient({ data: "log-1", error: null })
    await reservePipelineCredits({ supabase: f.client, userId: REQUESTER, pipelineId: "pl-1", credits: 40 })
    const args = f.rpc.mock.calls.at(-1)![1] as Record<string, unknown>
    expect(Object.keys(args).sort()).toEqual([
      "p_credits",
      "p_display_cost_usd",
      "p_is_app_run",
      "p_job_id",
      "p_model_identifier",
      "p_provider_cost_usd",
      "p_user_id",
    ])
    expect(args.p_user_id).toBe(REQUESTER)
  })

  it("the payer's own pipeline run passes neither parameter (D13)", async () => {
    const { reservePipelineCredits } = await import("../../pipelines/credits.js")
    mockEnforce.mockReturnValue(true)
    const f = fakeClient({ data: "log-1", error: null })
    await reservePipelineCredits({
      supabase: f.client, userId: PAYER, pipelineId: "pl-1", credits: 40,
      billingContext: { ...DEP_CTX, userId: PAYER },
    })
    const args = f.rpc.mock.calls.at(-1)![1] as Record<string, unknown>
    expect(args).not.toHaveProperty("p_on_behalf_of")
    expect(args).not.toHaveProperty("p_enforce_allowance")
  })

  it("a pipeline refund drops the requester's cached balance — the allowance came back", async () => {
    // This lane calls `refund_credits` directly rather than through
    // CreditsService.refundCredits, so it does not inherit that wrapper's
    // invalidation. It already HAS the requester (`args.userId`), so no read
    // is needed — only the payer gate, which is false on mainline.
    const { refundPipelineCredits } = await import("../../pipelines/credits.js")
    mockPayerActive.mockReturnValue(true)
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const client = {
      rpc,
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { reservation_usage_log_id: "log-1" }, error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    } as never
    await refundPipelineCredits({ supabase: client, userId: REQUESTER, pipelineId: "pl-1", reason: "failed" })
    expect(rpc).toHaveBeenCalledWith("refund_credits", { p_usage_log_id: "log-1" })
    expect(mockInvalidate).toHaveBeenCalledWith(REQUESTER)

    // MAINLINE: nothing at all.
    mockInvalidate.mockClear()
    mockPayerActive.mockReturnValue(false)
    await refundPipelineCredits({ supabase: client, userId: REQUESTER, pipelineId: "pl-1", reason: "failed" })
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it("USER_ALLOWANCE_EXCEEDED survives the substring pre-filter as its own code", async () => {
    // `pipelines/credits.ts` classifies by `includes("insufficient")` BEFORE
    // consulting the map. If the prefix ever gained that word the pipeline
    // lane would answer `insufficient_credits` and the user would be told to
    // contact an administrator who cannot help them.
    const { reservePipelineCredits } = await import("../../pipelines/credits.js")
    const f = fakeClient({
      data: null,
      error: { message: "USER_ALLOWANCE_EXCEEDED: granted 400000, remaining 4000, need 12000" },
    })
    const res = await reservePipelineCredits({
      supabase: f.client, userId: REQUESTER, pipelineId: "pl-1", credits: 40, billingContext: DEP_CTX,
    })
    expect(res).toEqual({
      ok: false,
      reason: "user_allowance_exceeded",
      detail: "Your allowance cannot cover this run",
    })
  })
})
