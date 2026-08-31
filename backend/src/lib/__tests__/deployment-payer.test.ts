/**
 * Deployment payer (SAI item 9) — the boot resolution + the inert invariant.
 * What these pin: absent config touches NOTHING (zero queries, inactive —
 * the property that makes this mergeable to a mainline that never configures
 * a payer); a configured payer resolves by uuid or email and FAILS the boot
 * result when it cannot (app.ts turns that into exit(1)); the context is
 * requester-keyed with the payer in `payerId`, never the other way around.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  payerAccount: undefined as string | undefined,
  hasCredits: vi.fn(() => true),
  profileRow: { data: { id: "", tier: "basic", subscription_tier: null, lifetime_topup_credits: 0 }, error: null } as {
    data: unknown
    error: unknown
  },
  listUsersPages: [] as Array<{ users: Array<{ id: string; email?: string }> }>,
  listUsers: vi.fn(),
  fromCalls: 0,
}))

vi.mock("../surface-profile.js", () => ({
  runtimeSurfaceProfile: () => ({ billing: { payerAccount: h.payerAccount } }),
}))
vi.mock("../config.js", () => ({ hasCredits: h.hasCredits }))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: (_table: string) => {
      h.fromCalls++
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => h.profileRow }) }),
      }
    },
    auth: { admin: { listUsers: h.listUsers } },
  },
}))

const {
  configureDeploymentPayer,
  deploymentPayerActive,
  deploymentPayerId,
  deploymentBillingContext,
  __resetDeploymentPayerForTests,
} = await import("../deployment-payer.js")

const PAYER_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

beforeEach(() => {
  vi.clearAllMocks()
  h.payerAccount = undefined
  h.hasCredits.mockReturnValue(true)
  h.profileRow = { data: { id: PAYER_UUID, tier: "basic", subscription_tier: null, lifetime_topup_credits: 0 }, error: null }
  h.fromCalls = 0
  h.listUsers.mockImplementation(async ({ page }: { page: number }) => ({
    data: h.listUsersPages[page - 1] ?? { users: [] },
    error: null,
  }))
})
afterEach(() => __resetDeploymentPayerForTests())

describe("configureDeploymentPayer — inert when absent", () => {
  it("no payerAccount ⇒ ok, inactive, ZERO queries (the mainline invariant)", async () => {
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(deploymentPayerActive()).toBe(false)
    expect(deploymentPayerId()).toBeNull()
    expect(h.fromCalls).toBe(0)
    expect(h.listUsers).not.toHaveBeenCalled()
  })

  it("configured on an edition without credits ⇒ refused (nothing to redirect)", async () => {
    h.payerAccount = PAYER_UUID
    h.hasCredits.mockReturnValue(false)
    const r = await configureDeploymentPayer()
    expect(r.ok).toBe(false)
    expect(deploymentPayerActive()).toBe(false)
  })
})

describe("configureDeploymentPayer — uuid and email resolution", () => {
  it("a uuid with a profile row activates, entitlements at the payer's grade", async () => {
    h.payerAccount = PAYER_UUID
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(deploymentPayerActive()).toBe(true)
    expect(deploymentPayerId()).toBe(PAYER_UUID)
    const ctx = deploymentBillingContext("req-user")
    expect(ctx).toEqual({
      payer: "deployment",
      userId: "req-user", // the REQUESTER — ownership semantics
      payerId: PAYER_UUID, // the DEBIT target
      entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "basic" },
    })
  })

  it("a uuid with NO profile row refuses — fail-loud, not requester-billed", async () => {
    h.payerAccount = PAYER_UUID
    h.profileRow = { data: null, error: null }
    const r = await configureDeploymentPayer()
    expect(r.ok).toBe(false)
    expect(deploymentPayerActive()).toBe(false)
  })

  it("an email resolves through the paged listUsers scan (case-insensitive)", async () => {
    h.payerAccount = "Billing@sai-app.com"
    h.listUsersPages = [{ users: [{ id: "other", email: "x@y.z" }, { id: PAYER_UUID, email: "billing@sai-app.com" }] }]
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(deploymentPayerId()).toBe(PAYER_UUID)
  })

  it("an email with no matching auth user refuses", async () => {
    h.payerAccount = "nobody@sai-app.com"
    h.listUsersPages = [{ users: [{ id: "other", email: "x@y.z" }] }]
    const r = await configureDeploymentPayer()
    expect(r.ok).toBe(false)
    expect(deploymentPayerActive()).toBe(false)
  })
})

describe("deploymentBillingContext — misuse guard", () => {
  it("throws while inactive — callers must gate on deploymentPayerActive()", () => {
    expect(() => deploymentBillingContext("u-1")).toThrow(/inactive/)
  })
})
