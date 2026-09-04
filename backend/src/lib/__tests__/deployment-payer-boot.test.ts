/**
 * Track A — the BOOT REFUSALS around the deployment payer (spec D15).
 *
 * Three things must stop a payer instance from coming up, and each of them is
 * a state where continuing costs real money or re-opens a leak:
 *
 *   1. THE PAYER IS SSO-FEDERATED. A federated payer means the CUSTOMER's
 *      identity provider owns the account that holds Nodaro's credits — the
 *      customer can re-assert it at will. `requirePlatformOperator` already
 *      refuses federated accounts on the money routes for exactly this reason;
 *      the payer identity itself needs the same rule, one layer earlier.
 *   2. THE SETTINGS WRITE FAILED. Migration 381's narrowed `profiles` policy
 *      is a no-op while `payer_user_id` is NULL, so a silent miss boots an
 *      instance where every customer-minted admin can read the payer's real
 *      balance. (The payload's own properties are proved in
 *      `deployment-payer-settings-upsert.test.ts`; what this file adds is the
 *      ORDER — nothing is written before the federation check passes.)
 *   3. B5 — A FREE/PAYG PAYER UNDER `PAYG_WEB_BLOCK_ENABLED`. The payg web
 *      block resolves the pool at the PAYER's tier, and a card top-up turns a
 *      free payer into `payg`. With the flag on, every browser run would then
 *      raise SUBSCRIPTION_REQUIRED against a free pool of 0: money paid,
 *      nothing runs. Latent today (the flag defaults off) — which is exactly
 *      why it needs a boot refusal rather than a runbook line.
 *
 * MAINLINE (R2): with no `billing.payerAccount` the module answers "not
 * active" to every predicate and issues zero queries — asserted below, because
 * this file adds a NEW admin read (`auth.admin.getUserById`) to the payer path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Billing = {
  payerAccount?: string
  defaultAllowanceUnits?: number
  unitRate?: number
  allowances?: "off" | "enforce"
}

const PAYER_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

const h = vi.hoisted(() => ({
  billing: {} as Billing,
  hasCredits: vi.fn(() => true),
  /** `app_metadata` the admin API answers for the resolved payer. */
  payerAppMetadata: {} as Record<string, unknown>,
  getUserByIdError: null as { message: string } | null,
  getUserByIdCalls: [] as string[],
  listUsersCalls: 0,
  settingsWrites: 0,
  upsertError: null as { message: string } | null,
}))

vi.mock("../surface-profile.js", () => ({
  runtimeSurfaceProfile: () => ({ billing: h.billing }),
}))
vi.mock("../config.js", () => ({ hasCredits: h.hasCredits }))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "deployment_payer_settings") {
        h.settingsWrites++
        return {
          upsert: async () => ({ error: h.upsertError }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: PAYER_UUID, tier: "basic", subscription_tier: null, lifetime_topup_credits: 0 },
              error: null,
            }),
          }),
        }),
      }
    },
    auth: {
      admin: {
        listUsers: async () => {
          h.listUsersCalls++
          return { data: { users: [{ id: PAYER_UUID, email: "support@sai-app.com" }] }, error: null }
        },
        getUserById: async (id: string) => {
          h.getUserByIdCalls.push(id)
          if (h.getUserByIdError) return { data: null, error: h.getUserByIdError }
          return { data: { user: { id, app_metadata: h.payerAppMetadata } }, error: null }
        },
      },
    },
  },
}))

const {
  configureDeploymentPayer,
  deploymentPayerActive,
  deploymentPayerId,
  deploymentDefaultAllowanceCredits,
  payerFederatedConflict,
  payerWebFreeConflict,
  __resetDeploymentPayerForTests,
  __setDeploymentPayerForTests,
} = await import("../deployment-payer.js")

beforeEach(() => {
  h.billing = {}
  h.hasCredits.mockReturnValue(true)
  h.payerAppMetadata = {}
  h.getUserByIdError = null
  h.getUserByIdCalls = []
  h.listUsersCalls = 0
  h.settingsWrites = 0
  h.upsertError = null
})
afterEach(() => __resetDeploymentPayerForTests())

describe("mainline is untouched (R2)", () => {
  it("no payerAccount ⇒ no admin read, no settings write, nothing active", async () => {
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(h.getUserByIdCalls).toEqual([])
    expect(h.listUsersCalls).toBe(0)
    expect(h.settingsWrites).toBe(0)
    expect(deploymentPayerActive()).toBe(false)
  })

  it("the two new conflict predicates answer null with no payer", () => {
    expect(payerFederatedConflict(false)).toBeNull()
    expect(payerWebFreeConflict(true)).toBeNull()
  })
})

describe("D15.1 — a federated payer refuses boot", () => {
  it("app_metadata.sso on the payer ⇒ ok:false, INACTIVE, and NOTHING written", async () => {
    h.billing = { payerAccount: PAYER_UUID }
    h.payerAppMetadata = { sso: { provider: "sai" } }

    const r = await configureDeploymentPayer()

    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/federat/i)
    expect(deploymentPayerActive()).toBe(false)
    expect(deploymentPayerId()).toBeNull()
    // ORDER is the property: the settings row names the payer to the RLS
    // helper. Writing it for an account we are about to refuse would leave a
    // federated uuid installed as `payer_user_id` in a database whose API then
    // exits — and the next boot of an older image would trust it.
    expect(h.settingsWrites).toBe(0)
  })

  it("an unreadable payer account refuses boot (fail closed, never fail open)", async () => {
    h.billing = { payerAccount: PAYER_UUID }
    h.getUserByIdError = { message: "connection reset" }

    const r = await configureDeploymentPayer()

    expect(r.ok).toBe(false)
    expect(deploymentPayerActive()).toBe(false)
    expect(h.settingsWrites).toBe(0)
  })

  it("a plain password payer boots, and IS checked (one admin read)", async () => {
    h.billing = { payerAccount: PAYER_UUID }
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(h.getUserByIdCalls).toEqual([PAYER_UUID])
    expect(deploymentPayerId()).toBe(PAYER_UUID)
    expect(h.settingsWrites).toBeGreaterThan(0)
  })

  it("the predicate is pure: false ⇒ null, true ⇒ a reason naming the IdP", () => {
    expect(payerFederatedConflict(false)).toBeNull()
    const reason = payerFederatedConflict(true)
    expect(reason).toBeTruthy()
    expect(reason).toMatch(/identity provider/i)
  })
})

describe("D15.2 — a failed settings write refuses boot", () => {
  it("upsert error ⇒ ok:false and the payer stays inactive", async () => {
    h.billing = { payerAccount: PAYER_UUID }
    h.upsertError = { message: "permission denied for table deployment_payer_settings" }
    const r = await configureDeploymentPayer()
    expect(r.ok).toBe(false)
    expect(deploymentPayerActive()).toBe(false)
  })
})

describe("D15.3 / B5 — payerWebFreeConflict", () => {
  it("a payer on a paid grade is fine even with the flag on", () => {
    __setDeploymentPayerForTests(PAYER_UUID, { tierForGates: "basic" })
    expect(payerWebFreeConflict(true)).toBeNull()
  })

  it("a free payer with the flag OFF is fine (the flag is what makes it fatal)", () => {
    __setDeploymentPayerForTests(PAYER_UUID, { tierForGates: "free" })
    expect(payerWebFreeConflict(false)).toBeNull()
  })

  it("free + flag on ⇒ a refusal that names PAYG_WEB_BLOCK_ENABLED", () => {
    __setDeploymentPayerForTests(PAYER_UUID, { tierForGates: "free" })
    const reason = payerWebFreeConflict(true)
    expect(reason).toBeTruthy()
    expect(reason).toContain("PAYG_WEB_BLOCK_ENABLED")
  })

  it("payg + flag on ⇒ a refusal (the state a card top-up creates)", () => {
    __setDeploymentPayerForTests(PAYER_UUID, { tierForGates: "payg" })
    expect(payerWebFreeConflict(true)).toBeTruthy()
  })
})

describe("deploymentDefaultAllowanceCredits — the PROFILE SEED, in raw credits", () => {
  it("units ÷ unitRate, the one conversion (R3)", () => {
    h.billing = { defaultAllowanceUnits: 800_000, unitRate: 2000 }
    expect(deploymentDefaultAllowanceCredits()).toBe(400)
  })

  it("absent units, absent rate or a zero rate ⇒ null, never 0", () => {
    h.billing = {}
    expect(deploymentDefaultAllowanceCredits()).toBeNull()
    h.billing = { defaultAllowanceUnits: 800_000 }
    expect(deploymentDefaultAllowanceCredits()).toBeNull()
    h.billing = { defaultAllowanceUnits: 800_000, unitRate: 0 }
    expect(deploymentDefaultAllowanceCredits()).toBeNull()
  })
})
