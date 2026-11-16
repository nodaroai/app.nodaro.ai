/**
 * When the welcome pop-up opens by itself (decided 2026-11-16).
 *
 * Only "Maybe later" answers it. A close without an answer (×, Escape, a click
 * outside) leaves the offer open, so the pop-up opens by itself again on a
 * later visit: at most once a day, and WELCOME_POPUP_MAX_SHOWINGS times in all.
 * The count lives on the account, so every product and every device shares it.
 *
 * Pure, and the only place the rule is written: the balance read
 * (`welcomeOffer.popupDue`) and the write behind
 * `POST /v1/credits/welcome-offer/seen` (`{ event: "shown" }`) both call it,
 * so the window a showing is counted in and the window the pop-up waits out
 * cannot drift apart.
 */

/** How many times, in all, the pop-up opens by itself for one account. */
export const WELCOME_POPUP_MAX_SHOWINGS = 3

/** The pop-up opens by itself at most once in this long. */
export const WELCOME_POPUP_INTERVAL_MS = 24 * 60 * 60 * 1000

/** The counting columns (migration 653). */
export interface WelcomePopupShowingColumns {
  /** "Maybe later" was answered. */
  declinedAt: string | null
  /** How many times the pop-up opened by itself. */
  shownCount: number
  /** When it last opened by itself. */
  lastShownAt: string | null
}

/** What an account has on record about the pop-up. */
export interface WelcomePopupRecord {
  /** First shown (before showings were counted: the moment it was closed, the only stamp there was). */
  seenAt: string | null
  /** Null while the database does not have the counting columns yet: only `seenAt` is known then. */
  showings: WelcomePopupShowingColumns | null
}

/** The showings the rule counts by. */
export interface WelcomePopupShowings {
  count: number
  lastShownAt: string | null
}

/**
 * The showings to count by. A close recorded before showings were counted
 * (`seenAt` set, nothing else) is ONE showing without an answer, made at
 * `seenAt`: migration 653's backfill writes the same into the columns, and
 * reading it this way also covers a row the backfill did not reach (a close
 * recorded after it ran by code that did not count yet).
 */
export function recordedShowings(record: WelcomePopupRecord): WelcomePopupShowings {
  const { seenAt, showings } = record
  const count = showings ? Math.max(0, showings.shownCount) : 0
  const lastShownAt = showings?.lastShownAt ?? null
  if (count === 0 && lastShownAt === null && seenAt !== null) return { count: 1, lastShownAt: seenAt }
  return { count, lastShownAt }
}

/**
 * Whether a showing at `now` counts: none recorded yet, or the last one more
 * than a day ago. The same test decides whether the pop-up is due again.
 */
export function showingCountsAt(lastShownAt: string | null, now: number): boolean {
  if (lastShownAt === null) return true
  const at = Date.parse(lastShownAt)
  if (!Number.isFinite(at)) return true
  return now - at > WELCOME_POPUP_INTERVAL_MS
}

export interface WelcomePopupFacts {
  /** The deployment has the welcome offer switched on. */
  offerOn: boolean
  /** `profiles.free_grant_state`; only an unclaimed grant has an offer to make. */
  grantState: string | null
  record: WelcomePopupRecord
}

/**
 * Whether the pop-up should open by itself now: the offer is on, the grant is
 * unclaimed, "Maybe later" was never answered, it has opened by itself fewer
 * than WELCOME_POPUP_MAX_SHOWINGS times, and not within the last day.
 *
 * Until the counting columns exist (`record.showings` null) the rule is the
 * one before them: shown once, never again.
 */
export function welcomePopupDue(facts: WelcomePopupFacts, now: number): boolean {
  if (!facts.offerOn || facts.grantState !== "unclaimed") return false
  const { record } = facts
  if (record.showings === null) return record.seenAt === null
  if (record.showings.declinedAt !== null) return false
  const shown = recordedShowings(record)
  return shown.count < WELCOME_POPUP_MAX_SHOWINGS && showingCountsAt(shown.lastShownAt, now)
}
