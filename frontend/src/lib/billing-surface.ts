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
}

export const BILLING_SURFACE_DEFAULT: BillingSurface = {
  contract: 2,
  providerId: "none",
  displayUnit: "usd",
  canReport: false,
  canQuote: false,
  canAccount: false,
  mountCostTab: false,
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
}
