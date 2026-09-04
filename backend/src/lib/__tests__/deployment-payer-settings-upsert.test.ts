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
  backfillError: null as { message: string } | null,
  selectError: null as { message: string } | null,
  /** What `default_allowance_credits` holds when boot reads it back. */
  storedDefault: 400 as number | null,
  selectCalls: 0,
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
          // Boot reads the column back to decide whether the seed still has to
          // land — the write-once insert cannot, by construction, fix a row it
          // did not create.
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                h.selectCalls++
                return h.selectError
                  ? { data: null, error: h.selectError }
                  : { data: { default_allowance_credits: h.storedDefault }, error: null }
              },
            }),
          }),
          update: (values: Record<string, unknown>) => {
            h.updateCalls.push(values)
            const error = Object.hasOwn(values, "default_allowance_credits") ? h.backfillError : h.updateError
            return { eq: async () => ({ error }) }
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
        // Track A D15.1 — see the note in deployment-payer.test.ts. Without
        // this stub the federation read fails closed and every activation in
        // this file is refused before the upsert runs.
        getUserById: async (id: string) => ({ data: { user: { id, app_metadata: {} } }, error: null }),
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
  h.backfillError = null
  h.selectError = null
  h.storedDefault = 400
  h.selectCalls = 0
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

  it("the identity refresh NEVER carries default_allowance_credits", async () => {
    // The one statement that runs on EVERY boot with the profile's value in
    // hand. If it carried the column it would revert the billing account's
    // chosen default on every deploy (D6) — which is why the backfill below is
    // a SEPARATE statement, conditional on what the row actually holds.
    h.billing = { payerAccount: PAYER_UUID, defaultAllowanceUnits: 800_000, unitRate: 2000 }
    await configureDeploymentPayer()
    const identity = h.updateCalls.filter((v) => Object.hasOwn(v, "payer_user_id"))
    expect(identity).toHaveLength(1)
    expect(identity[0]).not.toHaveProperty("default_allowance_credits")
    expect(identity[0].payer_user_id).toBe(PAYER_UUID)
    expect(typeof identity[0].updated_at).toBe("string")
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

describe("the seed backfill — a write-once insert cannot bake a permanent zero", () => {
  /**
   * `default_allowance_credits` is `integer NOT NULL DEFAULT 0` (381), written
   * by the INSERT and by nothing else (D6, so a deploy never reverts the
   * billing account's value). That is correct for every boot AFTER the first —
   * and wrong for the first one on a profile that has no
   * `billing.defaultAllowanceUnits` yet: the row lands with 0, and adding the
   * key later moves NOTHING, because the insert never fires again.
   *
   * What a 0 costs is not visible until the flip, and then it is total. Before
   * it, `allowanceFor` answers `granted 0, remaining 0` (0 is a finite number,
   * so nothing reads it as "unavailable") and the sidebar shows an empty
   * allowance. After it, `reserve_credits` LAZILY PROVISIONS the user at
   * `granted_credits = 0`, writes a 0-credit 'default' grant row to match, and
   * raises `USER_ALLOWANCE_EXCEEDED` on the same transaction — a 402 for every
   * un-provisioned user on the instance. Not `ALLOWANCE_UNCONFIGURED`: that
   * fires only when `payer_user_id` is NULL, which it is not. And those rows
   * are BAKED: fixing the settings afterwards does not touch a user who has
   * already been provisioned at zero.
   *
   * So the seed is written whenever the stored value cannot be one the billing
   * account chose (NULL, or 0), and never when it can — a positive stored value
   * is the customer's and is left alone whatever the profile now says.
   */
  it("first boot with no defaultAllowanceUnits: nothing is seeded, and nothing is read back", async () => {
    // The gap this whole describe exists for. There is no seed to write, so
    // the column takes 381's `DEFAULT 0` — and boot does not spend a read
    // asking about a value it could not fix.
    h.billing = { payerAccount: PAYER_UUID }
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(h.upsertCalls[0].values).not.toHaveProperty("default_allowance_credits")
    expect(h.selectCalls).toBe(0)
    expect(h.updateCalls.filter((v) => Object.hasOwn(v, "default_allowance_credits"))).toHaveLength(0)
  })

  it("a later boot that adds the key seeds the ZERO row the first boot left", async () => {
    // The fix. Without it the key can be added, the instance redeployed, and
    // the column stays 0 for ever, because `ON CONFLICT DO NOTHING` never
    // fires again on a row that exists.
    h.storedDefault = 0
    h.billing = { payerAccount: PAYER_UUID, defaultAllowanceUnits: 800_000, unitRate: 2000 }
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    const backfill = h.updateCalls.filter((v) => Object.hasOwn(v, "default_allowance_credits"))
    expect(backfill).toHaveLength(1)
    expect(backfill[0].default_allowance_credits).toBe(400) // 800000 SAI units at 2000 units/credit
    // ...and it carries NOTHING else that is the operator's to set: the
    // identity travels in its own statement.
    expect(backfill[0]).not.toHaveProperty("payer_user_id")
  })

  it("a NULL stored value is seeded too", async () => {
    // 381 declares the column NOT NULL, so this is defence against a row that
    // predates the constraint or arrives from a hand-run migration — not a
    // state the current schema can produce.
    h.storedDefault = null
    h.billing = { payerAccount: PAYER_UUID, defaultAllowanceUnits: 800_000, unitRate: 2000 }
    await configureDeploymentPayer()
    const backfill = h.updateCalls.filter((v) => Object.hasOwn(v, "default_allowance_credits"))
    expect(backfill).toHaveLength(1)
    expect(backfill[0].default_allowance_credits).toBe(400)
  })

  it("a POSITIVE stored value is never overwritten, even by a different seed", async () => {
    // The D6 property, unchanged and load-bearing: a value > 0 is one the
    // billing account chose from its own page, and a deploy must not revert it.
    h.storedDefault = 12_345
    h.billing = { payerAccount: PAYER_UUID, defaultAllowanceUnits: 800_000, unitRate: 2000 }
    await configureDeploymentPayer()
    expect(h.updateCalls.filter((v) => Object.hasOwn(v, "default_allowance_credits"))).toHaveLength(0)
  })

  it("a seed of 0 is not a seed: it never writes and never reads", async () => {
    // `defaultAllowanceUnits: 0` asks for nothing, and writing it would be a
    // no-op that could only ever overwrite something better.
    h.billing = { payerAccount: PAYER_UUID, defaultAllowanceUnits: 0, unitRate: 2000 }
    h.storedDefault = 0
    await configureDeploymentPayer()
    expect(h.selectCalls).toBe(0)
    expect(h.updateCalls.filter((v) => Object.hasOwn(v, "default_allowance_credits"))).toHaveLength(0)
  })

  it("a failed backfill LOGS and boots — unlike a failed identity write", async () => {
    // The asymmetry is deliberate. A missing `payer_user_id` re-opens 381's
    // leak silently and must refuse boot; a seed that did not land is a number
    // the NEXT boot retries, and it only bites after a manual enforcement flip.
    // Refusing boot for it would take the API down over a value nothing is
    // reading yet.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    h.storedDefault = 0
    h.backfillError = { message: "could not serialize access" }
    h.billing = { payerAccount: PAYER_UUID, defaultAllowanceUnits: 800_000, unitRate: 2000 }
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(deploymentPayerActive()).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it("an unreadable stored value LOGS and boots, and writes nothing", async () => {
    // Not knowing what the row holds is not licence to overwrite it — that is
    // the one direction that could revert the customer's chosen default.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    h.selectError = { message: "permission denied" }
    h.billing = { payerAccount: PAYER_UUID, defaultAllowanceUnits: 800_000, unitRate: 2000 }
    expect(await configureDeploymentPayer()).toEqual({ ok: true })
    expect(h.updateCalls.filter((v) => Object.hasOwn(v, "default_allowance_credits"))).toHaveLength(0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it("mainline never reaches any of it", async () => {
    h.billing = {}
    await configureDeploymentPayer()
    expect(h.settingsTableTouched).toBe(0)
    expect(h.selectCalls).toBe(0)
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
