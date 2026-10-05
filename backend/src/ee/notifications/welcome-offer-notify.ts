import { supabase } from "../../lib/supabase.js"
import { readNotifyState, writeNotifyState } from "./notify-config.js"
import type { SlackMessage } from "./slack-client.js"
import { signupProduct } from "./signup-product.js"

/**
 * Founder notifications, stream D — the welcome offer and the mailing list.
 * Runs on the same tick as the other streams (`runFounderNotifyTick`), keeps
 * its own cursor (`notify_welcome_cursor`), and posts through the sender it is
 * handed so it never owns a webhook.
 *
 * Nothing here needs a new column. Every event is already a timestamp:
 *   accepted    — `user_consents.granted_at`   (the welcome claim, or "yes" from
 *                 Settings / the old prompt; every grant path writes it)
 *   dismissed   — `profiles.welcome_offer_seen_at` (stamped when the popup is
 *                 CLOSED — ×, "Maybe later", the scrim — never on show, and
 *                 never by a claim, so it is the dismiss moment exactly)
 *   declined    — `user_consents.declined_at`  ("No thanks" on the old prompt)
 *   unsubscribed — `user_consents.withdrawn_at` (Settings, or the daily Loops
 *                 pull that mirrors an email-link unsubscribe into this row)
 *
 * A dismiss followed by an accept from the banner leaves both stamps, so the
 * accept line can say how much later they came back. Internal accounts are
 * excluded exactly as the other streams do it.
 */

const CONSENT_KIND = "marketing_email"
const INTERNAL_EMAIL_LIKE = "%@nodaro.ai"
const INTERNAL_EMAIL_SUFFIX = "@nodaro.ai"
const CAME_BACK_MIN_MS = 10 * 60_000
const WINDOW_ROW_LIMIT = 500

type Post = (msg: SlackMessage) => Promise<boolean>

interface ConsentRow {
  user_id: string
  status: string
  granted_at: string | null
  declined_at: string | null
  withdrawn_at: string | null
  source_app: string | null
}

interface ProfileRow {
  id: string
  email: string | null
  role: string | null
  created_at: string | null
  welcome_offer_seen_at: string | null
  free_grant_state: string | null
}

const PROFILE_COLS = "id, email, role, created_at, welcome_offer_seen_at, free_grant_state"
const CONSENT_COLS = "user_id, status, granted_at, declined_at, withdrawn_at, source_app"

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** "2m", "3h", "2d 4h" — enough for a Slack line, never seconds. */
export function humaniseDelta(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  const restHours = hours - days * 24
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

function inWindow(iso: string | null | undefined, cursor: string, nowIso: string): boolean {
  const t = ms(iso)
  if (t === null) return false
  const lo = Date.parse(cursor)
  const hi = Date.parse(nowIso)
  return t > lo && t <= hi
}

function isInternal(p: ProfileRow): boolean {
  if ((p.role ?? "user") !== "user") return true
  return (p.email ?? "").toLowerCase().endsWith(INTERNAL_EMAIL_SUFFIX)
}

// ---------------------------------------------------------------------------
// Reads (PostgREST, two-step — no joins, no RPC)
// ---------------------------------------------------------------------------

async function consentsWithStampIn(
  column: "granted_at" | "declined_at" | "withdrawn_at",
  cursor: string,
  nowIso: string,
): Promise<ConsentRow[]> {
  const { data } = await supabase
    .from("user_consents")
    .select(CONSENT_COLS)
    .eq("kind", CONSENT_KIND)
    .gt(column, cursor)
    .lte(column, nowIso)
    .order(column, { ascending: true })
    .limit(WINDOW_ROW_LIMIT)
  // Re-check in JS: the stamp must sit in the window (a re-grant clears the
  // opt-out stamps, so a stale value can never slip through on a status change).
  return ((data ?? []) as ConsentRow[]).filter((r) => inWindow(r[column], cursor, nowIso))
}

async function profilesById(ids: string[]): Promise<Map<string, ProfileRow>> {
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from("profiles").select(PROFILE_COLS).in("id", ids)
  const out = new Map<string, ProfileRow>()
  for (const p of (data ?? []) as ProfileRow[]) out.set(p.id, p)
  return out
}

async function dismissalsIn(cursor: string, nowIso: string): Promise<ProfileRow[]> {
  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_COLS)
    .gt("welcome_offer_seen_at", cursor)
    .lte("welcome_offer_seen_at", nowIso)
    .eq("role", "user")
    .not("email", "ilike", INTERNAL_EMAIL_LIKE)
    .order("welcome_offer_seen_at", { ascending: true })
    .limit(WINDOW_ROW_LIMIT)
  return ((data ?? []) as ProfileRow[]).filter((p) => inWindow(p.welcome_offer_seen_at, cursor, nowIso))
}

async function consentStatusFor(ids: string[]): Promise<Map<string, ConsentRow>> {
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from("user_consents").select(CONSENT_COLS).eq("kind", CONSENT_KIND).in("user_id", ids)
  const out = new Map<string, ConsentRow>()
  for (const r of (data ?? []) as ConsentRow[]) out.set(r.user_id, r)
  return out
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

function acceptedLine(p: ProfileRow, c: ConsentRow, product: string): string {
  const email = p.email ?? p.id
  const app = c.source_app ?? product
  const parts = [`:white_check_mark: Welcome credits accepted — ${email} (${app})`]
  const granted = ms(c.granted_at)
  const created = ms(p.created_at)
  const seen = ms(p.welcome_offer_seen_at)
  if (granted !== null && created !== null) parts.push(`${humaniseDelta(granted - created)} after signup`)
  if (granted !== null && seen !== null && granted - seen >= CAME_BACK_MIN_MS) {
    parts.push(`dismissed ${humaniseDelta(granted - seen)} earlier, came back`)
  }
  if (p.free_grant_state === "withheld") parts.push("credits WITHHELD (shared machine)")
  if (p.free_grant_state === "revoked") parts.push("credits TAKEN BACK by an admin")
  return parts.join(" · ")
}

function dismissedLine(p: ProfileRow, product: string): string {
  const email = p.email ?? p.id
  const parts = [`:no_entry_sign: Welcome popup dismissed — ${email} (${product})`]
  const seen = ms(p.welcome_offer_seen_at)
  const created = ms(p.created_at)
  if (seen !== null && created !== null) parts.push(`${humaniseDelta(seen - created)} after signup`)
  return parts.join(" · ")
}

// ---------------------------------------------------------------------------
// The poll
// ---------------------------------------------------------------------------

/**
 * One tick of stream D. The cursor initialises to `now` (never a backfill
 * flood) and advances every tick even when the toggle is off, like the others.
 */
export async function pollWelcomeOffer(now: Date, enabled: boolean, post: Post): Promise<void> {
  try {
    const cursor = await readNotifyState("notify_welcome_cursor")
    const nowIso = now.toISOString()
    if (!cursor) {
      await writeNotifyState("notify_welcome_cursor", nowIso)
      return
    }
    if (enabled) {
      await postAccepts(cursor, nowIso, post)
      await postDismissals(cursor, nowIso, post)
      await postOptOuts(cursor, nowIso, post)
    }
    await writeNotifyState("notify_welcome_cursor", nowIso)
  } catch {
    /* best-effort — a notification must never break the cron */
  }
}

async function postAccepts(cursor: string, nowIso: string, post: Post): Promise<void> {
  const rows = (await consentsWithStampIn("granted_at", cursor, nowIso)).filter((r) => r.status === "granted")
  const profiles = await profilesById(rows.map((r) => r.user_id))
  for (const c of rows) {
    const p = profiles.get(c.user_id)
    if (!p || isInternal(p)) continue
    const product = await signupProduct(p.id)
    await post({ text: acceptedLine(p, c, product) })
  }
}

async function postDismissals(cursor: string, nowIso: string, post: Post): Promise<void> {
  const rows = (await dismissalsIn(cursor, nowIso)).filter((p) => !isInternal(p))
  const consents = await consentStatusFor(rows.map((p) => p.id))
  for (const p of rows) {
    // Claimed later in the same window (banner, Settings) — the accept line
    // already says "dismissed … earlier"; do not also report the dismiss.
    if (consents.get(p.id)?.status === "granted") continue
    const product = await signupProduct(p.id)
    await post({ text: dismissedLine(p, product) })
  }
}

async function postOptOuts(cursor: string, nowIso: string, post: Post): Promise<void> {
  const declined = (await consentsWithStampIn("declined_at", cursor, nowIso)).filter((r) => r.status === "declined")
  const withdrawn = (await consentsWithStampIn("withdrawn_at", cursor, nowIso)).filter((r) => r.status === "withdrawn")
  const profiles = await profilesById([...declined, ...withdrawn].map((r) => r.user_id))
  for (const c of declined) {
    const p = profiles.get(c.user_id)
    if (!p || isInternal(p)) continue
    await post({ text: `:no_entry_sign: Marketing emails declined — ${p.email ?? p.id}` })
  }
  // One wording for both origins: Settings writes the stamp directly; an
  // unsubscribe inside a Loops email is mirrored into the same row by the
  // daily pull (`loops-unsubscribe-pull.ts`), so it lands here the next tick.
  for (const c of withdrawn) {
    const p = profiles.get(c.user_id)
    if (!p || isInternal(p)) continue
    await post({ text: `:leftwards_arrow_with_hook: Unsubscribed from marketing emails — ${p.email ?? p.id}` })
  }
}

// ---------------------------------------------------------------------------
// Digest helpers — the per-signup column and the totals
// ---------------------------------------------------------------------------

export type WelcomeLabel = "accepted" | "accepted, withheld" | "accepted, taken back" | "dismissed" | "not shown"

export function welcomeLabel(p: Pick<ProfileRow, "welcome_offer_seen_at" | "free_grant_state">, consent: ConsentRow | undefined): WelcomeLabel {
  if (consent?.status === "granted") {
    if (p.free_grant_state === "withheld") return "accepted, withheld"
    if (p.free_grant_state === "revoked") return "accepted, taken back"
    return "accepted"
  }
  if (p.welcome_offer_seen_at) return "dismissed"
  return "not shown"
}

/** The welcome column for a list of signups (the digest). */
export async function welcomeLabelsFor(ids: string[]): Promise<Map<string, WelcomeLabel>> {
  const out = new Map<string, WelcomeLabel>()
  if (ids.length === 0) return out
  try {
    const [profiles, consents] = await Promise.all([profilesById(ids), consentStatusFor(ids)])
    for (const id of ids) {
      const p = profiles.get(id)
      if (!p) continue
      out.set(id, welcomeLabel(p, consents.get(id)))
    }
  } catch {
    /* best-effort — the digest renders without the column */
  }
  return out
}

/** How many accounts currently say yes to marketing email. "?" on error. */
export async function countSubscribed(): Promise<string> {
  try {
    const { count, error } = await supabase
      .from("user_consents")
      .select("user_id", { count: "exact", head: true })
      .eq("kind", CONSENT_KIND)
      .eq("status", "granted")
    return error || count == null ? "?" : String(count)
  } catch {
    return "?"
  }
}
