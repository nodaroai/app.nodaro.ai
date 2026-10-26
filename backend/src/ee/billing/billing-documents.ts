import type Stripe from "stripe"

/**
 * The shapes `GET /v1/billing/invoices` and `GET /v1/billing/payment-method`
 * answer with, built from what Stripe and the `transactions` table hold. Pure:
 * the routes read, these functions only shape. Mirrored by the SDK
 * (`packages/client/src/resources/billing.ts`: `BillingDocument`,
 * `BillingPaymentMethod`) — keep the two in step.
 */

/** A sum of money in its currency's major unit, with its ISO-4217 code. */
export interface MoneyView {
  readonly amount: number
  readonly currency: string
}

/**
 * One payment document: a Stripe invoice (a subscription payment, with its
 * PDF) or a receipt (a credit pack or a pay-as-you-go load, a hosted page).
 */
export interface BillingDocumentView {
  readonly id: string
  readonly kind: "invoice" | "receipt"
  /** The invoice number Stripe printed; receipts have none. */
  readonly number: string | null
  /** ISO-8601. */
  readonly at: string
  readonly amount: MoneyView
  /** The credits the payment granted; `null` on an invoice (the plan's credits come with the period). */
  readonly credits: number | null
  /** `"paid"`, `"open"`, `"void"`, `"uncollectible"` or `"refunded"`. */
  readonly status: string
  readonly description: string | null
  /** The PDF, on an invoice. */
  readonly pdfUrl: string | null
  /** The hosted page: Stripe's invoice page, or the receipt. */
  readonly url: string | null
}

export interface CardView {
  /** `"visa"`, `"mastercard"`, … as Stripe names it. */
  readonly brand: string
  readonly last4: string
  readonly expMonth: number
  readonly expYear: number
}

export interface BillingDetailsView {
  readonly name: string | null
  readonly email: string | null
  /** ISO-3166 alpha-2. */
  readonly country: string | null
}

export interface PaymentMethodView {
  /** The card on file; `null` when none is saved. */
  readonly card: CardView | null
  /** The name, email and country the card (else the customer) carries; `null` when nothing is on file. */
  readonly billingDetails: BillingDetailsView | null
}

/** A `transactions` row as the invoices route reads it: a credit purchase, or the refund of one. */
export interface PurchaseRow {
  readonly id: string
  /** `"topup"`, or `"refund"` (a clawback: `credits_granted` negative, `amount_usd` the sum given back). */
  readonly type: string | null
  readonly amount_usd: number | string | null
  readonly credits_granted: number | null
  readonly status: string | null
  readonly created_at: string
  readonly receipt_url: string | null
}

/** Currencies Stripe counts in whole units (no minor unit). */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"])

/** Stripe's minor-unit integer as the currency's major unit (`1250` USD → `12.5`). */
export function majorUnits(minor: number, currency: string): number {
  const code = currency.toUpperCase()
  return ZERO_DECIMAL.has(code) ? minor : minor / 100
}

/** A Stripe invoice as a document; `null` for a draft (nothing was charged yet). */
export function invoiceDocument(invoice: Stripe.Invoice): BillingDocumentView | null {
  if (!invoice.status || invoice.status === "draft") return null
  const line = invoice.lines?.data?.[0]?.description ?? null
  return {
    id: invoice.id,
    kind: "invoice",
    number: invoice.number ?? null,
    at: new Date(invoice.created * 1000).toISOString(),
    amount: { amount: majorUnits(invoice.total, invoice.currency), currency: invoice.currency.toUpperCase() },
    credits: null,
    status: invoice.status,
    description: invoice.description ?? line,
    pdfUrl: invoice.invoice_pdf ?? null,
    url: invoice.hosted_invoice_url ?? null,
  }
}

/**
 * A credit purchase (a pack or a load) as a document: its hosted receipt. A
 * refund row is the money given back: `status` `"refunded"`, the amount and
 * the credits negative.
 */
export function receiptDocument(row: PurchaseRow, currency: string): BillingDocumentView {
  const refund = row.type === "refund"
  const credits = row.credits_granted ?? null
  const paid = Math.abs(Number(row.amount_usd ?? 0))
  const status = refund ? "refunded" : row.status === null || row.status === "completed" ? "paid" : row.status
  return {
    id: row.id,
    kind: "receipt",
    number: null,
    at: row.created_at,
    amount: { amount: refund ? -paid : paid, currency: currency.toUpperCase() },
    credits,
    status,
    description: credits === null ? null : refund ? `Refund of ${Math.abs(credits).toLocaleString("en")} credits` : `${credits.toLocaleString("en")} credits`,
    pdfUrl: null,
    url: row.receipt_url ?? null,
  }
}

/** Newest first, invoices and receipts together. */
export function byNewest(docs: readonly BillingDocumentView[]): BillingDocumentView[] {
  return [...docs].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

const blank = (value: string | null | undefined): string | null => (value && value.trim() ? value : null)

/**
 * The card and the billing details on file. The details come from the card
 * first (what the person typed at checkout), then from the customer record.
 */
export function paymentMethodView(customer: Stripe.Customer | null, method: Stripe.PaymentMethod | null): PaymentMethodView {
  const card = method?.card
    ? { brand: method.card.brand, last4: method.card.last4, expMonth: method.card.exp_month, expYear: method.card.exp_year }
    : null
  const fromMethod = method?.billing_details
  const name = blank(fromMethod?.name) ?? blank(customer?.name)
  const email = blank(fromMethod?.email) ?? blank(customer?.email)
  const country = blank(fromMethod?.address?.country) ?? blank(customer?.address?.country)
  const billingDetails = name || email || country ? { name, email, country } : null
  return { card, billingDetails }
}
