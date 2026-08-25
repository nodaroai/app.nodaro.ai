import type { MoneyAmount } from "./billing-surface"

/**
 * Money in the customer's own currency, via Intl so the symbol lands on the
 * correct side even in an RTL layout. An unknown currency code must not blank
 * the figure out — fall back to a plain "amount CODE" string.
 */
export function formatMoney(m: MoneyAmount, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: m.currency,
      maximumFractionDigits: 2,
    }).format(m.amount)
  } catch {
    return `${m.amount.toFixed(2)} ${m.currency}`
  }
}
