/**
 * Track A — what does and does not stop a payer instance from booting (D15).
 *
 * TWO things must stop it, and each is a state where continuing costs real
 * money or re-opens a leak:
 *
 *   1. THE SETTINGS WRITE FAILED. Migration 381's narrowed `profiles` policy
 *      is a no-op while `payer_user_id` is NULL, so a silent miss boots an
 *      instance where every customer-minted admin can read the payer's real
 *      balance. (The payload's own properties are proved in
 *      `deployment-payer-settings-upsert.test.ts`.)
 *   2. B5 — A FREE/PAYG PAYER UNDER `PAYG_WEB_BLOCK_ENABLED`. The payg web
 *      block resolves the pool at the PAYER's tier, and a card top-up turns a
 *      free payer into `payg`. With the flag on, every browser run would then
 *      raise SUBSCRIPTION_REQUIRED against a free pool of 0: money paid,
 *      nothing runs. Latent today (the flag defaults off) — which is exactly
 *      why it needs a boot refusal rather than a runbook line.
 *
 * AND ONE THAT NO LONGER DOES — D15.2, the case this file now pins from the
 * other side. A payer FEDERATED to the customer's own provider boots: the pool
 * holds credits the deployment paid for, and which identity signs into it is
 * the deployment's business. Boot does not read the payer's identity provider
 * at all any more. The platform's money keeps its own guard, untouched by this
 * file — `requirePlatformOperator` still refuses a federated account on every
 * credit-GRANT route.
 *
 * MAINLINE (R2): with no `billing.payerAccount` the module answers "not
 * active" to every predicate and issues zero queries — asserted below.
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
  /** `app_metadata` the admin API would answer for the resolved payer. Boot
   *  must never ask (D15.2) — `getUserByIdCalls` is what proves it. */
  payerAppMetadata: {} as Record<string, unknown>,
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
          return { data: { users: [{ id: PAYER_UUID, email: "support@acme.example" }] }, error: null }
        },
        getUserById: async (id: string) => {
          h.getUserByIdCalls.push(id)
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
  payerWebFreeConflict,
  __resetDeploymentPayerForTests,
  __setDeploymentPayerForTests,
} = await import("../deployment-payer.js")

beforeEach(() => {
  h.billing = {}
  h.hasCredits.mockReturnValue(true)
  h.payerAppMetadata = {}
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

  it("the conflict predicate answers null with no payer", () => {
    expect(payerWebFreeConflict(true)).toBeNull()
  })
})

describe("D15.2 — a FEDERATED payer boots (D15.1 superseded)", () => {
  it("app_metadata.sso on the payer ⇒ ok, ACTIVE, and the settings row written", async () => {
    h.billing = { payerAccount: PAYER_UUID }
    h.payerAppMetadata = { sso: "acme-idp", sso_subject: "idp-7" }

    expect(await configureDeploymentPayer()).toEqual({ ok: true })

    expect(deploymentPayerActive()).toBe(true)
    expect(deploymentPayerId()).toBe(PAYER_UUID)
    // The settings row still names the payer to migration 381's RLS helper —
    // the leak that write closes is unrelated to who signs into the account.
    expect(h.settingsWrites).toBeGreaterThan(0)
  })

  it("boot never asks WHO owns the payer identity — zero admin reads on the payer path", async () => {
    // The deleted guard read `auth.admin.getUserById` at boot and failed
    // CLOSED when it could not answer, so an unreadable directory took the
    // whole instance down. Nothing reads it now: this assertion is what stops
    // it being re-added by reflex.
    h.billing = { payerAccount: PAYER_UUID }
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(h.getUserByIdCalls).toEqual([])
    expect(deploymentPayerId()).toBe(PAYER_UUID)
    expect(h.settingsWrites).toBeGreaterThan(0)
  })
})

/**
 * The uuid a guard compares against must be COMPARABLE. `UUID_RE` is
 * case-insensitive and Postgres compares `uuid` case-insensitively, so an
 * upper-case `billing.payerAccount` resolves and boots — and then every
 * `=== deploymentPayerId()` guard in the codebase misses, because they all
 * compare against lower-case ids from PostgREST, GoTrue and the JWT: the H6
 * exemption, the `sso-linking.ts` payer branch, the admin-sso de-provision
 * refusal, `require-deployment-payer.ts` and `payer-balance-guard.ts`. One
 * capital in a profile would silently open all five.
 */
describe("the resolved payer id is case-normalised", () => {
  it("an UPPER-CASE billing.payerAccount uuid resolves to a lower-case id", async () => {
    h.billing = { payerAccount: PAYER_UUID.toUpperCase() }

    expect(await configureDeploymentPayer()).toEqual({ ok: true })

    expect(deploymentPayerId()).toBe(PAYER_UUID)
    expect(deploymentPayerId()).not.toBe(PAYER_UUID.toUpperCase())
  })
})

describe("a failed settings write refuses boot", () => {
  it("upsert error ⇒ ok:false and the payer stays inactive", async () => {
    h.billing = { payerAccount: PAYER_UUID }
    h.upsertError = { message: "permission denied for table deployment_payer_settings" }
    const r = await configureDeploymentPayer()
    expect(r.ok).toBe(false)
    expect(deploymentPayerActive()).toBe(false)
  })
})

describe("D15 item 3 / B5 — payerWebFreeConflict", () => {
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
