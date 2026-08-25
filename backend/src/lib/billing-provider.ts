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
 * overlay-registered provider assert it was built against this contract.
 *
 * The three rules (§5.2), enforced by TYPES here: money is `number | null`
 * (null = the authority could not say — NEVER 0); `plan` is a plain string
 * ("unknown" is a real answer, never re-derived); the unit rides on the
 * provider (`displayUnit`) so the display default follows the metering
 * authority, not isCloud().
 */

export const BILLING_CONTRACT_VERSION = 1

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

export interface AccountSummary {
  /** "unknown" is a real answer and survives to the screen — never re-derived. */
  plan: string
  balance: number | null
  dailyAllowance: number | null
  unit: string
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
