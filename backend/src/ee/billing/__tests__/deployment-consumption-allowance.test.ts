/**
 * Track A — what `/usage` answers on a deployment-payer instance (spec §9.1).
 *
 * `deploymentConsumptionAccount` was written to answer `balance: null`
 * deliberately: no balance existed at user grain, because the requester's own
 * profile row is a frozen signup grant nothing debits and the payer's pool is
 * the operator's private figure. The per-user allowance changes exactly that
 * one fact — there is now a number that is honestly the requester's — so
 * `balance` becomes what they have LEFT and `allocated` what they were
 * GRANTED, both raw credits, converted once at the display-unit seam.
 *
 * Two properties this file exists to hold:
 *  1. An unavailable allowance nulls the two BALANCE fields and nothing else.
 *     The period's consumption and its breakdown are a different read with a
 *     different failure mode; losing the whole page because a settings row
 *     could not be read would be the "null means zero" bug wearing a coat.
 *  2. Mainline never grows an `allocated` key. Absent ≠ null (billing rule:
 *     the wire shape a client already handles must not change).
 *
 * A NOTE ON WHY THIS FILE EXISTS AT ALL rather than new cases inside
 * `nodaro-cloud-provider.test.ts`: that file belongs to no workstream in the
 * Track A plan, and R1 forbids editing what you do not own. Fold it in later
 * if an owner appears.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, tableResponses, tablesTouched, state } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const tablesTouched: string[] = []
  const state = { payerActive: true, payerId: "payer-acct", enforce: true }
  function chainFor(table: string) {
    const res = tableResponses.get(table) ?? { data: null, error: null }
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "gte", "order", "limit"]) chain[m] = vi.fn(() => chain)
    chain.maybeSingle = vi.fn(async () => res)
    chain.single = vi.fn(async () => res)
    // The usage_logs read awaits the builder itself (`.limit(CAP)` is the
    // last call), so the chain has to be thenable.
    chain.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad)
    return chain
  }
  const mockFrom = vi.fn((table: string) => {
    tablesTouched.push(table)
    return chainFor(table)
  })
  return { mockFrom, tableResponses, tablesTouched, state }
})

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: mockFrom } }))
vi.mock("../../../lib/deployment-payer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/deployment-payer.js")>()
  return {
    ...actual,
    deploymentPayerActive: () => state.payerActive,
    deploymentPayerId: () => (state.payerActive ? state.payerId : null),
    allowanceEnforcementActive: () => state.payerActive && state.enforce,
  }
})
vi.mock("../../../lib/surface-profile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/surface-profile.js")>()
  return {
    ...actual,
    runtimeSurfaceProfile: () => ({
      ...actual.SURFACE_PROFILE_DEFAULT,
      billing: { ...actual.SURFACE_PROFILE_DEFAULT.billing, allowances: state.enforce ? "enforce" : "off" },
    }),
  }
})

import { nodaroCloudBillingProvider } from "../nodaro-cloud-provider.js"
import { __resetDeploymentAllowanceCacheForTests } from "../deployment-allowance-service.js"

const USER = "requester-1"

function consumption(rows: Array<{ action: string; credits_used: number }>): void {
  tableResponses.set("usage_logs", { data: rows.map((r) => ({ ...r, status: "committed" })), error: null })
}

beforeEach(() => {
  tableResponses.clear()
  tablesTouched.length = 0
  mockFrom.mockClear()
  __resetDeploymentAllowanceCacheForTests()
  state.payerActive = true
  state.payerId = "payer-acct"
  state.enforce = true
})

describe("/usage under a deployment payer", () => {
  it("answers remaining as `balance` and granted as `allocated`, in RAW credits", async () => {
    consumption([{ action: "flux", credits_used: 40 }, { action: "kling-video", credits_used: 60 }])
    tableResponses.set("deployment_user_allowances", {
      data: { user_id: USER, granted_credits: 400_000, reserved_credits: 0, spent_credits: 100 },
      error: null,
    })
    const a = (await nodaroCloudBillingProvider.account(USER))!

    expect(a.balance).toBe(399_900)
    expect(a.allocated).toBe(400_000)
    expect(a.unit).toBe("credits") // raw — the seam relabels and converts
    // The consumption half is untouched.
    expect(a.generations).toBe(2)
    expect(a.byCategory?.map((c) => c.category).sort()).toEqual(["image", "video"])
  })

  it("a user with NO row sees the default in both fields (D7 — nothing here re-derives it)", async () => {
    consumption([])
    tableResponses.set("deployment_user_allowances", { data: null, error: null })
    tableResponses.set("deployment_payer_settings", { data: { default_allowance_credits: 400_000 }, error: null })
    const a = (await nodaroCloudBillingProvider.account(USER))!

    expect(a.balance).toBe(400_000)
    expect(a.allocated).toBe(400_000)
  })

  it("an UNAVAILABLE allowance nulls the two balance fields and keeps the consumption", async () => {
    consumption([{ action: "flux", credits_used: 40 }])
    tableResponses.set("deployment_user_allowances", { data: null, error: { message: "relation does not exist" } })
    const a = (await nodaroCloudBillingProvider.account(USER))!

    expect(a).not.toBeNull()
    expect(a.balance).toBeNull()
    expect(a.allocated).toBeNull()
    expect(a.generations).toBe(1)
    expect(a.byCategory).toHaveLength(1)
  })

  it("before the flip (allowances off) the fields are REAL — this is the surface §9.1 says must stop lying", async () => {
    // THE DISPLAY / ENFORCEMENT RULING. /usage renders at rollout step 5, two
    // steps before `billing.allowances` flips to "enforce". Answering null
    // there is what §9.1 calls a lie: the page falls back to the frozen signup
    // grant. Visibility is `deploymentPayerActive()`; refusing a run is a
    // separate switch this provider never touches.
    state.enforce = false
    consumption([])
    tableResponses.set("deployment_user_allowances", {
      data: { user_id: USER, granted_credits: 400_000, reserved_credits: 0, spent_credits: 100 },
      error: null,
    })
    const a = (await nodaroCloudBillingProvider.account(USER))!

    expect(a.balance).toBe(399_900)
    expect(a.allocated).toBe(400_000)
    expect(tablesTouched).toContain("deployment_user_allowances")
  })

  it("the consumption read failing still returns null for the whole account (unchanged)", async () => {
    tableResponses.set("usage_logs", { data: null, error: { message: "boom" } })
    expect(await nodaroCloudBillingProvider.account(USER)).toBeNull()
  })

  it("mainline: no payer ⇒ the profile branch, and NO `allocated` key at all", async () => {
    state.payerActive = false
    state.enforce = false
    tableResponses.set("profiles", {
      data: {
        tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0,
        subscription_credits: 100, topup_credits: 5, app_credits_allowance: 20,
      },
      error: null,
    })
    const a = (await nodaroCloudBillingProvider.account(USER))!

    expect(a.balance).toBe(105)
    expect(Object.hasOwn(a, "allocated")).toBe(false)
    expect(tablesTouched).not.toContain("usage_logs")
  })
})
