/**
 * Frontend mirror of backend/src/lib/billing-provider.ts's BillingSurface —
 * duplicated (NOT in packages/shared, which is an irrevocable Apache grant),
 * same rationale as surface-profile.ts. Guarded by billing-surface-drift.test.ts.
 * v2 adds the optional rich account fields (PAYG, structured daily cap,
 * per-category, money).
 */
export interface BillingSurface {
  contract: number
  providerId: string
  displayUnit: string
  canReport: boolean
  canQuote: boolean
  canAccount: boolean
  mountCostTab: boolean
  /** One designated account pays for every action on this instance (SAI item
   *  9) — /usage renders consumption-only (no balance; the payer's identity
   *  never reaches the browser). Optional: an older backend omits it. */
  deploymentPayer?: boolean
}

/**
 * The react-query key the surface is cached under. It lives HERE, beside the
 * type and the default, because two readers need it and they cannot share the
 * hook: `useBillingSurface` (the React one) and the canvas run gate, which is
 * imperative code that reads the cache the hook filled. A second literal copy
 * of `["billing", "surface"]` would read an always-empty cache and silently
 * answer "no payer" — the exact answer that re-arms the refusal this key is
 * fetched to prevent.
 */
export const BILLING_SURFACE_QUERY_KEY = ["billing", "surface"] as const

export const BILLING_SURFACE_DEFAULT: BillingSurface = {
  contract: 2,
  providerId: "none",
  displayUnit: "usd",
  canReport: false,
  canQuote: false,
  canAccount: false,
  mountCostTab: false,
  deploymentPayer: false,
}

export interface MoneyAmount {
  amount: number
  currency: string
}

export interface PaygState {
  enabled: boolean
  reserve: number | null
  rate: { creditsPerUnit: number; currency: string } | null
  monthlyCap: MoneyAmount | null
}

export interface DailyAllowanceDetail {
  limit: number
  used: number
  remaining: number
  resetsAt: string
}

export interface UsageCategory {
  category: string
  count: number
  amount: number | null
  spent: MoneyAmount | null
}

export interface BillingAccount {
  plan: string
  balance: number | null
  dailyAllowance: number | null
  unit: string
  periodStart?: string | null
  generations?: number | null
  spent?: MoneyAmount | null
  payg?: PaygState | null
  daily?: DailyAllowanceDetail | null
  reserveValue?: MoneyAmount | null
  byCategory?: readonly UsageCategory[] | null
  /** Track A — the total `balance` was drawn from (a per-user allowance).
   *  Already in the display unit, like every other figure here. `null` =
   *  unavailable → em dash; absent = the provider has no such concept. */
  allocated?: number | null
}
