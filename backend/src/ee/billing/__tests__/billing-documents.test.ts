import { describe, expect, it } from "vitest"
import type Stripe from "stripe"
import { byNewest, invoiceDocument, majorUnits, paymentMethodView, receiptDocument } from "../billing-documents.js"

function invoice(over: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    id: "in_1",
    number: "A1B2-0001",
    created: 1_767_225_600, // 2026-01-01T00:00:00Z
    total: 1250,
    currency: "usd",
    status: "paid",
    description: null,
    invoice_pdf: "https://pay.stripe.com/invoice/in_1/pdf",
    hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
    lines: { data: [{ description: "Pro plan (monthly)" }] },
    ...over,
  } as unknown as Stripe.Invoice
}

describe("majorUnits", () => {
  it("divides a two-decimal currency by 100 and leaves a zero-decimal one whole", () => {
    expect(majorUnits(1250, "usd")).toBe(12.5)
    expect(majorUnits(1250, "JPY")).toBe(1250)
  })
})

describe("invoiceDocument", () => {
  it("shapes a paid invoice with its number, PDF, hosted page and the first line's description", () => {
    expect(invoiceDocument(invoice())).toEqual({
      id: "in_1",
      kind: "invoice",
      number: "A1B2-0001",
      at: "2026-01-01T00:00:00.000Z",
      amount: { amount: 12.5, currency: "USD" },
      credits: null,
      status: "paid",
      description: "Pro plan (monthly)",
      pdfUrl: "https://pay.stripe.com/invoice/in_1/pdf",
      url: "https://invoice.stripe.com/i/in_1",
    })
  })

  it("prefers the invoice's own description over its first line", () => {
    expect(invoiceDocument(invoice({ description: "October" }))?.description).toBe("October")
  })

  it("leaves a draft out: nothing was charged yet", () => {
    expect(invoiceDocument(invoice({ status: "draft" }))).toBeNull()
    expect(invoiceDocument(invoice({ status: null }))).toBeNull()
  })

  it("has no links when Stripe gives none", () => {
    const doc = invoiceDocument(invoice({ invoice_pdf: null, hosted_invoice_url: null, number: null, lines: { data: [] } as never }))
    expect(doc).toMatchObject({ pdfUrl: null, url: null, number: null, description: null })
  })
})

describe("receiptDocument", () => {
  const row = { id: "tx_1", type: "topup", amount_usd: "35.00", credits_granted: 3000, status: "completed", created_at: "2026-10-25T22:02:00.000Z", receipt_url: "https://pay.stripe.com/receipts/r1" }

  it("shapes a refund row as money given back: refunded, the amount and the credits negative", () => {
    expect(receiptDocument({ ...row, id: "tx_r", type: "refund", amount_usd: "35.00", credits_granted: -3000, receipt_url: null }, "usd")).toMatchObject({
      status: "refunded",
      amount: { amount: -35, currency: "USD" },
      credits: -3000,
      description: "Refund of 3,000 credits",
      url: null,
    })
  })

  it("shapes a completed credit purchase as a paid receipt with its credits", () => {
    expect(receiptDocument(row, "usd")).toEqual({
      id: "tx_1",
      kind: "receipt",
      number: null,
      at: "2026-10-25T22:02:00.000Z",
      amount: { amount: 35, currency: "USD" },
      credits: 3000,
      status: "paid",
      description: "3,000 credits",
      pdfUrl: null,
      url: "https://pay.stripe.com/receipts/r1",
    })
  })

  it("keeps an unusual status as it is, and a missing receipt as null", () => {
    expect(receiptDocument({ ...row, status: "pending", receipt_url: null }, "usd")).toMatchObject({ status: "pending", url: null })
  })
})

describe("byNewest", () => {
  it("orders invoices and receipts together, newest first", () => {
    const older = receiptDocument({ id: "a", type: "topup", amount_usd: 1, credits_granted: 10, status: null, created_at: "2026-01-01T12:00:00.000Z", receipt_url: null }, "usd")
    const newer = invoiceDocument(invoice({ created: 1_767_312_000 }))! // 2026-01-02T00:00:00Z
    const oldest = invoiceDocument(invoice({ id: "in_0", created: 1_767_225_600 }))!
    expect(byNewest([oldest, older, newer]).map((d) => d.id)).toEqual(["in_1", "a", "in_0"])
  })
})

describe("paymentMethodView", () => {
  const customer = { id: "cus_1", name: "Asaf", email: "a@example.com", address: { country: "IL" } } as unknown as Stripe.Customer
  const method = {
    card: { brand: "visa", last4: "1810", exp_month: 12, exp_year: 2030 },
    billing_details: { name: "A. Naim", email: null, address: { country: null } },
  } as unknown as Stripe.PaymentMethod

  it("reads the card, and fills the details from the card first, then the customer", () => {
    expect(paymentMethodView(customer, method)).toEqual({
      card: { brand: "visa", last4: "1810", expMonth: 12, expYear: 2030 },
      billingDetails: { name: "A. Naim", email: "a@example.com", country: "IL" },
    })
  })

  it("has no card and the customer's details when nothing is saved", () => {
    expect(paymentMethodView(customer, null)).toEqual({ card: null, billingDetails: { name: "Asaf", email: "a@example.com", country: "IL" } })
  })

  it("is all null for an account Stripe does not know", () => {
    expect(paymentMethodView(null, null)).toEqual({ card: null, billingDetails: null })
  })
})
