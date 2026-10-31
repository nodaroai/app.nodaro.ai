import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { getNotifyConfig, readNotifyState, writeNotifyState } from "./notify-config.js"
import { sendSlack, type SlackMessage } from "./slack-client.js"
import { signupProduct, signupProductsFor } from "./signup-product.js"
import { israelParts, startOfIsraelDayUtc } from "./israel-time.js"
import { pollWelcomeOffer, welcomeLabelsFor, countSubscribed } from "./welcome-offer-notify.js"
import { pullLoopsUnsubscribes } from "./loops-unsubscribe-pull.js"
import { maybeSendCreditsDigest } from "./credits-digest.js"
import { sectionBlocks } from "./slack-blocks.js"

export { israelParts, startOfIsraelDayUtc }

/**
 * Internal founder notifications (Cloud-only). Five streams, all posting to one
 * admin-configured Slack webhook:
 *   A. Daily digest      — once/day at the configured Israel hour (poll below).
 *   B. Milestones        — paid convert / cancel via the Stripe handlers
 *                          (notify* exports); first generation via the poll.
 *   C. Every signup      — near-immediate (~poll interval), default OFF.
 *   D. Welcome offer     — accepted / dismissed / unsubscribed, default OFF
 *                          (welcome-offer-notify.ts), plus the daily Loops
 *                          unsubscribe pull (loops-unsubscribe-pull.ts).
 *   E. Credits digest    — once/day, same hour as A: yesterday's committed
 *                          credits per user with what they cost us in USD,
 *                          plus the KIE.ai balance movement (credits-digest.ts).
 *
 * Everything is dormant with no webhook set. Timezone is Asia/Jerusalem,
 * computed from the actual wall clock (DST-safe) — never a hand-rolled offset
 * (israel-time.ts). Internal accounts (role != 'user', @nodaro.ai) are excluded
 * from the per-user streams (C, D + the digest list) but stay in the totals.
 */

const INTERNAL_EMAIL_LIKE = "%@nodaro.ai"
const PAID_TIERS = ["basic", "standard", "pro", "business", "enterprise"]

// ---------------------------------------------------------------------------
// Single-sender guard. Staging and production run the SAME image against the
// SAME Supabase project, so both would otherwise run this cron — double-sending
// every alert AND racing the shared cursors (whichever advances a cursor first
// makes the other miss those rows). Exactly one environment may send. We put the
// known staging mirror on standby by its public host; production and any
// self-host (a different host, or none) send normally. Override the host list
// via NOTIFY_STANDBY_HOSTS (comma-separated) if the staging host ever changes.
// ---------------------------------------------------------------------------
export function isStandbySender(): boolean {
  const raw = config.PUBLIC_URL?.trim()
  if (!raw) return false // self-host / local single instance — always the sender
  let host: string
  try {
    host = new URL(raw).host.toLowerCase()
  } catch {
    return false // unparseable PUBLIC_URL — fail open (send) rather than mute silently
  }
  const standby = (process.env.NOTIFY_STANDBY_HOSTS ?? "next.nodaro.ai")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return standby.includes(host)
}

async function post(msg: SlackMessage): Promise<boolean> {
  const cfg = await getNotifyConfig()
  if (!cfg.slackWebhookUrl) return false
  return (await sendSlack(cfg.slackWebhookUrl, msg)).ok
}

async function userEmail(userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle()
  return (data as { email?: string } | null)?.email ?? null
}

// ---------------------------------------------------------------------------
// B (part). Milestone hooks — called from the Stripe handlers. Keyed on the
// STATE TRANSITION (prior tier), not the Stripe event name, so a free->paid
// that arrives via subscription.updated still fires and a Created+Updated pair
// for the same subscription does not double-fire. Never throws (best-effort).
// ---------------------------------------------------------------------------
export async function notifyPaidConversion(userId: string, priorTier: string | null, newTier: string): Promise<void> {
  try {
    if (isStandbySender()) return
    const cfg = await getNotifyConfig()
    if (!cfg.milestonesEnabled || !cfg.slackWebhookUrl) return
    if ((priorTier ?? "free").toLowerCase() !== "free") return // already paid — not a conversion
    if (newTier.toLowerCase() === "free") return
    const email = (await userEmail(userId)) ?? userId
    const text = `:tada: Paid conversion — ${email} → ${newTier}`
    await post({ text, blocks: paidConversionBlocks(text) })
  } catch {
    /* a notification must never break billing */
  }
}

/** The celebration banner served from the app's own public files, so a paid
 *  conversion stands out in a busy channel. `text` stays the phone preview. */
export const PAID_CONVERSION_IMAGE_PATH = "/notifications/paid-conversion.jpg"

export function paidConversionBlocks(text: string): unknown[] {
  const origin = (config.PUBLIC_URL ?? "").trim().replace(/\/$/, "")
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "image",
      image_url: `${origin || "https://app.nodaro.ai"}${PAID_CONVERSION_IMAGE_PATH}`,
      alt_text: "New paying customer",
    },
  ]
}

export async function notifyCancellation(
  userId: string | null,
  priorTier: string | null,
  scheduled = false,
): Promise<void> {
  try {
    if (!userId) return
    if (isStandbySender()) return
    const cfg = await getNotifyConfig()
    if (!cfg.milestonesEnabled || !cfg.slackWebhookUrl) return
    if ((priorTier ?? "free").toLowerCase() === "free") return // free-tier ghost cancel — skip
    const email = (await userEmail(userId)) ?? userId
    const text = scheduled
      ? `:warning: Scheduled to cancel — ${email} (${priorTier}, active until period end)`
      : `:warning: Cancellation — ${email} (was ${priorTier})`
    await post({ text })
  } catch {
    /* never break billing */
  }
}

// ---------------------------------------------------------------------------
// The cron tick — runs on the cleanup cron. All three poll paths capture ONE
// `now` at the start and advance cursors to it, so a row written mid-run can't
// slip between "not in the result yet" and "cursor already past it".
// ---------------------------------------------------------------------------
// node-cron does not serialize async callbacks: a tick that outlives the
// 5-minute interval (a long digest walk, a slow Slack POST) would overlap the
// next one, which then passes the same read-then-write date gates and sends
// the digests twice. One sender per process is already guaranteed by
// isStandbySender(), so an in-process latch is the whole fix — with an age
// limit: supabase-js calls carry no timeout, and a tick parked forever on one
// must not mute every stream until the next deploy. A legitimate walk never
// approaches the limit; a rare double digest beats permanent silence.
let tickStartedAt: number | null = null
export const TICK_LATCH_MAX_MS = 15 * 60_000

export async function runFounderNotifyTick(now: Date = new Date()): Promise<void> {
  if (tickStartedAt !== null && now.getTime() - tickStartedAt < TICK_LATCH_MAX_MS) return
  if (isStandbySender()) return // staging shares prod's DB — prod is the sole sender/cursor-owner
  tickStartedAt = now.getTime()
  try {
    const cfg = await getNotifyConfig()
    if (!cfg.slackWebhookUrl) return // nothing configured — fully dormant
    await pollEverySignup(now, cfg.everySignupEnabled)
    await pollFirstGenerations(now, cfg.milestonesEnabled)
    await pollWelcomeOffer(now, cfg.welcomeOfferEnabled, post)
    // The pull runs BEFORE the digest on purpose: an email-link unsubscribe found
    // today is out of the "subscribed to email" total the same morning.
    await pullLoopsUnsubscribes(now, cfg.welcomeOfferEnabled, cfg.digestHour)
    await maybeSendDigest(now, cfg.digestEnabled, cfg.digestHour)
    await maybeSendCreditsDigest(now, cfg.creditsDigestEnabled, cfg.digestHour, post)
  } finally {
    tickStartedAt = null
  }
}

// C. Every signup. Cursor advances every tick regardless of `enabled`, so
// enabling it later never backfills a flood; a null cursor initialises to now.
async function pollEverySignup(now: Date, enabled: boolean): Promise<void> {
  try {
    const cursor = await readNotifyState("notify_signup_cursor")
    const nowIso = now.toISOString()
    if (!cursor) {
      await writeNotifyState("notify_signup_cursor", nowIso)
      return
    }
    const { data } = await supabase
      .from("profiles")
      .select("id, email")
      .gt("created_at", cursor)
      .lte("created_at", nowIso)
      .eq("role", "user")
      .not("email", "ilike", INTERNAL_EMAIL_LIKE)
      .order("created_at", { ascending: true })
    if (enabled) {
      for (const r of ((data ?? []) as Array<{ id: string; email: string }>)) {
        const product = await signupProduct(r.id)
        await post({ text: `New signup: ${r.email} (${product})` })
      }
    }
    await writeNotifyState("notify_signup_cursor", nowIso)
  } catch {
    /* best-effort */
  }
}

// B (part). First generation — a user whose earliest completed job lands in the
// window. Keyed on completed_at (the completion event), non-null filtered.
async function pollFirstGenerations(now: Date, enabled: boolean): Promise<void> {
  try {
    const cursor = await readNotifyState("notify_firstgen_cursor")
    const nowIso = now.toISOString()
    if (!cursor) {
      await writeNotifyState("notify_firstgen_cursor", nowIso)
      return
    }
    if (enabled) {
      const { data: recent } = await supabase
        .from("jobs")
        .select("user_id")
        .eq("status", "completed")
        .not("completed_at", "is", null)
        .gt("completed_at", cursor)
        .lte("completed_at", nowIso)
      const candidates = Array.from(new Set(((recent ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)))
      for (const userId of candidates) {
        const { data: prior } = await supabase
          .from("jobs")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "completed")
          .not("completed_at", "is", null)
          .lte("completed_at", cursor)
          .limit(1)
        if (prior && prior.length > 0) continue // had an earlier completion — not their first
        const email = (await userEmail(userId)) ?? userId
        const product = await signupProduct(userId)
        await post({ text: `:sparkles: First generation — ${email} (${product})` })
      }
    }
    await writeNotifyState("notify_firstgen_cursor", nowIso)
  } catch {
    /* best-effort */
  }
}

// A. Daily digest. Sends at the first tick where the Israel hour == digestHour
// and it hasn't sent for that Israel date. No catch-up: a missed hour is simply
// skipped until the next day. Skips the SEND on zero signups, but still marks
// the day handled so it doesn't re-query every tick.
async function maybeSendDigest(now: Date, enabled: boolean, digestHour: number): Promise<void> {
  if (!enabled) return
  try {
    const { date: today, hour } = israelParts(now)
    if (hour !== digestHour) return
    if ((await readNotifyState("notify_last_digest_date")) === today) return

    const todayStart = startOfIsraelDayUtc(now)
    const yesterdayStart = startOfIsraelDayUtc(new Date(todayStart.getTime() - 60_000))

    const { data: signups } = await supabase
      .from("profiles")
      .select("id, email")
      .gte("created_at", yesterdayStart.toISOString())
      .lt("created_at", todayStart.toISOString())
      .eq("role", "user")
      .not("email", "ilike", INTERNAL_EMAIL_LIKE)
      .order("created_at", { ascending: true })
    const rows = ((signups ?? []) as Array<{ id: string; email: string }>)

    if (rows.length === 0) {
      await writeNotifyState("notify_last_digest_date", today) // handled; nothing to send
      return
    }

    const ids = rows.map((r) => r.id)
    const [products, ranSet, totals, welcome] = await Promise.all([
      signupProductsFor(ids),
      usersWhoRan(ids),
      computeTotals(),
      welcomeLabelsFor(ids),
    ])
    const lines = rows.map(
      (r) =>
        `• ${r.email} — ${products.get(r.id) ?? "unknown"} — ${ranSet.has(r.id) ? "ran ✓" : "no run"} — welcome: ${welcome.get(r.id) ?? "?"}`,
    )
    const blocks: unknown[] = [
      { type: "header", text: { type: "plain_text", text: `Yesterday: ${rows.length} signup${rows.length === 1 ? "" : "s"}` } },
      ...sectionBlocks(lines),
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Totals: *${totals.total}* users · *${totals.paid}* paid · *${totals.subscribed}* subscribed to email`,
          },
        ],
      },
    ]
    const ok = await post({ text: `Daily digest — ${rows.length} signup(s) yesterday`, blocks })
    if (ok) await writeNotifyState("notify_last_digest_date", today) // retry next tick if the send failed
  } catch {
    /* best-effort */
  }
}

async function usersWhoRan(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const { data } = await supabase.from("jobs").select("user_id").in("user_id", userIds).eq("status", "completed")
  return new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))
}

/** Totals for the digest footer. Each count is independent + best-effort; a
 *  failed count renders as "?" rather than dropping the whole digest.
 *
 *  Deliberately does NOT report "active in 30d": that needs auth.users
 *  (last_sign_in_at, unreachable through PostgREST's public-only schema) or a
 *  COUNT(DISTINCT user_id) over jobs (which PostgREST can't express) — either
 *  would want an RPC, and this feature ships without a migration on purpose. */
async function computeTotals(): Promise<{ total: string; paid: string; subscribed: string }> {
  const countOf = async (build: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<string> => {
    try {
      const { count, error } = await build()
      return error || count == null ? "?" : String(count)
    } catch {
      return "?"
    }
  }
  const [total, paid, subscribed] = await Promise.all([
    countOf(() => supabase.from("profiles").select("id", { count: "exact", head: true })),
    countOf(() => supabase.from("profiles").select("id", { count: "exact", head: true }).in("subscription_tier", PAID_TIERS)),
    countSubscribed(),
  ])
  return { total, paid, subscribed }
}
