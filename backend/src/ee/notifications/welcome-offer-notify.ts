import { supabase } from "../../lib/supabase.js"
import { readNotifyState, writeNotifyState } from "./notify-config.js"
import type { SlackMessage } from "./slack-client.js"
import { signupProduct } from "./signup-product.js"
import {
  WELCOME_POPUP_MAX_SHOWINGS,
  recordedShowings,
  type WelcomePopupShowingColumns,
} from "../billing/welcome-popup-rule.js"

/**
 * Founder notifications, stream D — the welcome offer and the mailing list.
 * Runs on the same tick as the other streams (`runFounderNotifyTick`), keeps
 * its own cursor (`notify_welcome_cursor`), and posts through the sender it is
 * handed so it never owns a webhook.
 *
 * Every event is a timestamp, posted once when it enters the window:
 *   accepted     — `user_consents.granted_at`   (the welcome claim, or "yes" from
 *                  Settings / the old prompt; every grant path writes it)
 *   maybe later  — `profiles.welcome_offer_declined_at` ("Maybe later" on the
 *                  welcome popup, or any close by a client released before
 *                  showings were counted: the server reads those as that answer)
 *   no answer    — `profiles.welcome_offer_last_shown_at` (the popup opened by
 *                  itself and was closed, or left, without an answer). One line
 *                  per showing, posted SHOWING_SETTLE_MS after it, so an answer
 *                  given while it is still up is reported as that answer instead
 *   declined     — `user_consents.declined_at`  ("No thanks" on the old prompt)
 *   unsubscribed — `user_consents.withdrawn_at` (Settings, or the daily Loops
 *                  pull that mirrors an email-link unsubscribe into this row)
 *
 * The popup's columns arrive with migration 653; before they exist those two
 * streams find nothing and the rest read as before. `welcome_offer_seen_at` is
 * when the popup was first shown, so an accept line can say how much later the
 * account came back. Internal accounts are excluded exactly as the other
 * streams do it.
 */

const CONSENT_KIND = "marketing_email"
const INTERNAL_EMAIL_LIKE = "%@nodaro.ai"
const INTERNAL_EMAIL_SUFFIX = "@nodaro.ai"
const CAME_BACK_MIN_MS = 10 * 60_000
/** A showing is reported as unanswered once this long has passed without an answer. */
export const SHOWING_SETTLE_MS = 10 * 60_000
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
// Read apart from PROFILE_COLS: these arrive with migration 653, and a query
// naming a column the database does not have fails as a whole.
const SHOWING_COLS = "welcome_offer_declined_at, welcome_offer_shown_count, welcome_offer_last_shown_at"

interface ShowingFields {
  welcome_offer_declined_at: string | null
  welcome_offer_shown_count: number | null
  welcome_offer_last_shown_at: string | null
}

type PopupRow = ProfileRow & ShowingFields

function showingsOf(r: ShowingFields): WelcomePopupShowingColumns {
  const count = r.welcome_offer_shown_count
  return {
    declinedAt: r.welcome_offer_declined_at ?? null,
    shownCount: typeof count === "number" && Number.isFinite(count) ? count : 0,
    lastShownAt: r.welcome_offer_last_shown_at ?? null,
  }
}
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

/** The popup's record per account; an account missing from the map (or every one, before 653) reads as before the count. */
async function showingsById(ids: string[]): Promise<Map<string, WelcomePopupShowingColumns>> {
  const out = new Map<string, WelcomePopupShowingColumns>()
  if (ids.length === 0) return out
  const { data, error } = await supabase.from("profiles").select(`id, ${SHOWING_COLS}`).in("id", ids)
  if (error) return out
  for (const r of (data ?? []) as Array<ShowingFields & { id: string }>) out.set(r.id, showingsOf(r))
  return out
}

/** Accounts whose popup stamp `column` falls in (lo, hi] (none before 653: the query fails). */
async function popupStampsIn(
  column: "welcome_offer_declined_at" | "welcome_offer_last_shown_at",
  lo: string,
  hi: string,
): Promise<PopupRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(`${PROFILE_COLS}, ${SHOWING_COLS}`)
    .gt(column, lo)
    .lte(column, hi)
    .eq("role", "user")
    .not("email", "ilike", INTERNAL_EMAIL_LIKE)
    .order(column, { ascending: true })
    .limit(WINDOW_ROW_LIMIT)
  if (error) return []
  return ((data ?? []) as PopupRow[]).filter((p) => inWindow(p[column], lo, hi))
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

function acceptedLine(p: ProfileRow, c: ConsentRow, product: string, showings: WelcomePopupShowingColumns | undefined): string {
  const email = p.email ?? p.id
  const app = c.source_app ?? product
  const parts = [`:white_check_mark: Welcome credits accepted — ${email} (${app})`]
  const granted = ms(c.granted_at)
  const created = ms(p.created_at)
  const answeredLater = ms(showings?.declinedAt)
  const firstShown = ms(p.welcome_offer_seen_at)
  if (granted !== null && created !== null) parts.push(`${humaniseDelta(granted - created)} after signup`)
  if (granted !== null && answeredLater !== null && granted - answeredLater >= CAME_BACK_MIN_MS) {
    parts.push(`answered "Maybe later" ${humaniseDelta(granted - answeredLater)} earlier, came back`)
  } else if (granted !== null && firstShown !== null && granted - firstShown >= CAME_BACK_MIN_MS) {
    parts.push(`popup first shown ${humaniseDelta(granted - firstShown)} earlier, came back`)
  }
  if (p.free_grant_state === "withheld") parts.push("credits WITHHELD (shared machine)")
  if (p.free_grant_state === "revoked") parts.push("credits TAKEN BACK by an admin")
  return parts.join(" · ")
}

function sinceSignup(p: ProfileRow, at: string | null): string | null {
  const t = ms(at)
  const created = ms(p.created_at)
  return t !== null && created !== null ? `${humaniseDelta(t - created)} after signup` : null
}

function laterLine(p: PopupRow, product: string): string {
  const parts = [`:no_entry_sign: Welcome popup answered "Maybe later" — ${p.email ?? p.id} (${product})`]
  const since = sinceSignup(p, p.welcome_offer_declined_at)
  if (since) parts.push(since)
  // The showings counted, read as they are: "later" also stamps seen_at (first
  // shown), so the rule's reading of a bare seen_at as one showing would
  // invent one for an answer given before the popup ever opened by itself.
  parts.push(`after ${showingsOf(p).shownCount} of ${WELCOME_POPUP_MAX_SHOWINGS} showings`)
  return parts.join(" · ")
}

function unansweredLine(p: PopupRow, product: string): string {
  const shown = recordedShowings({ seenAt: p.welcome_offer_seen_at, showings: showingsOf(p) }).count
  const parts = [
    `:hourglass_flowing_sand: Welcome popup shown, no answer — ${p.email ?? p.id} (${product})`,
    `showing ${shown} of ${WELCOME_POPUP_MAX_SHOWINGS}`,
  ]
  const since = sinceSignup(p, p.welcome_offer_last_shown_at)
  if (since) parts.push(since)
  if (shown >= WELCOME_POPUP_MAX_SHOWINGS) parts.push("it will not open by itself again")
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
      await postLaterAnswers(cursor, nowIso, post)
      await postUnansweredShowings(cursor, nowIso, post)
      await postOptOuts(cursor, nowIso, post)
    }
    await writeNotifyState("notify_welcome_cursor", nowIso)
  } catch {
    /* best-effort — a notification must never break the cron */
  }
}

async function postAccepts(cursor: string, nowIso: string, post: Post): Promise<void> {
  const rows = (await consentsWithStampIn("granted_at", cursor, nowIso)).filter((r) => r.status === "granted")
  const ids = rows.map((r) => r.user_id)
  const [profiles, showings] = await Promise.all([profilesById(ids), showingsById(ids)])
  for (const c of rows) {
    const p = profiles.get(c.user_id)
    if (!p || isInternal(p)) continue
    const product = await signupProduct(p.id)
    await post({ text: acceptedLine(p, c, product, showings.get(p.id)) })
  }
}

async function postLaterAnswers(cursor: string, nowIso: string, post: Post): Promise<void> {
  const rows = (await popupStampsIn("welcome_offer_declined_at", cursor, nowIso)).filter((p) => !isInternal(p))
  const consents = await consentStatusFor(rows.map((p) => p.id))
  for (const p of rows) {
    // Claimed later in the same window (banner, Settings): the accept line
    // already says "Maybe later … earlier"; do not also report the answer.
    if (consents.get(p.id)?.status === "granted") continue
    const product = await signupProduct(p.id)
    await post({ text: laterLine(p, product) })
  }
}

/**
 * Showings made SHOWING_SETTLE_MS before this tick's window: the same window,
 * shifted back, so every showing is looked at exactly once. One that has an
 * answer by then is left to that answer's line ("Maybe later", or accepted).
 */
async function postUnansweredShowings(cursor: string, nowIso: string, post: Post): Promise<void> {
  const lo = new Date(Date.parse(cursor) - SHOWING_SETTLE_MS).toISOString()
  const hi = new Date(Date.parse(nowIso) - SHOWING_SETTLE_MS).toISOString()
  const rows = (await popupStampsIn("welcome_offer_last_shown_at", lo, hi)).filter(
    (p) => !isInternal(p) && !p.welcome_offer_declined_at,
  )
  const consents = await consentStatusFor(rows.map((p) => p.id))
  for (const p of rows) {
    if (consents.get(p.id)?.status === "granted") continue
    const product = await signupProduct(p.id)
    await post({ text: unansweredLine(p, product) })
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

export type WelcomeLabel =
  | "accepted"
  | "accepted, withheld"
  | "accepted, taken back"
  | "maybe later"
  | `no answer, shown ${number} of ${number}`
  | "not shown"

/**
 * The digest's welcome column. Without the popup's record (`showings`
 * undefined: before migration 653, or a failed read) an account that was
 * shown it reads as one showing without an answer, as the server counts it.
 */
export function welcomeLabel(
  p: Pick<ProfileRow, "welcome_offer_seen_at" | "free_grant_state">,
  consent: ConsentRow | undefined,
  showings?: WelcomePopupShowingColumns,
): WelcomeLabel {
  if (consent?.status === "granted") {
    if (p.free_grant_state === "withheld") return "accepted, withheld"
    if (p.free_grant_state === "revoked") return "accepted, taken back"
    return "accepted"
  }
  if (showings?.declinedAt) return "maybe later"
  const shown = recordedShowings({ seenAt: p.welcome_offer_seen_at, showings: showings ?? null }).count
  if (shown > 0) return `no answer, shown ${shown} of ${WELCOME_POPUP_MAX_SHOWINGS}`
  return "not shown"
}

/** The welcome column for a list of signups (the digest). */
export async function welcomeLabelsFor(ids: string[]): Promise<Map<string, WelcomeLabel>> {
  const out = new Map<string, WelcomeLabel>()
  if (ids.length === 0) return out
  try {
    const [profiles, consents, showings] = await Promise.all([profilesById(ids), consentStatusFor(ids), showingsById(ids)])
    for (const id of ids) {
      const p = profiles.get(id)
      if (!p) continue
      out.set(id, welcomeLabel(p, consents.get(id), showings.get(id)))
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
