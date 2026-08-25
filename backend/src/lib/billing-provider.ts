import { hasCredits } from "./config.js"

/**
 * Billing adapter seam (B2). An external system meters and charges; Nodaro
 * only DISPLAYS. The interface + the inert `none` provider live in CORE
 * (root SUL). The credit-bearing `nodaro-cloud` provider lives in ee/ and is
 * registered via `registerNodaroCloudBillingProvider()` below — a dynamic
 * import so the ee module never loads in community/business and
 * tools/check-ee-imports.mjs stays green (it scans statement `import … from`,
 * never `import(…)` calls; mirror of middleware/credit-guard.ts).
 *
 * Typed + versioned (spec d1, product line): BILLING_CONTRACT_VERSION lets an
 * overlay-registered provider assert it was built against this contract. v2 adds
 * the optional rich account fields (PAYG, structured daily cap, per-category,
 * currency money); all are nullable so the `none` and `nodaro-cloud` providers
 * stay valid unchanged.
 *
 * The three rules (§5.2), enforced by TYPES here: money is `number | null`
 * (null = the authority could not say — NEVER 0); `plan` is a plain string
 * ("unknown" is a real answer, never re-derived); the unit rides on the
 * provider (`displayUnit`) so the display default follows the metering
 * authority, not isCloud().
 */

export const BILLING_CONTRACT_VERSION = 2

export interface JobSpec {
  jobId?: string
  nodeType: string
  /** OUR Nodaro key (MODEL_CATALOG / KIE_MODELS), not the provider's id. */
  modelKey: string | null
  dimensions?: Record<string, string | number | undefined>
}

export interface Quote {
  amount: number | null
  unit: string
}

/** What one job cost, per the metering authority. `amount: null` = unavailable
 *  (the authority could not price this job), NEVER 0. `secondaryAmount` is an
 *  optional alternate view (e.g. nodaro-cloud reports credits as `amount` and
 *  the provider USD as `secondaryAmount` for the admin toggle). */
export interface Charge {
  amount: number | null
  unit: string
  secondaryAmount?: number | null
  secondaryUnit?: string
}

/** A figure priced in a customer's own currency. `currency` is an ISO-4217
 *  code (e.g. "USD", "ILS"); the display formats it via Intl. */
export interface MoneyAmount {
  amount: number
  currency: string
}

/** Pay-as-you-go state. Omitted/null when the provider has no PAYG concept. */
export interface PaygState {
  enabled: boolean
  /** Reserve credits spent after the pool empties; null = unknown. */
  reserve: number | null
  /** The customer's own credits-per-currency-unit rate; null = no rate. */
  rate: { creditsPerUnit: number; currency: string } | null
  /** The customer's own recurring auto-charge ceiling; null = none. */
  monthlyCap: MoneyAmount | null
}

/** A structured allowance that resets on a cadence the provider owns.
 *  `limit: 0` is a real value meaning "blocked" (never treat as absent). */
export interface DailyAllowanceDetail {
  limit: number
  used: number
  remaining: number
  /** ISO-8601 instant when the counter next resets (provider owns the tz). */
  resetsAt: string
}

/** One row of the usage breakdown. `category` is a provider key the view
 *  maps to a label (unknown keys fall back to a generic label). */
export interface UsageCategory {
  category: string
  count: number
  /** Spend in the display unit; null = unavailable (rule 1), never 0. */
  amount: number | null
  /** Optional money view of this category's spend; null when not priced. */
  spent: MoneyAmount | null
}

export interface AccountSummary {
  /** "unknown" is a real answer and survives to the screen — never re-derived. */
  plan: string
  balance: number | null
  dailyAllowance: number | null
  unit: string
  // --- contract v2 rich fields; all optional, all nullable ---
  /** ISO start of the current billing/usage period. */
  periodStart?: string | null
  /** Count of generations this period. */
  generations?: number | null
  /** Money spent this period (provider currency); null = unavailable. */
  spent?: MoneyAmount | null
  /** Pay-as-you-go state; omitted/null = provider has no PAYG concept. */
  payg?: PaygState | null
  /** Structured daily cap w/ reset instant. When present the view prefers it
   *  over the scalar `dailyAllowance`. */
  daily?: DailyAllowanceDetail | null
  /** Money value of the PAYG reserve; null = not priced. */
  reserveValue?: MoneyAmount | null
  /** Per-category usage breakdown; omitted/null = no breakdown. */
  byCategory?: readonly UsageCategory[] | null
}

export interface BillingProvider {
  readonly id: string
  /** The unit the display defaults to (rule 3). none → "usd"; nodaro-cloud → "credits". */
  readonly displayUnit: string
  quote?(job: JobSpec): Promise<Quote | null>
  /** null = the authority is unavailable for the whole batch (not "all free"). */
  report(jobIds: string[]): Promise<Map<string, Charge> | null>
  account(userId: string): Promise<AccountSummary | null>
}

/** Inert default: every lookup returns null; no cost tab. Byte-identical to
 *  mainline's community/business behavior (no tab, provider-priced editions). */
export const noneBillingProvider: BillingProvider = {
  id: "none",
  displayUnit: "usd",
  async report() {
    return null
  },
  async account() {
    return null
  },
}

// One replaceable slot (mirror providers/egress.ts's decorator slot).
let current: BillingProvider = noneBillingProvider
export function setBillingProvider(p: BillingProvider): void {
  current = p
}
export function getBillingProvider(): BillingProvider {
  return current
}
export function clearBillingProvider(): void {
  current = noneBillingProvider
}

/** Deployment-level projection served by GET /v1/billing/surface and mirrored
 *  by the frontend. Contains NO per-user data — cacheable, public. */
export interface BillingSurface {
  contract: number
  providerId: string
  displayUnit: string
  canReport: boolean
  canQuote: boolean
  canAccount: boolean
  /** The Cost tab mounts iff a provider other than `none` is registered. */
  mountCostTab: boolean
}

export function billingSurface(): BillingSurface {
  const p = current
  return {
    contract: BILLING_CONTRACT_VERSION,
    providerId: p.id,
    displayUnit: p.displayUnit,
    canReport: p.id !== "none",
    canQuote: typeof p.quote === "function" && p.id !== "none",
    canAccount: p.id !== "none",
    mountCostTab: p.id !== "none",
  }
}

/**
 * Boot registration for the credit-bearing provider. Dynamic import keeps the
 * ee module out of community/business bundles AND passes check-ee-imports.mjs.
 * No-op unless the edition has credits — same shim contract as creditGuard.
 * External providers (SAI WBF) register through the overlay loader (§7.2),
 * NOT here.
 */
export async function registerNodaroCloudBillingProvider(): Promise<void> {
  if (!hasCredits()) return
  const impl = await import("../ee/billing/nodaro-cloud-provider.js")
  setBillingProvider(impl.nodaroCloudBillingProvider)
}
