import { describe, it, expect } from "vitest"
import {
  WELCOME_POPUP_INTERVAL_MS,
  WELCOME_POPUP_MAX_SHOWINGS,
  recordedShowings,
  showingCountsAt,
  welcomePopupDue,
  type WelcomePopupFacts,
  type WelcomePopupShowingColumns,
} from "../welcome-popup-rule.js"

/**
 * The welcome pop-up's rule (decided 2026-11-16): only "Maybe later" answers
 * it; a close without an answer lets it open by itself again, at most once a
 * day and three times in all; a close under the old rule counts as one
 * showing; and until the counting columns exist, the old rule (once, never
 * again) holds.
 */

const NOW = Date.parse("2026-11-16T12:00:00.000Z")
const HOUR = 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const columns = (over: Partial<WelcomePopupShowingColumns> = {}): WelcomePopupShowingColumns => ({
  declinedAt: null,
  shownCount: 0,
  lastShownAt: null,
  ...over,
})

const facts = (over: Partial<WelcomePopupFacts> = {}): WelcomePopupFacts => ({
  offerOn: true,
  grantState: "unclaimed",
  record: { seenAt: null, showings: columns() },
  ...over,
})

describe("the constants", () => {
  it("three showings, a day apart", () => {
    expect(WELCOME_POPUP_MAX_SHOWINGS).toBe(3)
    expect(WELCOME_POPUP_INTERVAL_MS).toBe(24 * HOUR)
  })
})

describe("showingCountsAt", () => {
  it("counts the first showing", () => {
    expect(showingCountsAt(null, NOW)).toBe(true)
  })

  it("refuses a second showing within the day, at its very edge too", () => {
    expect(showingCountsAt(ago(1000), NOW)).toBe(false)
    expect(showingCountsAt(ago(23 * HOUR), NOW)).toBe(false)
    expect(showingCountsAt(ago(24 * HOUR), NOW)).toBe(false)
  })

  it("counts one more than a day after the last", () => {
    expect(showingCountsAt(ago(24 * HOUR + 1), NOW)).toBe(true)
    expect(showingCountsAt(ago(72 * HOUR), NOW)).toBe(true)
  })
})

describe("recordedShowings", () => {
  it("reads the columns as they are", () => {
    expect(recordedShowings({ seenAt: ago(50 * HOUR), showings: columns({ shownCount: 2, lastShownAt: ago(25 * HOUR) }) })).toEqual({
      count: 2,
      lastShownAt: ago(25 * HOUR),
    })
  })

  it("a close under the old rule (seen, nothing counted) is one showing, made when it was closed", () => {
    expect(recordedShowings({ seenAt: ago(5 * HOUR), showings: columns() })).toEqual({ count: 1, lastShownAt: ago(5 * HOUR) })
    expect(recordedShowings({ seenAt: ago(5 * HOUR), showings: null })).toEqual({ count: 1, lastShownAt: ago(5 * HOUR) })
  })

  it("never shown: none", () => {
    expect(recordedShowings({ seenAt: null, showings: columns() })).toEqual({ count: 0, lastShownAt: null })
    expect(recordedShowings({ seenAt: null, showings: null })).toEqual({ count: 0, lastShownAt: null })
  })
})

describe("welcomePopupDue", () => {
  it("a new account: due", () => {
    expect(welcomePopupDue(facts(), NOW)).toBe(true)
  })

  it("never with the offer off, or with a grant that is not unclaimed", () => {
    expect(welcomePopupDue(facts({ offerOn: false }), NOW)).toBe(false)
    for (const grantState of ["granted", "withheld", "revoked", null]) {
      expect(welcomePopupDue(facts({ grantState }), NOW)).toBe(false)
    }
  })

  it("closed without an answer: not again the same day, again the next", () => {
    const shownToday = facts({ record: { seenAt: ago(2 * HOUR), showings: columns({ shownCount: 1, lastShownAt: ago(2 * HOUR) }) } })
    expect(welcomePopupDue(shownToday, NOW)).toBe(false)
    const shownYesterday = facts({ record: { seenAt: ago(25 * HOUR), showings: columns({ shownCount: 1, lastShownAt: ago(25 * HOUR) }) } })
    expect(welcomePopupDue(shownYesterday, NOW)).toBe(true)
  })

  it("three showings in all, however long ago the last one was", () => {
    const twice = facts({ record: { seenAt: ago(80 * HOUR), showings: columns({ shownCount: 2, lastShownAt: ago(30 * HOUR) }) } })
    expect(welcomePopupDue(twice, NOW)).toBe(true)
    const thrice = facts({ record: { seenAt: ago(80 * HOUR), showings: columns({ shownCount: 3, lastShownAt: ago(300 * HOUR) }) } })
    expect(welcomePopupDue(thrice, NOW)).toBe(false)
  })

  it('"Maybe later" stops it at once, with showings left', () => {
    const declined = facts({ record: { seenAt: ago(2 * HOUR), showings: columns({ declinedAt: ago(2 * HOUR), shownCount: 1, lastShownAt: ago(30 * HOUR) }) } })
    expect(welcomePopupDue(declined, NOW)).toBe(false)
  })

  it("an account that closed it under the old rule has two showings left, a day after that close", () => {
    const closedLongAgo = facts({ record: { seenAt: ago(40 * HOUR), showings: columns() } })
    expect(welcomePopupDue(closedLongAgo, NOW)).toBe(true)
    const closedAnHourAgo = facts({ record: { seenAt: ago(HOUR), showings: columns() } })
    expect(welcomePopupDue(closedAnHourAgo, NOW)).toBe(false)
    // After the backfill the same account reads the same.
    const backfilled = facts({ record: { seenAt: ago(40 * HOUR), showings: columns({ shownCount: 1, lastShownAt: ago(40 * HOUR) }) } })
    expect(welcomePopupDue(backfilled, NOW)).toBe(true)
  })

  it("before the counting columns exist: the old rule, once and never again", () => {
    expect(welcomePopupDue(facts({ record: { seenAt: null, showings: null } }), NOW)).toBe(true)
    expect(welcomePopupDue(facts({ record: { seenAt: ago(100 * HOUR), showings: null } }), NOW)).toBe(false)
    expect(welcomePopupDue(facts({ grantState: "granted", record: { seenAt: null, showings: null } }), NOW)).toBe(false)
  })
})
