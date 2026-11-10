/**
 * The Stripe prices a deployment sells. Price ids belong to one Stripe mode:
 * the live catalogue below is what a live key sells, id for id, and a test-mode
 * key (sk_test_ or rk_test_: a staging deployment on Stripe's test mode) sells the test catalogue the
 * deployment names in STRIPE_TEST_CATALOG instead.
 *
 * Pure: the key and the setting come in as arguments, so stripe-config.ts
 * resolves it once at load and tests can ask it directly.
 *
 * A test catalogue is used only when it is whole: the four plans with both
 * intervals, distinct price ids, and the packs on the live ladder credit for
 * credit (each pack grants what its live twin grants, so a pack bought in test
 * mode tests the real grant). Anything else keeps the live ids with one
 * warning: test mode cannot sell a live id, so a mistake shows as an
 * unavailable price, never as a wrong charge or a wrong grant.
 */
import { z } from "zod"

export const PLAN_KEYS = ["basic", "standard", "pro", "business"] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

export interface StripeProduct {
  readonly productId: string
  readonly monthly: string
  readonly yearly: string
}

export interface PlanPrice {
  plan: string
  interval: "monthly" | "yearly"
}

export interface StripeCatalog {
  readonly products: Readonly<Record<PlanKey, StripeProduct>>
  /** Prices no longer sold that existing subscriptions still renew on. */
  readonly retired: Readonly<Record<string, PlanPrice>>
  /** A fixed credit pack's price id → the credits it grants. */
  readonly topUps: Readonly<Record<string, number>>
}

/** Prices no longer sold that existing live subscriptions still renew on. */
const LIVE_RETIRED: Readonly<Record<string, PlanPrice>> = Object.freeze({
  // Basic yearly at $108/year, replaced by $120/year on 2026-10-30.
  price_1T92PK6EOX16l3P8f7VcNi21: { plan: "basic", interval: "yearly" },
})

export const LIVE_STRIPE_CATALOG: StripeCatalog = Object.freeze({
  products: Object.freeze({
    basic: {
      productId: "prod_U6gPUNpvVGjE2f",
      monthly: "price_1T8T2r6EOX16l3P8KLqPT0Gp",
      yearly: "price_1UW3116EOX16l3P8cfayw1lX",
    },
    standard: {
      productId: "prod_U6gOhMrAS056Lg",
      monthly: "price_1T8T1m6EOX16l3P8TuFGxcZr",
      yearly: "price_1T8T266EOX16l3P8g39cb6jm",
    },
    pro: {
      productId: "prod_U6gJ8iy2b9NP70",
      monthly: "price_1T8Swg6EOX16l3P8NNctdzT3",
      yearly: "price_1T8Syr6EOX16l3P8z92jaRh6",
    },
    business: {
      productId: "prod_U6gM9ZW1j1wcGN",
      monthly: "price_1T92U26EOX16l3P8fDbjHHi7",
      yearly: "price_1T8T0s6EOX16l3P8VRjmbJhr",
    },
  }),
  retired: LIVE_RETIRED,
  topUps: Object.freeze({
    // Re-rated onto the flattened curve (design §4.3, signed off 2026-07-30).
    // Dollar amounts and Stripe price IDs are unchanged — only the grants move.
    price_1T8T5M6EOX16l3P85i5sCtUs: 3300, // $10
    price_1T8T5k6EOX16l3P8a1goDXGm: 8500, // $25
    price_1T8T5w6EOX16l3P8mNU7sLkU: 17500, // $50
    price_1T8T6B6EOX16l3P8CmcSaJyR: 36000, // $100
  }),
})

const priceId = z.string().regex(/^price_[A-Za-z0-9]+$/)
const product = z.object({ productId: z.string().regex(/^prod_[A-Za-z0-9]+$/), monthly: priceId, yearly: priceId }).strict()
const testCatalogSchema = z
  .object({
    products: z.object({ basic: product, standard: product, pro: product, business: product }).strict(),
    retired: z.record(priceId, z.object({ plan: z.enum(PLAN_KEYS), interval: z.enum(["monthly", "yearly"]) }).strict()).default({}),
    topUps: z.record(priceId, z.number().int().positive()),
  })
  .strict()

/** Why a test catalogue cannot be used, or null when it is whole. */
function catalogProblem(catalog: StripeCatalog): string | null {
  const ids = [
    ...PLAN_KEYS.flatMap((plan) => [catalog.products[plan].monthly, catalog.products[plan].yearly]),
    ...Object.keys(catalog.retired),
    ...Object.keys(catalog.topUps),
  ]
  if (new Set(ids).size !== ids.length) return "a price id is used twice"
  const ladder = (c: StripeCatalog) => Object.values(c.topUps).sort((a, b) => a - b).join(",")
  if (ladder(catalog) !== ladder(LIVE_STRIPE_CATALOG)) return `its packs grant ${ladder(catalog)}, not the live ladder ${ladder(LIVE_STRIPE_CATALOG)}`
  return null
}

export function resolveStripeCatalog(
  input: { readonly secretKey: string | undefined; readonly testCatalog: string | undefined },
  warn: (message: string) => void = (message) => console.warn(message),
): StripeCatalog {
  // A test-mode key: a secret one (sk_test_) or a restricted one (rk_test_).
  if (!/^(?:sk|rk)_test_/.test((input.secretKey ?? "").trim())) return LIVE_STRIPE_CATALOG
  const raw = (input.testCatalog ?? "").trim()
  const fallBack = (why: string) => {
    warn(`[stripe] a test-mode key, and ${why}: the live price ids stay, which test mode cannot sell (STRIPE_TEST_CATALOG, docs/deployment.md)`)
    return LIVE_STRIPE_CATALOG
  }
  if (!raw) return fallBack("no STRIPE_TEST_CATALOG")
  let catalog: StripeCatalog
  try {
    catalog = testCatalogSchema.parse(JSON.parse(raw)) as StripeCatalog
  } catch {
    return fallBack("STRIPE_TEST_CATALOG is not a whole catalogue")
  }
  const problem = catalogProblem(catalog)
  return problem ? fallBack(`STRIPE_TEST_CATALOG cannot be used: ${problem}`) : catalog
}
