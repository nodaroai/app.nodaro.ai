/**
 * Frontend mirror of backend/src/lib/billing-provider.ts's BillingSurface —
 * duplicated (NOT in packages/shared, which is an irrevocable Apache grant),
 * same rationale as surface-profile.ts. Guarded by billing-surface-drift.test.ts.
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
  contract: 1,
  providerId: "none",
  displayUnit: "usd",
  canReport: false,
  canQuote: false,
  canAccount: false,
  mountCostTab: false,
}

export interface BillingAccount {
  plan: string
  balance: number | null
  dailyAllowance: number | null
  unit: string
}
