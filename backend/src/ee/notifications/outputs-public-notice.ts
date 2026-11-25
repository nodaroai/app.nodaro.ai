/**
 * The email a person gets when a plan drop returns their private outputs to
 * public: one per reset, never more.
 *
 * The reset itself enqueues it: the database stamps `outputs_public_since`
 * with reason `plan` on the false → true write that rides in the tier's own
 * update (`tierColumns`, every tier-changing path), and an AFTER trigger
 * inserts one `outputs_public_notices` row keyed (user, that stamp) — migration
 * 713. A redelivered webhook or a repeated write sets `true` over `true`:
 * nothing is stamped, nothing enqueued. So this sender never decides WHO; it
 * only delivers, and it can never block or fail a billing write.
 *
 * NEVER TWICE: a row is CLAIMED (`pending`/`failed` → `sending`, a
 * compare-and-set) before the send. `sent` and `unknown` (a timeout: it may
 * well have gone) are final; a provider refusal is `failed` and retried on a
 * later tick, and the {@link NOTICE_MAX_ATTEMPTS}th refusal is `given_up`; a
 * row left `sending` (a crash mid-send) is never sent again. A notice older
 * than {@link NOTICE_MAX_AGE_MS} is `skipped` on every tick, sender on or off,
 * so nothing piles up; so is one whose person is private again, reset again
 * since, or back on a plan with private outputs: the news is stale.
 *
 * Template: `LOOPS_OUTPUTS_PUBLIC_ID` (Loops; English), data variables `date`
 * (the day, e.g. "November 25, 2026") and `plansUrl`. Unset, on an edition
 * without credits, without a Loops key, or on the standby sender: nothing is
 * sent and rows wait.
 */
import { config, hasCredits } from "../../lib/config.js"
import { flowBaseUrl } from "../../lib/deployment-urls.js"
import { supabase } from "../../lib/supabase.js"
import { isLoopsConfigured, sendTransactional, type LoopsDataVariables } from "../lib/loops-client.js"
import { isStandbySender } from "./founder-notify.js"
import { planAllowsPrivateOutputs } from "../../lib/private-outputs-plan.js"
import { resolveTierFrom } from "../billing/tier-columns.js"

export const NOTICE_MAX_ATTEMPTS = 3
export const NOTICE_MAX_AGE_MS = 3 * 86_400_000
const BATCH = 100

interface NoticeRow {
  readonly user_id: string
  readonly public_since: string
  readonly status: string
  readonly attempts: number
  readonly created_at: string
}

export interface NoticeSendResult {
  sent: number
  unknown: number
  failed: number
  skipped: number
}

/** The day the outputs went public, in the template's language (English). */
export function noticeDate(publicSince: string): string {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(publicSince))
}

export function noticeVariables(publicSince: string): LoopsDataVariables {
  return { date: noticeDate(publicSince), plansUrl: `${flowBaseUrl()}/pricing` }
}

async function settle(row: NoticeRow, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("outputs_public_notices")
    .update(patch)
    .eq("user_id", row.user_id)
    .eq("public_since", row.public_since)
  if (error) console.error(`[outputs-public-notice] ${row.user_id}: recording the outcome failed: ${error.message}`)
}

/** `pending`/`failed` → `sending`, only if the row still holds what was read. */
async function claim(row: NoticeRow): Promise<boolean> {
  const { data, error } = await supabase
    .from("outputs_public_notices")
    .update({ status: "sending" })
    .eq("user_id", row.user_id)
    .eq("public_since", row.public_since)
    .eq("status", row.status)
    .eq("attempts", row.attempts)
    .select("user_id")
  return !error && Array.isArray(data) && data.length > 0
}

/** Deliver the queued notices. Never throws. */
export async function sendOutputsPublicNotices(now: Date, log: (line: string) => void = (line) => console.error(line)): Promise<NoticeSendResult> {
  const result: NoticeSendResult = { sent: 0, unknown: 0, failed: 0, skipped: 0 }
  try {
    // Stale news is dropped whether or not this deployment sends: one update.
    const { error: expireError } = await supabase
      .from("outputs_public_notices")
      .update({ status: "skipped" })
      .in("status", ["pending", "failed"])
      .lt("created_at", new Date(now.getTime() - NOTICE_MAX_AGE_MS).toISOString())
    if (expireError) log(`[outputs-public-notice] expiring old notices failed: ${expireError.code ?? "error"}`)
    if (!hasCredits() || !config.LOOPS_OUTPUTS_PUBLIC_ID || !isLoopsConfigured()) return result
    if (isStandbySender()) return result
    const { data, error } = await supabase
      .from("outputs_public_notices")
      .select("user_id, public_since, status, attempts, created_at")
      .in("status", ["pending", "failed"])
      .lt("attempts", NOTICE_MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH)
    if (error) {
      log(`[outputs-public-notice] reading the queue failed: ${error.message}`)
      return result
    }
    for (const row of (data ?? []) as NoticeRow[]) {
      try {
        if (now.getTime() - new Date(row.created_at).getTime() > NOTICE_MAX_AGE_MS) {
          await settle(row, { status: "skipped" })
          result.skipped += 1
          continue
        }
        if (!(await claim(row))) {
          result.skipped += 1
          continue
        }
        const { data: person } = await supabase
          .from("profiles")
          .select("email, tier, subscription_tier, public_outputs, outputs_public_since")
          .eq("id", row.user_id)
          .maybeSingle()
        const p = person as {
          email?: string | null
          tier?: string | null
          subscription_tier?: string | null
          public_outputs?: boolean | null
          outputs_public_since?: string | null
        } | null
        // Still true: public, this very reset, and still on a plan without private outputs.
        const current =
          p?.email &&
          p.public_outputs !== false &&
          p.outputs_public_since &&
          new Date(p.outputs_public_since).getTime() === new Date(row.public_since).getTime() &&
          !planAllowsPrivateOutputs(resolveTierFrom(p))
        if (!current) {
          await settle(row, { status: "skipped" })
          result.skipped += 1
          continue
        }
        const outcome = await sendTransactional(config.LOOPS_OUTPUTS_PUBLIC_ID, p.email as string, noticeVariables(row.public_since))
        if (outcome.ok || outcome.failureKind === "timeout" || outcome.failureKind === "network") {
          await settle(row, { status: outcome.ok ? "sent" : "unknown", message_id: outcome.messageId ?? null, sent_at: new Date().toISOString() })
          if (outcome.ok) result.sent += 1
          else result.unknown += 1
        } else {
          const attempts = row.attempts + 1
          await settle(row, { status: attempts >= NOTICE_MAX_ATTEMPTS ? "given_up" : "failed", attempts })
          result.failed += 1
          // The status and kind only: a provider's body may echo the address.
          log(`[outputs-public-notice] ${row.user_id}: refused (${outcome.status ?? "no status"}, ${outcome.failureKind ?? "provider"}), attempt ${attempts}`)
        }
      } catch (err) {
        result.failed += 1
        log(`[outputs-public-notice] ${row.user_id}: ${(err as Error).name}`)
      }
    }
  } catch (err) {
    log(`[outputs-public-notice] tick failed: ${(err as Error).message}`)
  }
  return result
}
