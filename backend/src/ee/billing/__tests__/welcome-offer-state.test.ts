import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * `readWelcomeOfferState` — what the balance's `welcomeOffer` and the consent
 * block read. Pinned:
 *  - `popupDue` is the rule's answer; `popupSeen` is `!popupDue` for clients
 *    released before it.
 *  - Before migration 653's columns exist, `popupSeen` is the old stamp exactly
 *    and `popupDue` the old rule (shown once), and the consent mark still reads.
 *  - A failed read is null, a throw is null.
 */

const { mockReadRow } = vi.hoisted(() => ({ mockReadRow: vi.fn() }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock("@/ee/billing/welcome-popup.js", () => ({ readWelcomePopupRow: mockReadRow }))

import { readWelcomeOfferState } from "../signup-grant.js"

const USER = "00000000-0000-4000-8000-000000000001"
const NOW = Date.parse("2026-11-16T12:00:00.000Z")
const HOUR = 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const showings = (over: Record<string, unknown> = {}) => ({ declinedAt: null, shownCount: 0, lastShownAt: null, ...over })

beforeEach(() => {
  mockReadRow.mockReset()
})

describe("readWelcomeOfferState", () => {
  it("never shown, unclaimed: due, and so not seen", async () => {
    mockReadRow.mockResolvedValue({ record: { seenAt: null, showings: showings() }, grantState: "unclaimed", consentPending: false })
    expect(await readWelcomeOfferState(USER, NOW)).toEqual({ popupDue: true, popupSeen: false, consentPending: false })
  })

  it("shown an hour ago without an answer: not due today, seen for older clients", async () => {
    mockReadRow.mockResolvedValue({
      record: { seenAt: ago(HOUR), showings: showings({ shownCount: 1, lastShownAt: ago(HOUR) }) },
      grantState: "unclaimed",
      consentPending: false,
    })
    expect(await readWelcomeOfferState(USER, NOW)).toEqual({ popupDue: false, popupSeen: true, consentPending: false })
  })

  it("shown yesterday without an answer: due again, and so not seen (an older client opens it too)", async () => {
    mockReadRow.mockResolvedValue({
      record: { seenAt: ago(30 * HOUR), showings: showings({ shownCount: 1, lastShownAt: ago(30 * HOUR) }) },
      grantState: "unclaimed",
      consentPending: false,
    })
    expect(await readWelcomeOfferState(USER, NOW)).toEqual({ popupDue: true, popupSeen: false, consentPending: false })
  })

  it('"Maybe later": not due', async () => {
    mockReadRow.mockResolvedValue({
      record: { seenAt: ago(30 * HOUR), showings: showings({ declinedAt: ago(30 * HOUR), shownCount: 1, lastShownAt: ago(30 * HOUR) }) },
      grantState: "unclaimed",
      consentPending: false,
    })
    expect(await readWelcomeOfferState(USER, NOW)).toMatchObject({ popupDue: false, popupSeen: true })
  })

  it("a granted account owing its consent: not due, the mark reads", async () => {
    mockReadRow.mockResolvedValue({ record: { seenAt: null, showings: showings() }, grantState: "granted", consentPending: true })
    expect(await readWelcomeOfferState(USER, NOW)).toEqual({ popupDue: false, popupSeen: true, consentPending: true })
  })

  describe("before the counting columns exist (dev ahead of migration 653)", () => {
    it("popupSeen is the old stamp, and popupDue the old rule", async () => {
      mockReadRow.mockResolvedValue({ record: { seenAt: ago(50 * HOUR), showings: null }, grantState: "unclaimed", consentPending: false })
      expect(await readWelcomeOfferState(USER, NOW)).toEqual({ popupDue: false, popupSeen: true, consentPending: false })
      mockReadRow.mockResolvedValue({ record: { seenAt: null, showings: null }, grantState: "unclaimed", consentPending: false })
      expect(await readWelcomeOfferState(USER, NOW)).toEqual({ popupDue: true, popupSeen: false, consentPending: false })
    })

    it("a granted account never stamped reads popupSeen false, as it always did", async () => {
      mockReadRow.mockResolvedValue({ record: { seenAt: null, showings: null }, grantState: "granted", consentPending: true })
      expect(await readWelcomeOfferState(USER, NOW)).toEqual({ popupDue: false, popupSeen: false, consentPending: true })
    })
  })

  it("an unreadable row is null, and so is a throw", async () => {
    mockReadRow.mockResolvedValue(null)
    expect(await readWelcomeOfferState(USER, NOW)).toBeNull()
    mockReadRow.mockRejectedValue(new Error("boom"))
    expect(await readWelcomeOfferState(USER, NOW)).toBeNull()
  })
})
