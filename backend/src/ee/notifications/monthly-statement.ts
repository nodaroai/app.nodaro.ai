import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { deploymentPayerActive, deploymentPayerId } from "../../lib/deployment-payer.js"
import { sendTransactional, type LoopsDataVariables } from "../lib/loops-client.js"
import { usageSummaryFor, type UsageSummary } from "../billing/usage-summary.js"
import { israelParts } from "./israel-time.js"
import { readNotifyState, writeNotifyState } from "./notify-config.js"
import { isStandbySender } from "./founder-notify.js"

/**
 * The monthly statement email: on the 1st, each person who opted in
 * (`profiles.monthly_statement_email`) gets last month's figures — what they
 * spent, on how many runs, on which models, what they bought and what they
 * were refunded, and where the balance stands — through a Loops transactional
 * template (`LOOPS_MONTHLY_STATEMENT_ID`), whose data variables are listed in
 * {@link statementVariables}. Stripe sends a mail per payment but has no
 * monthly statement; this is ours.
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
 * month closes in the notify state once every opted-in person has a settled
 * row.
 *
 * Under a deployment payer the end users' money is the payer's, so only the
 * payer account's statement is sent. Economics never leave: the figures are
 * the person's own credits and what they paid in USD.
 */

/** Keep trying from the 1st through this day of the month (Israel time). */
export const STATEMENT_SEND_THROUGH_DAY = 3
/** Sends the provider refused before a person's month is given up. */
export const STATEMENT_MAX_ATTEMPTS = 3
/** A tick that outlives this is assumed stuck; the next one may start. */
export const STATEMENT_TICK_LATCH_MAX_MS = 30 * 60_000
const PAGE = 1000

export interface StatementRecipient {
  readonly id: string
  readonly email: string
  readonly display_name: string | null
  readonly subscription_credits: number | null
  readonly topup_credits: number | null
}

interface PaymentRow {
  type: string | null
  amount_usd: number | string | null
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
const usd = (value: number) => `$${value.toFixed(2)}`
const DASH = "—"

/** Where the billing page is: the deployment's own origin, else the Nodaro app. */
export function billingUrl(): string {
  const origin = (config.PUBLIC_URL ?? "").trim().replace(/\/$/, "")
  return `${origin || "https://app.nodaro.ai"}/billing`
}

/**
 * The template's data variables — every one a string, every one always
 * present and never empty (Loops fails a send with a missing or empty
 * variable). Names are the contract with the template in Loops.
 */
export function statementVariables(
  recipient: StatementRecipient,
  monthKey: string,
  summary: UsageSummary,
  payments: readonly PaymentRow[],
): LoopsDataVariables {
  const paid = payments.filter((p) => p.type === "subscription" || p.type === "topup")
  const refunds = payments.filter((p) => p.type === "refund")
  const paidUsd = paid.reduce((sum, p) => sum + Number(p.amount_usd ?? 0), 0)
  const refundsUsd = refunds.reduce((sum, p) => sum + Math.abs(Number(p.amount_usd ?? 0)), 0)
  const balance = (recipient.subscription_credits ?? 0) + (recipient.topup_credits ?? 0)
  const top = summary.mostUsed
  const categories = summary.byCategory.map((c) => `${c.category || "other"} ${n(c.credits)}`).join(" · ")
  return {
    name: recipient.display_name?.trim() || recipient.email.split("@")[0] || "there",
    month: monthLabel(monthKey),
    monthKey,
    used: n(summary.totals.used),
    runs: n(summary.totals.runs),
    avgPerRun: n(summary.totals.avgPerRun),
    purchased: n(summary.totals.purchased),
    granted: n(summary.totals.granted),
    refunded: n(summary.totals.refunded),
    topModel: top?.model || DASH,
    topModelCredits: top ? n(top.credits) : "0",
    categories: categories || DASH,
    paymentsCount: n(paid.length),
    // What was paid, less what Stripe gave back, in the month.
    paymentsUsd: usd(paidUsd - refundsUsd),
    refundsUsd: usd(refundsUsd),
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

/** The person's payments and refunds in the month — personal only: an organization's purchases ride the buyer's id with `org_id` set. */
async function paymentsOf(userId: string, from: string, to: string): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("type, amount_usd")
    .eq("user_id", userId)
    .is("org_id", null)
    .gte("created_at", from)
    .lte("created_at", to)
    .limit(PAGE)
  if (error) throw new Error(`transactions read failed: ${error.message}`)
  return (data ?? []) as PaymentRow[]
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

/** Send last month's statement to each opted-in person who has not had it; close the month when everyone has. */
export async function sendMonthlyStatements(monthKey: string, log: (line: string) => void = () => {}): Promise<StatementSendResult> {
  const { from, to } = monthBounds(monthKey)
  const payer = deploymentPayerActive() ? deploymentPayerId() : null
  const [everyone, rows] = await Promise.all([recipients(), rowsOf(monthKey)])
  // Under a deployment payer the end users' money is the payer's: only its statement goes.
  const people = payer ? everyone.filter((p) => p.id === payer) : everyone
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
        const [summary, payments] = await Promise.all([usageSummaryFor(person.id, { from, to, bucket: "month" }), paymentsOf(person.id, from, to)])
        if ("error" in summary) throw new Error("usage summary failed")
        outcome = await sendTransactional(config.LOOPS_MONTHLY_STATEMENT_ID, person.email, statementVariables(person, monthKey, summary, payments))
      } catch (err) {
        // The figures could not be read: the claim becomes a failed attempt, retried later.
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
