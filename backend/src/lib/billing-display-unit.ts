import type {
  AccountSummary,
  BillingProvider,
  Charge,
  DailyAllowanceDetail,
  Quote,
  UsageCategory,
} from "./billing-provider.js"
import { runtimeSurfaceProfile } from "./surface-profile.js"

/**
 * Display-unit layer (Phase B, design §3): a dedicated hosted instance meters
 * in Nodaro credits but SHOWS its customer's own unit — a label and a rate on
 * the surface profile (`billing.unitLabel` / `billing.unitRate` /
 * `billing.unitDecimals`, see surface-profile.ts). This wraps whatever provider
 * is registered so every figure that leaves the billing seam is already in the
 * display unit, and the unit string that rides with it is the label.
 *
 * Composed INSIDE the provider slot (billing-provider.ts) rather than
 * registered by an overlay, so it does not matter who writes the slot last —
 * the overlay loader runs long before registerNodaroCloudBillingProvider().
 *
 * Two identity rules, both tested with `toBe`, not `toEqual`:
 *   1. the `none` provider is returned as-is (workers never register a
 *      provider; wrapping `none` would flip billingSurface().mountCostTab to
 *      true against a provider that answers nothing);
 *   2. with no unit configured the inner provider is returned as-is —
 *      mainline byte-identical, by identity.
 *
 * Rate semantics: `unitRate` = display units per 1 Nodaro credit.
 */

/**
 * The ONE conversion. `null`/`undefined` mean "the authority could not say"
 * (§5.2 rule 1) and MUST stay unavailable: `null * rate === 0` would turn
 * "unavailable" into "this generation was free", and `undefined * rate` is
 * NaN, which JSON serializes as null — masking a wrong number as an em dash.
 * Forbidden forms, all of which bake the bug in: `(x ?? 0) * rate`,
 * `Number(x) * rate`, `Math.round(null * rate)`.
 */
export function toUnits(v: number | null | undefined, rate: number, decimals: number): number | null {
  if (v == null) return null
  if (!Number.isFinite(v)) return null // an upstream NaN/Infinity never becomes a number
  const out = v * rate
  if (!Number.isFinite(out)) return null // overflow / rate poisoning
  const f = 10 ** decimals
  return Math.round(out * f) / f // half-up, symmetric with the credit integers
}

/**
 * For the fields the contract types as NON-nullable (DailyAllowanceDetail's
 * three counters). They can still arrive non-finite from a broken provider;
 * the caller nulls the whole `daily` object in that case (never a partial
 * conversion), so this returns null rather than inventing a 0 — `limit: 0` is
 * a real value meaning "blocked" and must never be manufactured.
 */
function toUnitsStrict(v: number, rate: number, decimals: number): number | null {
  return toUnits(v, rate, decimals)
}

interface UnitConfig {
  readonly label: string
  readonly rate: number
  readonly decimals: number
}

/** The configured unit, or null when the profile carries none (or a block
 *  the schema dropped — half-configured never reaches here). */
function configuredUnit(): UnitConfig | null {
  const b = runtimeSurfaceProfile().billing
  if (b.unitLabel === undefined || b.unitRate === undefined) return null
  return { label: b.unitLabel, rate: b.unitRate, decimals: b.unitDecimals ?? 0 }
}

function convertQuote(q: Quote, u: UnitConfig): Quote {
  return { amount: toUnits(q.amount, u.rate, u.decimals), unit: u.label }
}

/** `secondaryAmount`/`secondaryUnit` are DELETED, not nulled: the secondary is
 *  the provider USD view (nodaro-cloud puts `display_cost ?? provider_cost`
 *  there — raw provider cost on rows the markup pass never stamped). On a
 *  unit-configured instance the field does not exist, for anyone. */
function convertCharge(c: Charge, u: UnitConfig): Charge {
  return { amount: toUnits(c.amount, u.rate, u.decimals), unit: u.label }
}

function convertDaily(d: DailyAllowanceDetail, u: UnitConfig): DailyAllowanceDetail | null {
  const limit = toUnitsStrict(d.limit, u.rate, u.decimals)
  const used = toUnitsStrict(d.used, u.rate, u.decimals)
  if (limit === null || used === null) return null
  // Recomputed after conversion rather than converted: rounding each side
  // independently could leave `remaining` a unit off from `limit - used`.
  return { limit, used, remaining: Math.max(0, limit - used), resetsAt: d.resetsAt }
}

function convertCategory(c: UsageCategory, u: UnitConfig): UsageCategory {
  return { category: c.category, count: c.count, amount: toUnits(c.amount, u.rate, u.decimals), spent: null }
}

/**
 * Rebuilds EVERY nested object explicitly. A shallow spread
 * (`{...summary, balance: …}`) would leave `payg` / `daily` / `byCategory` at
 * their original identity, entirely unconverted — the silent-miss vector.
 *
 * Money in the customer's currency (`spent`, `reserveValue`, `byCategory[].spent`)
 * and the whole PAYG block are NULLED: they are priced in the metering
 * authority's terms (and `payg.rate.creditsPerUnit` is a credit⇄currency
 * rate), which has no meaning once the figures are relabeled. Optional keys
 * keep their presence (present → null, absent → absent) so the wire shape a
 * client already handles does not change.
 */
function convertAccount(a: AccountSummary, u: UnitConfig): AccountSummary {
  const out: AccountSummary = {
    plan: a.plan,
    balance: toUnits(a.balance, u.rate, u.decimals),
    dailyAllowance: toUnits(a.dailyAllowance, u.rate, u.decimals),
    unit: u.label,
  }
  if ("periodStart" in a) out.periodStart = a.periodStart
  if ("generations" in a) out.generations = a.generations
  if ("spent" in a) out.spent = null
  if ("payg" in a) out.payg = null
  if ("daily" in a) out.daily = a.daily ? convertDaily(a.daily, u) : a.daily
  if ("reserveValue" in a) out.reserveValue = null
  if ("byCategory" in a) out.byCategory = a.byCategory ? a.byCategory.map((c) => convertCategory(c, u)) : a.byCategory
  return out
}

/** Wrap a provider in the configured display unit — or return it BY IDENTITY
 *  when there is nothing to do (see the header). */
export function applyDisplayUnit(inner: BillingProvider): BillingProvider {
  if (inner.id === "none") return inner
  const u = configuredUnit()
  if (u === null) return inner

  const wrapped: BillingProvider = {
    id: inner.id,
    displayUnit: u.label,
    async report(jobIds) {
      const charges = await inner.report(jobIds)
      if (charges === null) return null // the whole batch unavailable — NOT "all free"
      const out = new Map<string, Charge>()
      for (const [id, c] of charges) out.set(id, convertCharge(c, u))
      return out
    },
    async account(userId) {
      const a = await inner.account(userId)
      return a === null ? null : convertAccount(a, u)
    },
  }
  if (typeof inner.quote === "function") {
    const quote = inner.quote.bind(inner)
    wrapped.quote = async (job) => {
      const q = await quote(job)
      return q === null ? null : convertQuote(q, u)
    }
  }
  return wrapped
}
