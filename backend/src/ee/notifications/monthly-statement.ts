import type Stripe from "stripe"
import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { deploymentPayerActive, deploymentPayerId } from "../../lib/deployment-payer.js"
import { sendTransactional, type LoopsDataVariables } from "../lib/loops-client.js"
import { getStripe } from "../billing/stripe-client.js"
import { stripeCustomerIdOf } from "../billing/stripe-customer.js"
import { invoiceDocument, receiptDocument, type PurchaseRow } from "../billing/billing-documents.js"
import { israelParts } from "./israel-time.js"
import { readNotifyState, writeNotifyState } from "./notify-config.js"
import { isStandbySender } from "./founder-notify.js"

/**
 * The monthly statement email: on the 1st, each person who opted in
 * (`profiles.monthly_statement_email`) AND paid in the month gets a short
 * email with last month's payment documents — the Stripe invoice (a
 * subscription payment, as a PDF) or the receipt (a credit purchase, a hosted
 * page) — through a Loops transactional template (`LOOPS_MONTHLY_STATEMENT_ID`),
 * whose data variables are listed in {@link statementVariables}. A month with
 * no payment sends nothing: there is no document to send. Stripe sends a mail
 * per payment but has no monthly one; this is ours.
 *
 * Months are UTC calendar months. The send runs on the 5-minute cron from the
 * `digestHour` of the 1st (Israel time) and keeps trying through the 3rd, so
 * a provider outage on the morning of the 1st does not lose the month.
 *
 * NEVER TWICE: a person's row in `monthly_statements` is CLAIMED before the
 * email is sent (an insert the unique constraint refuses when the row exists),
 * so two ticks, two replicas, or a tick that outlives the interval cannot send
 * the same statement twice; an in-process latch keeps ticks from overlapping
 * at all. A claim that was sent is `sent`; a timeout — the email may well have
 * gone — is `unknown` and never sent again; a provider refusal is `failed`
 * and retried on a later tick up to {@link STATEMENT_MAX_ATTEMPTS} times. The
 * month closes in the notify state once every recipient has a settled row.
 *
 * Under a deployment payer the end users' money is the payer's, so only the
 * payer account's statement is sent. Economics never leave: the figures are
 * what the person paid and the documents Stripe gave them.
 */

/** Keep trying from the 1st through this day of the month (Israel time). */
export const STATEMENT_SEND_THROUGH_DAY = 3
/** Sends the provider refused before a person's month is given up. */
export const STATEMENT_MAX_ATTEMPTS = 3
/** A tick that outlives this is assumed stuck; the next one may start. */
export const STATEMENT_TICK_LATCH_MAX_MS = 30 * 60_000
const PAGE = 1000
/**
 * The month's invoices are the ones its `transactions` rows name (the
 * `invoice.paid` row stores the invoice id), so the Stripe list only has to
 * reach back far enough to hold them: a renewal's invoice is created before
 * its period starts, and a dunning retry can pay one weeks later.
 */
const INVOICE_LOOKBACK_S = 60 * 86_400

export interface StatementRecipient {
  readonly id: string
  readonly email: string
  readonly display_name: string | null
  readonly subscription_credits: number | null
  readonly topup_credits: number | null
}

/** A `transactions` row of the month: a payment (naming its Stripe invoice), a credit purchase, or a refund. */
export interface PaymentRow extends PurchaseRow {
  readonly user_id?: string
  readonly stripe_transaction_id?: string | null
}

/** One document to hand the person: the invoice's PDF or the receipt's page. */
export interface StatementDocument {
  readonly kind: "invoice" | "receipt"
  /** `Invoice A1B2-0003 · $29.00 · 3 Oct 2026`. */
  readonly title: string
  readonly url: string | null
  /** ISO-8601: when it was paid. */
  readonly at: string
}

interface StatementRow {
  id: string
  user_id: string
  status: "pending" | "sent" | "unknown" | "failed"
  attempts: number
}

/** The UTC month `YYYY-MM` before the one `date` (`YYYY-MM-DD`) is in. */
export function previousMonthOf(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** A month's bounds in UTC, inclusive of its last millisecond. */
export function monthBounds(monthKey: string): { from: string; to: string } {
  const [y, m] = monthKey.split("-").map(Number) as [number, number]
  return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString(), to: new Date(Date.UTC(y, m, 1) - 1).toISOString() }
}

/** `2026-10` → `October 2026`. */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" })
}

const n = (value: number) => value.toLocaleString("en")
/** `$12.50`; a refund larger than the month's payments reads `-$12.50`. */
const usd = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`
const money = (amount: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).format(amount)
const day = (iso: string) => new Date(iso).toLocaleString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const paidRow = (row: PaymentRow) => row.status === null || row.status === undefined || row.status === "completed"
const inMonth = (iso: string, from: string, to: string) => iso >= from && iso <= to

/** Where the billing page is: the deployment's own origin, else the Nodaro app. */
export function billingUrl(): string {
  const origin = (config.PUBLIC_URL ?? "").trim().replace(/\/$/, "")
  return `${origin || "https://app.nodaro.ai"}/billing`
}

/**
 * The month's documents, newest first: the paid invoice behind each of the
 * month's subscription rows (the row names it, so the month is the row's —
 * the same month `paidUsd` counts — whether Stripe paid it at the turn of the
 * month or weeks after a failed attempt), and every completed credit
 * purchase's receipt.
 */
export function statementDocuments(invoices: readonly Stripe.Invoice[], rows: readonly PaymentRow[], from: string, to: string): StatementDocument[] {
  const docs: StatementDocument[] = []
  const named = new Set(rows.filter((r) => r.type === "subscription" && paidRow(r) && inMonth(r.created_at, from, to)).map((r) => r.stripe_transaction_id))
  for (const invoice of invoices) {
    const paidAt = invoice.status_transitions?.paid_at
    if (invoice.status !== "paid" || typeof paidAt !== "number" || !named.has(invoice.id)) continue
    const at = new Date(paidAt * 1000).toISOString()
    const doc = invoiceDocument(invoice)
    if (!doc) continue
    const number = doc.number ? ` ${doc.number}` : ""
    docs.push({ kind: "invoice", title: `Invoice${number} · ${money(doc.amount.amount, doc.amount.currency)} · ${day(at)}`, url: doc.pdfUrl ?? doc.url, at })
  }
  for (const row of rows) {
    if (row.type !== "topup" || !paidRow(row) || !inMonth(row.created_at, from, to)) continue
    const doc = receiptDocument(row, "USD")
    const credits = doc.credits === null ? "" : `${n(doc.credits)} credits · `
    docs.push({ kind: "receipt", title: `Receipt · ${credits}${money(doc.amount.amount, doc.amount.currency)} · ${day(row.created_at)}`, url: doc.url, at: row.created_at })
  }
  return docs.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** `1 invoice and 2 receipts`; `your payment` when the month has no document to name. */
function documentsPhrase(docs: readonly StatementDocument[]): string {
  const count = (kind: StatementDocument["kind"]) => docs.filter((d) => d.kind === kind).length
  const parts = [
    [count("invoice"), "invoice"],
    [count("receipt"), "receipt"],
  ]
    .filter(([c]) => (c as number) > 0)
    .map(([c, word]) => `${c} ${word}${c === 1 ? "" : "s"}`)
  return parts.join(" and ") || "your payment"
}

/**
 * The template's data variables — every one a string, every one always
 * present and never empty (Loops fails a send with a missing or empty
 * variable). Names are the contract with the template in Loops. The one
 * document the button opens is the newest that has a link — the invoice's
 * PDF, else the receipt's page — and the billing page when none has.
 */
export function statementVariables(recipient: StatementRecipient, monthKey: string, docs: readonly StatementDocument[], payments: readonly PaymentRow[]): LoopsDataVariables {
  const paid = payments.filter((p) => (p.type === "subscription" || p.type === "topup") && paidRow(p))
  const refunds = payments.filter((p) => p.type === "refund")
  const paidUsd = paid.reduce((sum, p) => sum + Number(p.amount_usd ?? 0), 0)
  const refundsUsd = refunds.reduce((sum, p) => sum + Math.abs(Number(p.amount_usd ?? 0)), 0)
  const balance = (recipient.subscription_credits ?? 0) + (recipient.topup_credits ?? 0)
  const primary = docs.find((d) => d.url !== null) ?? docs[0]
  const linked = primary?.url ? primary : null
  return {
    name: recipient.display_name?.trim() || recipient.email.split("@")[0] || "there",
    month: monthLabel(monthKey),
    // What was paid, less what Stripe gave back, in the month.
    paidUsd: usd(paidUsd - refundsUsd),
    documents: documentsPhrase(docs),
    documentTitle: primary?.title ?? "Your payment",
    documentLabel: linked ? (linked.kind === "invoice" ? "Download the invoice (PDF)" : "View the receipt") : "Open billing",
    documentUrl: linked?.url ?? billingUrl(),
    balance: n(balance),
    billingUrl: billingUrl(),
  }
}

async function recipients(): Promise<StatementRecipient[]> {
  const out: StatementRecipient[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, display_name, subscription_credits, topup_credits")
      .eq("monthly_statement_email", true)
      .not("email", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`profiles read failed: ${error.message}`)
    const rows = (data ?? []) as StatementRecipient[]
    out.push(...rows.filter((r) => typeof r.email === "string" && r.email.includes("@")))
    if (rows.length < PAGE) return out
  }
}

/** Who paid in the month — personal only: an organization's purchases ride the buyer's id with `org_id` set. */
async function payersOf(from: string, to: string): Promise<Set<string>> {
  const out = new Set<string>()
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("user_id")
      .in("type", ["subscription", "topup"])
      .or("status.is.null,status.eq.completed")
      .is("org_id", null)
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`transactions read failed: ${error.message}`)
    const rows = (data ?? []) as Array<{ user_id: string | null }>
    for (const row of rows) if (typeof row.user_id === "string") out.add(row.user_id)
    if (rows.length < PAGE) return out
  }
}

async function rowsOf(monthKey: string): Promise<Map<string, StatementRow>> {
  const out = new Map<string, StatementRow>()
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from("monthly_statements").select("id, user_id, status, attempts").eq("month", monthKey).range(offset, offset + PAGE - 1)
    if (error) throw new Error(`monthly_statements read failed: ${error.message}`)
    const rows = (data ?? []) as StatementRow[]
    for (const r of rows) out.set(r.user_id, r)
    if (rows.length < PAGE) return out
  }
}

/** The person's payments, purchases and refunds in the month — personal only (`org_id` null), receipts included. */
async function paymentsOf(userId: string, from: string, to: string): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, type, amount_usd, credits_granted, status, created_at, receipt_url, stripe_transaction_id")
    .eq("user_id", userId)
    .is("org_id", null)
    .gte("created_at", from)
    .lte("created_at", to)
    .limit(PAGE)
  if (error) throw new Error(`transactions read failed: ${error.message}`)
  return (data ?? []) as PaymentRow[]
}

/** The person's paid invoices of the last two months, for the month's rows to pick from; none without a customer. */
async function invoicesOf(userId: string, from: string): Promise<Stripe.Invoice[]> {
  const customer = await stripeCustomerIdOf(userId)
  if (!customer) return []
  const created = Math.floor(Date.parse(from) / 1000) - INVOICE_LOOKBACK_S
  return (await getStripe().invoices.list({ customer, status: "paid", created: { gte: created }, limit: 100 })).data
}

/**
 * The claim: a new row, refused by the unique constraint when one exists
 * (`ignoreDuplicates` answers no row), or a failed row re-taken for another
 * attempt. `null` = someone else holds it, or it is settled.
 */
async function claim(person: StatementRecipient, monthKey: string, existing: StatementRow | undefined): Promise<StatementRow | null> {
  if (!existing) {
    const { data, error } = await supabase
      .from("monthly_statements")
      .upsert({ user_id: person.id, month: monthKey, recipient_email: person.email, status: "pending", attempts: 0 }, { onConflict: "user_id,month", ignoreDuplicates: true })
      .select("id, user_id, status, attempts")
    if (error) throw new Error(`monthly_statements claim failed: ${error.message}`)
    const row = ((data ?? []) as StatementRow[])[0]
    return row ?? null
  }
  if (existing.status !== "failed" || existing.attempts >= STATEMENT_MAX_ATTEMPTS) return null
  const { data, error } = await supabase
    .from("monthly_statements")
    .update({ status: "pending", claimed_at: new Date().toISOString() })
    .eq("id", existing.id)
    .eq("status", "failed")
    .select("id, user_id, status, attempts")
  if (error) throw new Error(`monthly_statements re-claim failed: ${error.message}`)
  const row = ((data ?? []) as StatementRow[])[0]
  return row ?? null
}

async function settle(row: StatementRow, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("monthly_statements").update(patch).eq("id", row.id)
  if (error) throw new Error(`monthly_statements update failed: ${error.message}`)
}

/** A row the sender is done with: sent, unknown, or failed for good. */
const settled = (row: StatementRow | undefined): boolean =>
  row !== undefined && (row.status === "sent" || row.status === "unknown" || (row.status === "failed" && row.attempts >= STATEMENT_MAX_ATTEMPTS))

export interface StatementSendResult {
  readonly sent: number
  readonly unknown: number
  readonly failed: number
  readonly skipped: number
}

/** Send last month's statement to each opted-in person who paid and has not had it; close the month when everyone has. */
export async function sendMonthlyStatements(monthKey: string, log: (line: string) => void = () => {}): Promise<StatementSendResult> {
  const { from, to } = monthBounds(monthKey)
  const payer = deploymentPayerActive() ? deploymentPayerId() : null
  const [everyone, payers, rows] = await Promise.all([recipients(), payersOf(from, to), rowsOf(monthKey)])
  // Under a deployment payer the end users' money is the payer's: only its statement goes.
  const optedIn = payer ? everyone.filter((p) => p.id === payer) : everyone
  // Only a month with a payment has a document to send.
  const people = optedIn.filter((p) => payers.has(p.id))
  const result = { sent: 0, unknown: 0, failed: 0, skipped: 0 }
  for (const person of people) {
    const existing = rows.get(person.id)
    if (settled(existing) || existing?.status === "pending") {
      result.skipped += 1
      continue
    }
    try {
      const row = await claim(person, monthKey, existing)
      if (!row) {
        result.skipped += 1
        continue
      }
      let outcome: Awaited<ReturnType<typeof sendTransactional>>
      try {
        const [invoices, payments] = await Promise.all([invoicesOf(person.id, from), paymentsOf(person.id, from, to)])
        const docs = statementDocuments(invoices, payments, from, to)
        outcome = await sendTransactional(config.LOOPS_MONTHLY_STATEMENT_ID, person.email, statementVariables(person, monthKey, docs, payments))
      } catch (err) {
        // The documents could not be read: the claim becomes a failed attempt, retried later.
        await settle(row, { status: "failed", attempts: row.attempts + 1 })
        rows.set(person.id, { ...row, status: "failed", attempts: row.attempts + 1 })
        result.failed += 1
        log(`[monthly-statement] ${person.id}: ${(err as Error).message}`)
        continue
      }
      if (outcome.ok || outcome.failureKind === "timeout" || outcome.failureKind === "network") {
        const status = outcome.ok ? "sent" : "unknown"
        await settle(row, { status, message_id: outcome.messageId ?? null, sent_at: new Date().toISOString() })
        rows.set(person.id, { ...row, status })
        if (outcome.ok) result.sent += 1
        else result.unknown += 1
      } else {
        await settle(row, { status: "failed", attempts: row.attempts + 1 })
        rows.set(person.id, { ...row, status: "failed", attempts: row.attempts + 1 })
        result.failed += 1
        log(`[monthly-statement] ${person.id}: ${outcome.error ?? "provider refused"}`)
      }
    } catch (err) {
      result.failed += 1
      log(`[monthly-statement] ${person.id}: ${(err as Error).message}`)
    }
  }
  if (people.every((p) => settled(rows.get(p.id)))) await writeNotifyState("notify_last_statement_month", monthKey)
  return result
}

let tickStartedAt: number | null = null

/**
 * The cron entry: from `digestHour` on the 1st through the 3rd (Israel time),
 * until the month is closed; one tick at a time. Never throws.
 */
export async function maybeSendMonthlyStatements(now: Date, digestHour: number, log: (line: string) => void = (line) => console.error(line)): Promise<void> {
  if (tickStartedAt !== null && now.getTime() - tickStartedAt < STATEMENT_TICK_LATCH_MAX_MS) return
  try {
    if (!config.LOOPS_MONTHLY_STATEMENT_ID) return
    if (isStandbySender()) return
    const { date, hour } = israelParts(now)
    const day = Number(date.slice(8, 10))
    if (day > STATEMENT_SEND_THROUGH_DAY || hour < digestHour) return
    const monthKey = previousMonthOf(date)
    if ((await readNotifyState("notify_last_statement_month")) === monthKey) return
    tickStartedAt = now.getTime()
    const result = await sendMonthlyStatements(monthKey, log)
    log(`[monthly-statement] ${monthKey}: sent ${result.sent}, unknown ${result.unknown}, failed ${result.failed}, already ${result.skipped}`)
  } catch (err) {
    log(`[monthly-statement] tick failed: ${(err as Error).message}`)
  } finally {
    tickStartedAt = null
  }
}
