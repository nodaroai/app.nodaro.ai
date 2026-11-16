import { supabase } from "../../lib/supabase.js"
import { isMissingColumnError } from "../../lib/postgrest-errors.js"
import { recordedShowings, welcomePopupDue, type WelcomePopupRecord, type WelcomePopupShowingColumns } from "./welcome-popup-rule.js"

/**
 * The welcome pop-up's record on `profiles`, read and written by the server
 * alone (a browser session cannot write these columns: migration 598 leaves
 * it one granted column on `profiles`, and 653 adds none).
 *
 *   welcome_offer_seen_at        first shown (426)
 *   welcome_offer_shown_count    times it opened by itself (653)
 *   welcome_offer_last_shown_at  the last of them (653)
 *   welcome_offer_declined_at    "Maybe later" (653)
 *
 * The 653 columns reach the shared database only when `main` deploys, and
 * staging runs ahead of it. Until they exist every read and write here falls
 * back to the one stamp the pop-up had before them: `seen_at`, first stamp
 * wins, and a stamped pop-up never opens by itself again.
 */

const BASE_COLUMNS = "welcome_offer_seen_at, welcome_consent_pending, free_grant_state"
const SHOWING_COLUMNS = "welcome_offer_declined_at, welcome_offer_shown_count, welcome_offer_last_shown_at"

/** What the pop-up was told, as `POST /v1/credits/welcome-offer/seen` names it. */
export type WelcomePopupEvent = "shown" | "later"

export interface WelcomePopupRow {
  record: WelcomePopupRecord
  grantState: string | null
  consentPending: boolean
}

interface RawRow {
  welcome_offer_seen_at?: unknown
  welcome_consent_pending?: unknown
  free_grant_state?: unknown
  welcome_offer_declined_at?: unknown
  welcome_offer_shown_count?: unknown
  welcome_offer_last_shown_at?: unknown
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null)

function showingColumnsOf(row: RawRow): WelcomePopupShowingColumns {
  const count = row.welcome_offer_shown_count
  return {
    declinedAt: text(row.welcome_offer_declined_at),
    shownCount: typeof count === "number" && Number.isFinite(count) ? count : 0,
    lastShownAt: text(row.welcome_offer_last_shown_at),
  }
}

function readProfile(userId: string, columns: string) {
  return supabase.from("profiles").select(columns).eq("id", userId).single()
}

/**
 * The account's pop-up record, its grant state and its consent mark. `null`
 * when the row cannot be read. A database without the counting columns yet
 * answers `record.showings: null` (and the consent mark still reads: the
 * creation block of an account that owes its consent depends on it).
 */
export async function readWelcomePopupRow(userId: string): Promise<WelcomePopupRow | null> {
  let counted = true
  let { data, error } = await readProfile(userId, `${BASE_COLUMNS}, ${SHOWING_COLUMNS}`)
  if (error && isMissingColumnError(error)) {
    counted = false
    ;({ data, error } = await readProfile(userId, BASE_COLUMNS))
  }
  if (error || !data) return null
  const row = data as RawRow
  return {
    record: { seenAt: text(row.welcome_offer_seen_at), showings: counted ? showingColumnsOf(row) : null },
    grantState: text(row.free_grant_state),
    consentPending: row.welcome_consent_pending === true,
  }
}

/** The stamp the pop-up had before showings were counted: first one wins. */
async function stampSeen(userId: string, nowIso: string): Promise<string | null> {
  const { error } = await supabase
    .from("profiles")
    .update({ welcome_offer_seen_at: nowIso })
    .eq("id", userId)
    .is("welcome_offer_seen_at", null)
  return error ? error.message : null
}

export interface ShownOutcome {
  error: string | null
  /** This call counted a showing (false within the day, after a lost race, or before the columns exist). */
  counted: boolean
}

/**
 * `{ event: "shown" }`: the pop-up opened by itself. Counts one showing only
 * while the pop-up is due by the same rule the balance answers with
 * (`welcomePopupDue`: grant unclaimed, no "Maybe later", fewer than three
 * showings, none within the last day). A client that posts twice, a pop-up
 * that opens in two tabs, or a post when it was not due counts nothing, so
 * the count never passes the maximum and the account's three are not spent
 * by a client's mistake. Read with the offer on: the route answers 409 first
 * while it is off.
 *
 * Atomic without a database function: the update names the values it read
 * (a compare-and-set), so of two concurrent calls one counts and the other
 * matches no row, which leaves the count right either way.
 */
export async function recordWelcomePopupShown(userId: string, now: number = Date.now()): Promise<ShownOutcome> {
  const nowIso = new Date(now).toISOString()
  const { data, error } = await supabase
    .from("profiles")
    .select(`welcome_offer_seen_at, free_grant_state, ${SHOWING_COLUMNS}`)
    .eq("id", userId)
    .maybeSingle()
  if (error && isMissingColumnError(error)) return { error: await stampSeen(userId, nowIso), counted: false }
  if (error) return { error: error.message, counted: false }
  if (!data) return { error: null, counted: false }

  const row = data as RawRow
  const seenAt = text(row.welcome_offer_seen_at)
  const read = showingColumnsOf(row)
  const record: WelcomePopupRecord = { seenAt, showings: read }
  if (!welcomePopupDue({ offerOn: true, grantState: text(row.free_grant_state), record }, now)) {
    return { error: null, counted: false }
  }
  const shown = recordedShowings(record)

  let write = supabase
    .from("profiles")
    .update({
      welcome_offer_shown_count: shown.count + 1,
      welcome_offer_last_shown_at: nowIso,
      ...(seenAt === null ? { welcome_offer_seen_at: nowIso } : {}),
    })
    .eq("id", userId)
    .eq("welcome_offer_shown_count", read.shownCount)
  write = read.lastShownAt === null ? write.is("welcome_offer_last_shown_at", null) : write.eq("welcome_offer_last_shown_at", read.lastShownAt)
  if (seenAt === null) write = write.is("welcome_offer_seen_at", null)
  const { data: moved, error: writeError } = await write.select("id")
  if (writeError) return { error: writeError.message, counted: false }
  return { error: null, counted: Array.isArray(moved) && moved.length > 0 }
}

/**
 * `{ event: "later" }` ("Maybe later"), and what a body without a known event
 * means: the account answered, and the pop-up does not open by itself again.
 * Both stamps are first-one-wins. Before the counting columns exist this is
 * the one `seen_at` stamp, exactly as it was.
 */
export async function recordWelcomePopupLater(userId: string, now: number = Date.now()): Promise<{ error: string | null }> {
  const nowIso = new Date(now).toISOString()
  const { error } = await supabase
    .from("profiles")
    .update({ welcome_offer_declined_at: nowIso })
    .eq("id", userId)
    .is("welcome_offer_declined_at", null)
  if (error && !isMissingColumnError(error)) return { error: error.message }
  return { error: await stampSeen(userId, nowIso) }
}
