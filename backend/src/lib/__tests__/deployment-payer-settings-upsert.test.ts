/**
 * Track A step 1 — the boot upsert that writes `deployment_payer_settings`,
 * and the enforcement predicate that reads the surface profile beside it.
 *
 * WHY THIS FILE IS SEPARATE from `deployment-payer.test.ts`: migration 381's
 * narrowed `profiles` policy is INERT until `payer_user_id` is non-NULL, and
 * this upsert is its only writer. The migration and these ~15 lines ship in one
 * PR on purpose (spec §6.1), so the upsert gets its own proof rather than a few
 * extra assertions bolted onto the resolution suite.
 *
 * The two properties that are easy to get wrong and expensive to get wrong:
 *   1. `default_allowance_credits` is written ONLY on first insert. An upsert
 *      that also updated that column would silently revert the customer's
 *      chosen default on every deploy — so the refresh statement must not
 *      carry the key at all.
 *   2. A failed write REFUSES BOOT. A silent miss leaves `payer_user_id` NULL,
 *      and migration 381's RLS helper then re-opens the exact leak it closes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Billing = {
  payerAccount?: string
  defaultAllowanceUnits?: number
  unitRate?: number
  allowances?: "off" | "enforce"
}

const h = vi.hoisted(() => ({
  billing: {} as Billing,
  hasCredits: vi.fn(() => true),
  upsertCalls: [] as Array<{ values: Record<string, unknown>; options: unknown }>,
  updateCalls: [] as Array<Record<string, unknown>>,
  upsertError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  settingsTableTouched: 0,
}))

vi.mock("../surface-profile.js", () => ({
  runtimeSurfaceProfile: () => ({ billing: h.billing }),
}))
vi.mock("../config.js", () => ({ hasCredits: h.hasCredits }))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "deployment_payer_settings") {
        h.settingsTableTouched++
        return {
          upsert: async (values: Record<string, unknown>, options: unknown) => {
            h.upsertCalls.push({ values, options })
            return { error: h.upsertError }
          },
          update: (values: Record<string, unknown>) => {
            h.updateCalls.push(values)
            return { eq: async () => ({ error: h.updateError }) }
          },
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
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
  },
}))

const PAYER_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

const {
  configureDeploymentPayer,
  deploymentPayerActive,
  deploymentPayerId,
  allowanceEnforcementActive,
  __resetDeploymentPayerForTests,
  __setDeploymentPayerForTests,
} = await import("../deployment-payer.js")

beforeEach(() => {
  h.billing = {}
  h.hasCredits.mockReturnValue(true)
  h.upsertCalls = []
  h.updateCalls = []
  h.upsertError = null
  h.updateError = null
  h.settingsTableTouched = 0
})
afterEach(() => __resetDeploymentPayerForTests())

describe("the settings upsert — mainline is untouched", () => {
  it("no payerAccount ⇒ the settings table is never named (R2)", async () => {
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(h.settingsTableTouched).toBe(0)
    expect(deploymentPayerActive()).toBe(false)
  })
})

describe("the settings upsert — what each statement carries", () => {
  it("seeds default_allowance_credits from units ÷ unitRate, DO NOTHING on conflict", async () => {
    h.billing = { payerAccount: PAYER_UUID, defaultAllowanceUnits: 800_000, unitRate: 2000 }
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(h.upsertCalls).toHaveLength(1)
    expect(h.upsertCalls[0].values).toEqual({
      id: true,
      payer_user_id: PAYER_UUID,
      default_allowance_credits: 400, // 800000 SAI units at 2000 units/credit
    })
    // ignoreDuplicates is `ON CONFLICT DO NOTHING`: a re-boot must not rewrite
    // the seed. Without it, supabase-js sends DO UPDATE on every column passed.
    expect(h.upsertCalls[0].options).toMatchObject({ onConflict: "id", ignoreDuplicates: true })
  })

  it("the refresh statement NEVER carries default_allowance_credits", async () => {
    h.billing = { payerAccount: PAYER_UUID, defaultAllowanceUnits: 800_000, unitRate: 2000 }
    await configureDeploymentPayer()
    expect(h.updateCalls).toHaveLength(1)
    expect(h.updateCalls[0]).not.toHaveProperty("default_allowance_credits")
    expect(h.updateCalls[0].payer_user_id).toBe(PAYER_UUID)
    expect(typeof h.updateCalls[0].updated_at).toBe("string")
  })

  it("no defaultAllowanceUnits (or no unitRate) ⇒ the column is omitted, not zeroed", async () => {
    h.billing = { payerAccount: PAYER_UUID }
    await configureDeploymentPayer()
    expect(h.upsertCalls[0].values).toEqual({ id: true, payer_user_id: PAYER_UUID })

    h.upsertCalls = []
    __resetDeploymentPayerForTests()
    h.billing = { payerAccount: PAYER_UUID, defaultAllowanceUnits: 800_000 } // rate missing
    await configureDeploymentPayer()
    expect(h.upsertCalls[0].values).not.toHaveProperty("default_allowance_credits")
  })
})

describe("the settings upsert — a failed write refuses boot", () => {
  it("a failed insert ⇒ ok:false and the payer stays INACTIVE", async () => {
    h.billing = { payerAccount: PAYER_UUID }
    h.upsertError = { message: "permission denied for table deployment_payer_settings" }
    const r = await configureDeploymentPayer()
    expect(r.ok).toBe(false)
    expect(deploymentPayerActive()).toBe(false)
    expect(deploymentPayerId()).toBeNull()
  })

  it("a failed refresh ⇒ ok:false and the payer stays INACTIVE", async () => {
    h.billing = { payerAccount: PAYER_UUID }
    h.updateError = { message: "could not serialize access" }
    const r = await configureDeploymentPayer()
    expect(r.ok).toBe(false)
    expect(deploymentPayerActive()).toBe(false)
  })
})

describe("allowanceEnforcementActive — two switches, not one (D3)", () => {
  it("no payer ⇒ false whatever the profile says", () => {
    h.billing = { allowances: "enforce" }
    expect(allowanceEnforcementActive()).toBe(false)
  })

  it("a payer with allowances absent or \"off\" ⇒ false (the step-3 window)", () => {
    __setDeploymentPayerForTests(PAYER_UUID)
    h.billing = {}
    expect(allowanceEnforcementActive()).toBe(false)
    h.billing = { allowances: "off" }
    expect(allowanceEnforcementActive()).toBe(false)
  })

  it("a payer with allowances \"enforce\" ⇒ true (the flip, rollout step 8)", () => {
    __setDeploymentPayerForTests(PAYER_UUID)
    h.billing = { allowances: "enforce" }
    expect(allowanceEnforcementActive()).toBe(true)
  })
})
