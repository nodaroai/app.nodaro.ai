import { describe, expect, it, vi, beforeEach } from "vitest"

const { invoicesList } = vi.hoisted(() => ({ invoicesList: vi.fn() }))
vi.mock("@/lib/config.js", () => ({ config: { LOOPS_MONTHLY_STATEMENT_ID: "tx_statement", PUBLIC_URL: "https://app.example.com/" } }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/deployment-payer.js", () => ({ deploymentPayerActive: vi.fn(() => false), deploymentPayerId: vi.fn(() => null) }))
vi.mock("@/ee/lib/loops-client.js", () => ({ sendTransactional: vi.fn() }))
vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: () => ({ invoices: { list: invoicesList } }) }))
vi.mock("@/ee/billing/stripe-customer.js", () => ({ stripeCustomerIdOf: vi.fn() }))
vi.mock("@/ee/notifications/notify-config.js", () => ({ readNotifyState: vi.fn(), writeNotifyState: vi.fn() }))
vi.mock("@/ee/notifications/founder-notify.js", () => ({ isStandbySender: vi.fn(() => false) }))

import { supabase } from "../../../lib/supabase.js"
import { config } from "../../../lib/config.js"
import { deploymentPayerActive, deploymentPayerId } from "../../../lib/deployment-payer.js"
import { sendTransactional } from "../../lib/loops-client.js"
import { stripeCustomerIdOf } from "../../billing/stripe-customer.js"
import { readNotifyState, writeNotifyState } from "../notify-config.js"
import { isStandbySender } from "../founder-notify.js"
import {
  STATEMENT_MAX_ATTEMPTS,
  maybeSendMonthlyStatements,
  monthBounds,
  monthLabel,
  previousMonthOf,
  sendMonthlyStatements,
  statementDocuments,
  statementVariables,
  type StatementDocument,
} from "../monthly-statement.js"

type Result = { data: unknown; error: { message: string } | null }

/** A fluent chain that records every call; `range` and awaiting answer `result`. */
function chain(result: Result) {
  const calls: Array<[string, unknown[]]> = []
  const self: Record<string, unknown> = {}
  for (const name of ["select", "eq", "in", "or", "is", "not", "order", "gte", "lte", "limit", "insert", "upsert", "update", "delete"]) {
    self[name] = vi.fn((...args: unknown[]) => {
      calls.push([name, args])
      return self
    })
  }
  self.range = vi.fn((from: number, to: number) => {
    calls.push(["range", [from, to]])
    const data = Array.isArray(result.data) ? result.data.slice(from, to + 1) : result.data
    return Promise.resolve({ data, error: result.error })
  })
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return { self, calls }
}

const FIRST = { id: "u1", email: "first@example.com", display_name: "Pat", subscription_credits: 100, topup_credits: 2850 }
const SECOND = { id: "u2", email: "second@example.com", display_name: null, subscription_credits: 0, topup_credits: 10 }

const FROM = "2026-10-01T00:00:00.000Z"
const TO = "2026-10-31T23:59:59.999Z"
const TOPUP = { id: "t1", user_id: "u1", type: "topup", amount_usd: "35.00", credits_granted: 1000, status: "completed", created_at: "2026-10-12T10:00:00.000Z", receipt_url: "https://pay.stripe.com/receipts/r1" }
const SUBSCRIPTION = { id: "t2", user_id: "u2", type: "subscription", amount_usd: 29, credits_granted: null, status: null, created_at: "2026-10-01T00:05:00.000Z", receipt_url: null, stripe_transaction_id: "in_1" }
const REFUND = { id: "t3", user_id: "u1", type: "refund", amount_usd: "5.00", credits_granted: -140, status: "completed", created_at: "2026-10-20T10:00:00.000Z", receipt_url: null }

/** A renewal invoice: created on the last day of September, paid at the turn of October. */
const INVOICE = {
  id: "in_1",
  status: "paid",
  number: "A1B2-0003",
  created: Math.floor(Date.parse("2026-09-30T23:00:00.000Z") / 1000),
  total: 2900,
  currency: "usd",
  invoice_pdf: "https://pay.stripe.com/invoice/in_1/pdf",
  hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
  status_transitions: { paid_at: Math.floor(Date.parse("2026-10-01T00:04:00.000Z") / 1000) },
  lines: { data: [{ description: "Standard plan" }] },
}

/**
 * The tables. `monthly_statements` answers its reads from `statements`; a
 * claim (an upsert or update followed by select) answers a fresh pending row
 * for the person, unless `claimRefused` — the unique constraint saying
 * someone else holds it. `transactions` answers every read (the month's
 * payers, then each person's rows) from the same list.
 */
function tables(over: Partial<Record<string, Result>> = {}, statements: Array<{ id: string; user_id: string; status: string; attempts: number }> = [], claimRefused = false) {
  const made: Record<string, ReturnType<typeof chain>[]> = {}
  const results: Record<string, Result> = {
    profiles: { data: [FIRST, SECOND], error: null },
    transactions: { data: [TOPUP, SUBSCRIPTION, REFUND], error: null },
    ...over,
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const c = chain(table === "monthly_statements" ? { data: statements, error: null } : (results[table] ?? { data: [], error: null }))
    if (table === "monthly_statements") {
      const record = c.self.select as (...a: unknown[]) => unknown
      c.self.select = vi.fn((...args: unknown[]) => {
        record(...args)
        const upsert = c.calls.find(([name]) => name === "upsert")
        const reclaim = c.calls.find(([name, a]) => name === "update" && (a[0] as { status?: string }).status === "pending")
        if (!upsert && !reclaim) return c.self
        if (claimRefused) return Promise.resolve({ data: [], error: null })
        if (upsert) {
          const row = upsert[1][0] as { user_id: string }
          return Promise.resolve({ data: [{ id: `row-${row.user_id}`, user_id: row.user_id, status: "pending", attempts: 0 }], error: null })
        }
        const id = (c.calls.find(([name, a]) => name === "eq" && a[0] === "id")?.[1][1] as string) ?? "?"
        const before = statements.find((s) => s.id === id)!
        return Promise.resolve({ data: [{ ...before, status: "pending" }], error: null })
      })
    }
    ;(made[table] ??= []).push(c)
    return c.self
  }) as never)
  return made
}

const patchesOf = (made: Record<string, ReturnType<typeof chain>[]>) =>
  (made.monthly_statements ?? []).flatMap((c) => c.calls.filter(([name]) => name === "update").map(([, args]) => args[0] as Record<string, unknown>))

const upsertsOf = (made: Record<string, ReturnType<typeof chain>[]>) =>
  (made.monthly_statements ?? []).flatMap((c) => c.calls.filter(([name]) => name === "upsert").map(([, args]) => (args[0] as { user_id: string }).user_id))

beforeEach(() => {
  vi.mocked(supabase.from).mockReset()
  vi.mocked(sendTransactional).mockReset()
  vi.mocked(stripeCustomerIdOf).mockReset().mockResolvedValue("cus_1")
  invoicesList.mockReset().mockResolvedValue({ data: [INVOICE] })
  vi.mocked(readNotifyState).mockReset().mockResolvedValue(null)
  vi.mocked(writeNotifyState).mockReset().mockResolvedValue(undefined)
  vi.mocked(isStandbySender).mockReturnValue(false)
  vi.mocked(deploymentPayerActive).mockReturnValue(false)
  vi.mocked(deploymentPayerId).mockReturnValue(null)
  config.PUBLIC_URL = "https://app.example.com/"
})

describe("the month", () => {
  it("names the month before a date, its UTC bounds, and its label", () => {
    expect(previousMonthOf("2026-11-01")).toBe("2026-10")
    expect(previousMonthOf("2026-01-02")).toBe("2025-12")
    expect(monthBounds("2026-10")).toEqual({ from: FROM, to: TO })
    expect(monthBounds("2026-12").to).toBe("2026-12-31T23:59:59.999Z")
    expect(monthLabel("2026-10")).toBe("October 2026")
  })
})

describe("statementDocuments", () => {
  it("keeps the paid invoice each of the month's subscription rows names (created before the month or not), and a completed purchase's receipt; newest first; the invoice links its PDF", () => {
    const unpaid = { ...INVOICE, id: "in_2", status: "open", status_transitions: { paid_at: null } }
    const lastMonth = { ...INVOICE, id: "in_3", status_transitions: { paid_at: Math.floor(Date.parse("2026-09-03T00:00:00.000Z") / 1000) } }
    const unnamed = { ...INVOICE, id: "in_4" }
    const pending = { ...TOPUP, id: "t9", status: "pending", created_at: "2026-10-15T00:00:00.000Z" }
    const rows = [TOPUP, pending, REFUND, SUBSCRIPTION, { ...SUBSCRIPTION, id: "t8", created_at: "2026-09-03T00:01:00.000Z", stripe_transaction_id: "in_3" }]
    const docs = statementDocuments([INVOICE, unpaid, lastMonth, unnamed] as never, rows, FROM, TO)
    expect(docs).toEqual([
      { kind: "receipt", title: "Receipt · 1,000 credits · $35.00 · Oct 12, 2026", url: "https://pay.stripe.com/receipts/r1", at: "2026-10-12T10:00:00.000Z" },
      { kind: "invoice", title: "Invoice A1B2-0003 · $29.00 · Oct 1, 2026", url: "https://pay.stripe.com/invoice/in_1/pdf", at: "2026-10-01T00:04:00.000Z" },
    ])
  })

  it("the row's month decides, not Stripe's clock: a renewal paid at 23:59 whose row lands after midnight is next month's document, as its money is", () => {
    const lateInvoice = { ...INVOICE, status_transitions: { paid_at: Math.floor(Date.parse("2026-10-31T23:59:30.000Z") / 1000) } }
    const lateRow = { ...SUBSCRIPTION, created_at: "2026-11-01T00:00:30.000Z" }
    expect(statementDocuments([lateInvoice] as never, [lateRow], FROM, TO)).toEqual([])
    const november = monthBounds("2026-11")
    expect(statementDocuments([lateInvoice] as never, [lateRow], november.from, november.to).map((d) => d.title)).toEqual(["Invoice A1B2-0003 · $29.00 · Oct 31, 2026"])
  })

  it("falls back to the hosted invoice page without a PDF, and leaves a receipt without a page unlinked", () => {
    const noPdf = { ...INVOICE, number: null, invoice_pdf: null }
    const docs = statementDocuments([noPdf] as never, [{ ...TOPUP, receipt_url: null }, SUBSCRIPTION], FROM, TO)
    expect(docs.map((d) => [d.title, d.url])).toEqual([
      ["Receipt · 1,000 credits · $35.00 · Oct 12, 2026", null],
      ["Invoice · $29.00 · Oct 1, 2026", "https://invoice.stripe.com/i/in_1"],
    ])
  })
})

describe("statementVariables", () => {
  const INVOICE_DOC: StatementDocument = { kind: "invoice", title: "Invoice A1B2-0003 · $29.00 · Oct 1, 2026", url: "https://pay.stripe.com/invoice/in_1/pdf", at: "2026-10-01T00:04:00.000Z" }
  const RECEIPT_DOC: StatementDocument = { kind: "receipt", title: "Receipt · 1,000 credits · $35.00 · Oct 12, 2026", url: "https://pay.stripe.com/receipts/r1", at: "2026-10-12T10:00:00.000Z" }

  it("is every template variable as a non-empty string: what was paid net of refunds, the documents by count, the newest linked one on the button", () => {
    const vars = statementVariables(FIRST, "2026-10", [RECEIPT_DOC, INVOICE_DOC], [TOPUP, { ...SUBSCRIPTION, user_id: "u1" }, REFUND])
    expect(vars).toEqual({
      name: "Pat",
      month: "October 2026",
      paidUsd: "$59.00",
      documents: "1 invoice and 1 receipt",
      documentTitle: "Receipt · 1,000 credits · $35.00 · Oct 12, 2026",
      documentLabel: "View the receipt",
      documentUrl: "https://pay.stripe.com/receipts/r1",
      balance: "2,950",
      billingUrl: "https://app.example.com/billing",
    })
    for (const v of Object.values(vars)) {
      expect(typeof v).toBe("string")
      expect(v).not.toBe("")
    }
  })

  it("names the invoice's PDF when that is the newest linked document, and skips a document without a link for one that has", () => {
    const unlinked: StatementDocument = { ...RECEIPT_DOC, url: null }
    expect(statementVariables(FIRST, "2026-10", [unlinked, INVOICE_DOC], [])).toMatchObject({
      documents: "1 invoice and 1 receipt",
      documentTitle: "Invoice A1B2-0003 · $29.00 · Oct 1, 2026",
      documentLabel: "Download the invoice (PDF)",
      documentUrl: "https://pay.stripe.com/invoice/in_1/pdf",
    })
  })

  it("falls back to the email's local part, to the billing page when no document has a link, to the Nodaro app without a public URL, and never to an empty string", () => {
    config.PUBLIC_URL = ""
    const vars = statementVariables(SECOND, "2026-10", [], [])
    expect(vars).toMatchObject({
      name: "second",
      paidUsd: "$0.00",
      documents: "your payment",
      documentTitle: "Your payment",
      documentLabel: "Open billing",
      documentUrl: "https://app.nodaro.ai/billing",
      balance: "10",
      billingUrl: "https://app.nodaro.ai/billing",
    })
    for (const v of Object.values(vars)) expect(v).not.toBe("")
    expect(statementVariables(SECOND, "2026-10", [{ ...INVOICE_DOC, url: null }], []).documentLabel).toBe("Open billing")
  })

  it("a refund larger than the month's payments reads as a negative sum, and a pending purchase counts for nothing", () => {
    expect(statementVariables(SECOND, "2026-10", [], [REFUND]).paidUsd).toBe("-$5.00")
    expect(statementVariables(SECOND, "2026-10", [], [{ ...TOPUP, status: "pending" }]).paidUsd).toBe("$0.00")
  })
})

describe("sendMonthlyStatements", () => {
  it("claims each paying opted-in person's row BEFORE sending, sends once, settles the row, and closes the month when everyone is settled", async () => {
    const made = tables({}, [{ id: "row-u2", user_id: "u2", status: "sent", attempts: 0 }])
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true, messageId: "m1" } as never)

    const result = await sendMonthlyStatements("2026-10")

    expect(result).toEqual({ sent: 1, unknown: 0, failed: 0, skipped: 1 })
    expect(sendTransactional).toHaveBeenCalledTimes(1)
    expect(sendTransactional).toHaveBeenCalledWith(
      "tx_statement",
      "first@example.com",
      expect.objectContaining({ month: "October 2026", documentLabel: "View the receipt", documentUrl: "https://pay.stripe.com/receipts/r1" }),
    )
    // The person's own paid invoices, from two months back (a renewal's invoice is made ahead of its period; a retry pays weeks later).
    expect(stripeCustomerIdOf).toHaveBeenCalledWith("u1")
    expect(invoicesList).toHaveBeenCalledWith({ customer: "cus_1", status: "paid", created: { gte: Math.floor(Date.parse(FROM) / 1000) - 60 * 86_400 }, limit: 100 })
    // The opted-in people only, with an email; the month's completed payers, paged in a stable order; the person's own, personal payments.
    expect(made.profiles![0]!.calls).toContainEqual(["eq", ["monthly_statement_email", true]])
    expect(made.profiles![0]!.calls).toContainEqual(["not", ["email", "is", null]])
    const payers = made.transactions![0]!
    expect(payers.calls).toContainEqual(["in", ["type", ["subscription", "topup"]]])
    expect(payers.calls).toContainEqual(["or", ["status.is.null,status.eq.completed"]])
    expect(payers.calls).toContainEqual(["gte", ["created_at", FROM]])
    expect(payers.calls).toContainEqual(["lte", ["created_at", TO]])
    expect(payers.calls).toContainEqual(["is", ["org_id", null]])
    expect(payers.calls).toContainEqual(["order", ["id", { ascending: true }]])
    const own = made.transactions!.find((c) => c.calls.some(([name, a]) => name === "eq" && a[0] === "user_id"))!
    expect(own.calls).toContainEqual(["eq", ["user_id", "u1"]])
    expect(own.calls).toContainEqual(["is", ["org_id", null]])
    expect(own.calls).toContainEqual(["select", ["id, type, amount_usd, credits_granted, status, created_at, receipt_url, stripe_transaction_id"]])
    // The claim — refused by the unique constraint when the row exists — came before the send.
    const claim = made.monthly_statements!.find((c) => c.calls.some(([name]) => name === "upsert"))!
    expect(claim.calls).toContainEqual(["upsert", [{ user_id: "u1", month: "2026-10", recipient_email: "first@example.com", status: "pending", attempts: 0 }, { onConflict: "user_id,month", ignoreDuplicates: true }]])
    expect(vi.mocked(sendTransactional).mock.invocationCallOrder[0]!).toBeGreaterThan((claim.self.upsert as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!)
    // The row was then marked sent.
    expect(patchesOf(made)).toContainEqual(expect.objectContaining({ status: "sent", message_id: "m1" }))
    expect(writeNotifyState).toHaveBeenCalledWith("notify_last_statement_month", "2026-10")
  })

  it("an opted-in person who paid nothing in the month gets no email, holds no row, and does not keep the month open", async () => {
    const made = tables({ transactions: { data: [TOPUP], error: null } })
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    expect(await sendMonthlyStatements("2026-10")).toEqual({ sent: 1, unknown: 0, failed: 0, skipped: 0 })
    expect(sendTransactional).toHaveBeenCalledTimes(1)
    expect(sendTransactional).toHaveBeenCalledWith("tx_statement", "first@example.com", expect.anything())
    expect(upsertsOf(made)).toEqual(["u1"])
    expect(writeNotifyState).toHaveBeenCalledWith("notify_last_statement_month", "2026-10")
  })

  it("sends nothing when the claim is refused — another tick or replica holds the row", async () => {
    tables({}, [], true)
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    const result = await sendMonthlyStatements("2026-10")
    expect(result).toEqual({ sent: 0, unknown: 0, failed: 0, skipped: 2 })
    expect(sendTransactional).not.toHaveBeenCalled()
    expect(writeNotifyState).not.toHaveBeenCalled()
  })

  it("skips a pending, sent or unknown row and a failed row that used its attempts; retries a failed row that has some left", async () => {
    tables({}, [
      { id: "r1", user_id: "u1", status: "pending", attempts: 0 },
      { id: "r2", user_id: "u2", status: "failed", attempts: STATEMENT_MAX_ATTEMPTS },
    ])
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    expect(await sendMonthlyStatements("2026-10")).toEqual({ sent: 0, unknown: 0, failed: 0, skipped: 2 })
    expect(sendTransactional).not.toHaveBeenCalled()
    expect(writeNotifyState).not.toHaveBeenCalled() // u1 is still pending: the month stays open

    const made = tables({ profiles: { data: [SECOND], error: null } }, [{ id: "r2", user_id: "u2", status: "failed", attempts: 1 }])
    expect(await sendMonthlyStatements("2026-10")).toEqual({ sent: 1, unknown: 0, failed: 0, skipped: 0 })
    const reclaim = made.monthly_statements!.find((c) => c.calls.some(([name, args]) => name === "update" && (args[0] as { status?: string }).status === "pending"))!
    expect(reclaim.calls).toContainEqual(["eq", ["status", "failed"]])
    expect(sendTransactional).toHaveBeenCalledWith("tx_statement", "second@example.com", expect.anything())
    expect(writeNotifyState).toHaveBeenCalledWith("notify_last_statement_month", "2026-10")
  })

  it("records a timeout as unknown (the email may have gone, never again) and a provider refusal as a failed attempt; the month stays open", async () => {
    const made = tables()
    vi.mocked(sendTransactional)
      .mockResolvedValueOnce({ ok: false, failureKind: "timeout", error: "timeout" } as never)
      .mockResolvedValueOnce({ ok: false, failureKind: "provider", error: "bad template" } as never)
    const log = vi.fn()

    const result = await sendMonthlyStatements("2026-10", log)

    expect(result).toEqual({ sent: 0, unknown: 1, failed: 1, skipped: 0 })
    expect(patchesOf(made)).toContainEqual(expect.objectContaining({ status: "unknown" }))
    expect(patchesOf(made)).toContainEqual({ status: "failed", attempts: 1 })
    expect(writeNotifyState).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining("bad template"))
  })

  it("a failed Stripe read turns the claim into a failed attempt for that person alone; a person with no customer gets receipts only", async () => {
    const made = tables()
    vi.mocked(stripeCustomerIdOf).mockRejectedValueOnce(new Error("stripe_customers lookup failed: down")).mockResolvedValueOnce(null)
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    const result = await sendMonthlyStatements("2026-10")
    expect(result).toEqual({ sent: 1, unknown: 0, failed: 1, skipped: 0 })
    expect(sendTransactional).toHaveBeenCalledTimes(1)
    expect(sendTransactional).toHaveBeenCalledWith("tx_statement", "second@example.com", expect.objectContaining({ documents: "1 receipt" }))
    expect(invoicesList).not.toHaveBeenCalled()
    expect(patchesOf(made)).toContainEqual({ status: "failed", attempts: 1 })
  })

  it("under a deployment payer only the payer's own statement goes: the end users' money is the payer's", async () => {
    vi.mocked(deploymentPayerActive).mockReturnValue(true)
    vi.mocked(deploymentPayerId).mockReturnValue("u2")
    tables()
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    expect(await sendMonthlyStatements("2026-10")).toEqual({ sent: 1, unknown: 0, failed: 0, skipped: 0 })
    expect(sendTransactional).toHaveBeenCalledTimes(1)
    expect(sendTransactional).toHaveBeenCalledWith("tx_statement", "second@example.com", expect.anything())
    expect(writeNotifyState).toHaveBeenCalledWith("notify_last_statement_month", "2026-10")
  })
})

describe("maybeSendMonthlyStatements", () => {
  // 2026-11-01 09:30 Israel time (UTC+2 in November) is 07:30 UTC.
  const FIRST_MORNING = new Date("2026-11-01T07:30:00.000Z")

  it("runs from the digest hour of the 1st, for the month that just ended", async () => {
    tables()
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    await maybeSendMonthlyStatements(FIRST_MORNING, 8, () => {})
    expect(sendTransactional).toHaveBeenCalledTimes(2)
    expect(sendTransactional).toHaveBeenCalledWith("tx_statement", "first@example.com", expect.objectContaining({ month: "October 2026" }))
  })

  it("waits before the digest hour, stops after the 3rd, and does nothing once the month is closed or on the standby sender", async () => {
    tables()
    vi.mocked(sendTransactional).mockResolvedValue({ ok: true } as never)
    await maybeSendMonthlyStatements(new Date("2026-11-01T05:30:00.000Z"), 8, () => {}) // 07:30 Israel, before 08
    await maybeSendMonthlyStatements(new Date("2026-11-04T07:30:00.000Z"), 8, () => {}) // the 4th
    vi.mocked(readNotifyState).mockResolvedValueOnce("2026-10")
    await maybeSendMonthlyStatements(FIRST_MORNING, 8, () => {})
    vi.mocked(isStandbySender).mockReturnValueOnce(true)
    await maybeSendMonthlyStatements(FIRST_MORNING, 8, () => {})
    expect(sendTransactional).not.toHaveBeenCalled()
  })

  it("keeps trying on the 2nd for a month still open, one tick at a time: an overlapping tick is refused by the latch", async () => {
    tables()
    let release: (v: unknown) => void = () => {}
    vi.mocked(sendTransactional).mockImplementationOnce(() => new Promise((r) => (release = r)) as never).mockResolvedValue({ ok: true } as never)
    const first = maybeSendMonthlyStatements(new Date("2026-11-02T10:00:00.000Z"), 8, () => {})
    await new Promise((r) => setTimeout(r, 0))
    await maybeSendMonthlyStatements(new Date("2026-11-02T10:05:00.000Z"), 8, () => {})
    release({ ok: true })
    await first
    expect(sendTransactional).toHaveBeenCalledTimes(2) // the first tick's two people, nothing from the second
  })

  it("never throws: a failed profiles read is logged", async () => {
    tables({ profiles: { data: null, error: { message: "down" } } })
    const log = vi.fn()
    await maybeSendMonthlyStatements(FIRST_MORNING, 8, log)
    expect(log).toHaveBeenCalledWith(expect.stringContaining("profiles read failed"))
  })
})
