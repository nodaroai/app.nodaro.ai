import { configuredDisplayUnit, toUnits, type DisplayUnit } from "../../lib/billing-display-unit.js"
import { deploymentPayerActive, deploymentPayerId } from "../../lib/deployment-payer.js"

/**
 * The credit reads a thin client renders, IN THE DEPLOYMENT'S DISPLAY UNIT —
 * server-converted, so no client multiplies by a rate.
 *
 * A deployment can show its own unit instead of credits (`billing.unitLabel` /
 * `unitRate` / `unitDecimals` on the surface profile). The billing seam already
 * answers in it (`GET /v1/billing/account`, `lib/billing-display-unit.ts`); the
 * balance read and the price lookups answered raw credits only, so a client
 * that showed the unit had to do the arithmetic itself — and a screen that
 * converts some figures and not others shows two currencies at once.
 *
 * ADDITIVE ONLY. Every raw field stays exactly as it was; the converted
 * figures ride in ONE extra `display` object beside them, and with no unit
 * configured that key is ABSENT — the response is byte-identical to before.
 *
 * Every figure goes through `toUnits`, the one conversion: `null` stays null
 * (unavailable, never 0), and so does a figure that cannot be converted. The
 * rate itself is never sent — a client renders `display`, it does not
 * re-derive it.
 */

/** The unit a `display` object is in: its label, and the decimals its figures carry. */
export interface DisplayUnitFields {
  /** The unit's label, e.g. what the deployment calls its credits. */
  unit: string
  /** Decimal places the converted figures carry (0–4). */
  decimals: number
  /**
   * The unit's word per interface language, when the deployment gives one per
   * language: locale id → word, beside `unit` (the fallback). The request does
   * not say which language the viewer's interface is in (the browser's
   * `Accept-Language` is not it, and `GET /v1/credits/model-cost` answers from
   * a public cache), so the server sends the words and the client picks.
   */
  unitLabels?: Readonly<Record<string, string>>
}

/** `GET /v1/user/credits` → `data.display`: the balance's credit figures, converted. */
export interface BalanceDisplay extends DisplayUnitFields {
  total: number | null
  subscription: number | null
  topup: number | null
  dailySpent: number | null
  dailyLimit: number | null
  monthlyAllocation: number | null
  appCreditsAllowance: number | null
  /** Present exactly when the raw `allowance` is (a deployment with a single payer). */
  allowance?: { granted: number | null; remaining: number | null } | null
  /** Present exactly when the raw `externalWallet` is. */
  externalWallet?: { available: number | null }
  /** Present exactly when the raw `welcomeOffer` is. */
  welcomeOffer?: { credits: number | null }
}

/** The credit figures of the balance payload that `display` mirrors. */
interface BalanceFigures {
  total: number
  subscription: number
  topup: number
  dailySpent: number
  dailyLimit: number | null
  monthlyAllocation: number
  appCreditsAllowance: number
  allowance?: { granted: number; remaining: number } | null
  externalWallet?: { available: number | null }
  welcomeOffer?: { credits: number }
}

function convert(v: number | null | undefined, u: DisplayUnit): number | null {
  return toUnits(v, u.rate, u.decimals)
}

function unitFields(u: DisplayUnit): DisplayUnitFields {
  return { unit: u.label, decimals: u.decimals, ...(u.labels ? { unitLabels: u.labels } : {}) }
}

/**
 * The balance's `display`, rebuilt field by field (a spread would carry an
 * unconverted nested object through). Optional keys keep their presence:
 * present → converted, absent → absent, null → null.
 */
function balanceDisplay(b: BalanceFigures, u: DisplayUnit): BalanceDisplay {
  const out: BalanceDisplay = {
    ...unitFields(u),
    total: convert(b.total, u),
    subscription: convert(b.subscription, u),
    topup: convert(b.topup, u),
    dailySpent: convert(b.dailySpent, u),
    dailyLimit: convert(b.dailyLimit, u),
    monthlyAllocation: convert(b.monthlyAllocation, u),
    appCreditsAllowance: convert(b.appCreditsAllowance, u),
  }
  if ("allowance" in b) {
    out.allowance = b.allowance ? { granted: convert(b.allowance.granted, u), remaining: convert(b.allowance.remaining, u) } : null
  }
  if ("externalWallet" in b && b.externalWallet) out.externalWallet = { available: convert(b.externalWallet.available, u) }
  if ("welcomeOffer" in b && b.welcomeOffer) out.welcomeOffer = { credits: convert(b.welcomeOffer.credits, u) }
  return out
}

/**
 * The balance payload as sent: unchanged, plus `display` when a unit is
 * configured. Applied on the way OUT, after the cache, so a cached and a fresh
 * read cannot differ, and a unit change reaches the next read.
 *
 * THE BILLING ACCOUNT'S OWN READ, on a deployment with a single payer, gets no
 * `display`: its balance is the deployment's pool, which every surface keeps
 * in raw credits (the overview in `deployment-billing.ts` says why — converting
 * it would invent an exchange rate for something that is not being exchanged).
 */
export function withBalanceDisplay<T extends BalanceFigures>(data: T, requesterId: string): T | (T & { display: BalanceDisplay }) {
  const u = configuredDisplayUnit()
  if (u === null) return data
  if (deploymentPayerActive() && requesterId === deploymentPayerId()) return data
  return { ...data, display: balanceDisplay(data, u) }
}

/** `POST /v1/credits/model-costs` → `display`: each priced id's credits, converted. */
export interface ModelCostsDisplay extends DisplayUnitFields {
  data: Record<string, number | null>
}

/** The batch's `display`, or null when no unit is configured (the key is then left out). */
export function modelCostsDisplay(costs: Record<string, number>): ModelCostsDisplay | null {
  const u = configuredDisplayUnit()
  if (u === null) return null
  const data: Record<string, number | null> = {}
  for (const [id, credits] of Object.entries(costs)) data[id] = convert(credits, u)
  return { ...unitFields(u), data }
}

/** `GET /v1/credits/model-cost` → `data.display`: the one id's credits, converted. */
export interface ModelCostDisplay extends DisplayUnitFields {
  creditCost: number | null
}

/** The single lookup's `display`, or null when no unit is configured (the key is then left out). */
export function modelCostDisplay(creditCost: number): ModelCostDisplay | null {
  const u = configuredDisplayUnit()
  if (u === null) return null
  return { ...unitFields(u), creditCost: convert(creditCost, u) }
}
