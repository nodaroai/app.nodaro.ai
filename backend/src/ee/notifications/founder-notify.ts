import { supabase } from "../../lib/supabase.js"
import { getNotifyConfig, readNotifyState, writeNotifyState } from "./notify-config.js"
import { sendSlack, type SlackMessage } from "./slack-client.js"
import { signupProduct, signupProductsFor } from "./signup-product.js"

/**
 * Internal founder notifications (Cloud-only). Three streams, all posting to one
 * admin-configured Slack webhook:
 *   A. Daily digest      — once/day at the configured Israel hour (poll below).
 *   B. Milestones        — paid convert / cancel via the Stripe handlers
 *                          (notify* exports); first generation via the poll.
 *   C. Every signup      — near-immediate (~poll interval), default OFF.
 *
 * Everything is dormant with no webhook set. Timezone is Asia/Jerusalem,
 * computed from the actual wall clock (DST-safe) — never a hand-rolled offset.
 * Internal accounts (role != 'user', @nodaro.ai) are excluded from the per-user
 * streams (C + the digest list) but stay in the totals.
 */

const IL_TZ = "Asia/Jerusalem"
const INTERNAL_EMAIL_LIKE = "%@nodaro.ai"
const PAID_TIERS = ["basic", "standard", "pro", "business", "enterprise"]

// ---------------------------------------------------------------------------
// Timezone (Asia/Jerusalem), DST-safe: derive everything from the wall clock.
// ---------------------------------------------------------------------------
export function israelParts(d: Date): { date: string; hour: number; secondsOfDay: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: IL_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value
  const hour = Number(p.hour) % 24 // en-CA can render midnight as "24"
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour,
    secondsOfDay: hour * 3600 + Number(p.minute) * 60 + Number(p.second),
  }
}

/** UTC instant of the most recent Israel midnight at/before d. */
export function startOfIsraelDayUtc(d: Date): Date {
  return new Date(d.getTime() - israelParts(d).secondsOfDay * 1000)
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
    const cfg = await getNotifyConfig()
    if (!cfg.milestonesEnabled || !cfg.slackWebhookUrl) return
    if ((priorTier ?? "free").toLowerCase() !== "free") return // already paid — not a conversion
    if (newTier.toLowerCase() === "free") return
    const email = (await userEmail(userId)) ?? userId
    await post({ text: `:tada: Paid conversion — ${email} → ${newTier}` })
  } catch {
    /* a notification must never break billing */
  }
}

export async function notifyCancellation(
  userId: string | null,
  priorTier: string | null,
  scheduled = false,
): Promise<void> {
  try {
    if (!userId) return
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
export async function runFounderNotifyTick(): Promise<void> {
  const cfg = await getNotifyConfig()
  if (!cfg.slackWebhookUrl) return // nothing configured — fully dormant
  const now = new Date()
  await pollEverySignup(now, cfg.everySignupEnabled)
  await pollFirstGenerations(now, cfg.milestonesEnabled)
  await maybeSendDigest(now, cfg.digestEnabled, cfg.digestHour)
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
    const [products, ranSet, totals] = await Promise.all([signupProductsFor(ids), usersWhoRan(ids), computeTotals()])
    const lines = rows.map(
      (r) => `• ${r.email} — ${products.get(r.id) ?? "unknown"} — ${ranSet.has(r.id) ? "ran ✓" : "no run"}`,
    )
    const blocks: unknown[] = [
      { type: "header", text: { type: "plain_text", text: `Yesterday: ${rows.length} signup${rows.length === 1 ? "" : "s"}` } },
      ...chunkForSlackSections(lines).map((text) => ({ type: "section", text: { type: "mrkdwn", text } })),
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Totals: *${totals.total}* users · *${totals.paid}* paid` }],
      },
    ]
    const ok = await post({ text: `Daily digest — ${rows.length} signup(s) yesterday`, blocks })
    if (ok) await writeNotifyState("notify_last_digest_date", today) // retry next tick if the send failed
  } catch {
    /* best-effort */
  }
}

// Slack caps a section's text at 3000 chars and a message at 50 blocks. On a
// high-signup day one joined list would blow the first cap (→ 400 → the digest
// retries every tick and never sends), so pack lines into multiple sections
// within budget and fold any overflow past the block cap into a "…and N more".
const SLACK_SECTION_MAX = 2900
const MAX_DIGEST_SECTIONS = 45

function chunkForSlackSections(lines: string[]): string[] {
  const chunks: string[] = []
  let cur: string[] = []
  let curLen = 0
  for (const line of lines) {
    const addLen = curLen === 0 ? line.length : curLen + 1 + line.length
    if (addLen > SLACK_SECTION_MAX && cur.length > 0) {
      chunks.push(cur.join("\n"))
      cur = []
      curLen = 0
    }
    cur.push(line)
    curLen = curLen === 0 ? line.length : curLen + 1 + line.length
  }
  if (cur.length > 0) chunks.push(cur.join("\n"))
  if (chunks.length > MAX_DIGEST_SECTIONS) {
    const kept = chunks.slice(0, MAX_DIGEST_SECTIONS - 1)
    const droppedLines = chunks.slice(MAX_DIGEST_SECTIONS - 1).reduce((n, c) => n + c.split("\n").length, 0)
    kept.push(`…and ${droppedLines} more`)
    return kept
  }
  return chunks
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
async function computeTotals(): Promise<{ total: string; paid: string }> {
  const countOf = async (build: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<string> => {
    try {
      const { count, error } = await build()
      return error || count == null ? "?" : String(count)
    } catch {
      return "?"
    }
  }
  const [total, paid] = await Promise.all([
    countOf(() => supabase.from("profiles").select("id", { count: "exact", head: true })),
    countOf(() => supabase.from("profiles").select("id", { count: "exact", head: true }).in("subscription_tier", PAID_TIERS)),
  ])
  return { total, paid }
}
