import { describe, expect, it } from "vitest"
import type { AdviceRecord, CardAction, CardOutcome } from "@nodaro/shared"
import { translate, type MessageKey } from "@/lib/i18n"
import { familyLabel, isPendingMark, isVerdict, outcomeText, recordDots, recordForCard, recordMovesCards, recordPill, unseenVerdicts } from "../card-outcome-text"

const t = (key: MessageKey, vars?: Record<string, string | number>) => translate("en", key, vars)
const he = (key: MessageKey, vars?: Record<string, string | number>) => translate("he", key, vars)

const record = (over: Partial<AdviceRecord>): AdviceRecord => ({ family: "sound", tried: 4, worked: 3, flat: 1, missed: 0, avgRatio: 2.1, shown: true, tier: "proven", ...over })

function mark(over: Partial<CardAction>): CardAction {
  return {
    id: "m1",
    cardId: "sound:c1:7",
    cardKind: "sound",
    card: { title: "t", why: "w", action: "a", evidence: [] },
    subjectId: "c1",
    postUrl: null,
    linkedAt: null,
    actedAt: "2026-10-01T00:00:00Z",
    verdict: null,
    seenAt: null,
    onWall: true,
    outcome: { state: "no_posts_yet" },
    ...over,
  }
}

describe("how a marked card went, in words", () => {
  it("says a verdict with its multiplier and the numbers behind it", () => {
    const worked: CardOutcome = { state: "worked", ratio: 2.1, reach: 8400, usual: 4000, unit: "views", platform: "tiktok" }
    expect(outcomeText(worked, t)).toMatchObject({ tone: "worked", headline: "Worked: 2.1x your usual", askLink: false })
    expect(outcomeText(worked, t).detail).toContain("TikTok")
    expect(outcomeText(worked, he).headline).toBe("עבד – פי 2.1 מהרגיל שלכם")
    expect(outcomeText({ state: "flat", ratio: 1.1 }, t).tone).toBe("neutral")
    expect(outcomeText({ state: "missed", ratio: 0.4 }, t).tone).toBe("muted")
  })

  it("asks for the post's link only when it would help", () => {
    expect(outcomeText({ state: "posts_since", ratio: 1.8 }, t).askLink).toBe(true)
    expect(outcomeText({ state: "no_posts_yet" }, t).askLink).toBe(true)
    expect(outcomeText({ state: "older_than_advice" }, t).askLink).toBe(true)
    expect(outcomeText({ state: "waiting" }, t).askLink).toBe(false)
    expect(outcomeText({ state: "no_brand" }, t).askLink).toBe(false)
    expect(outcomeText({ state: "no_baseline" }, t).headline).toContain("this platform")
  })

  it("tells a verdict from a state that is not one", () => {
    expect(isVerdict({ state: "worked" })).toBe(true)
    expect(isVerdict({ state: "posts_since" })).toBe(false)
  })
})

describe("the track record", () => {
  it("reads per family, and in Hebrew the way the brief asked", () => {
    expect(recordPill(record({}), t)).toBe("3 of 4 worked for you")
    expect(`${familyLabel("sound", he)}: ${recordPill(record({}), he)}`).toBe("המלצות על סאונד: עבדו לכם 3 מתוך 4")
    expect(recordDots(record({ worked: 2, flat: 1, missed: 1 }))).toEqual(["worked", "worked", "flat", "missed"])
  })

  it("goes on a card only when its family has enough to say", () => {
    const shown = record({})
    expect(recordForCard([shown], { kind: "market_sound", params: {} })).toBe(shown)
    expect(recordForCard([record({ shown: false })], { kind: "sound", params: {} })).toBeUndefined()
    expect(recordForCard([shown], { kind: "pace", params: {} })).toBeUndefined()
    // Complaints about your own brand are answered, not posted: no record on them.
    const complaints = record({ family: "complaints" })
    expect(recordForCard([complaints], { kind: "complaints", params: { own: true } })).toBeUndefined()
    expect(recordForCard([complaints], { kind: "complaints", params: { own: false } })).toBe(complaints)
    expect(recordMovesCards([record({ tier: "neutral" })])).toBe(false)
    expect(recordMovesCards([shown])).toBe(true)
    expect(recordMovesCards(undefined)).toBe(false)
  })
})

describe("results the person has not seen", () => {
  it("counts stored verdicts not yet seen, never a mark still on its way", () => {
    const verdict = { state: "worked" as const, ratio: 2, reach: 2, usual: 1, unit: "views" as const, platform: "tiktok", postId: "p", matchedBy: "link" as const, at: "2026-10-05T00:00:00Z" }
    const marks = [mark({ id: "a", verdict }), mark({ id: "b", verdict, seenAt: "2026-10-06T00:00:00Z" }), mark({ id: "c" }), mark({ id: "pending:x", verdict })]
    expect(unseenVerdicts(marks).map((m) => m.id)).toEqual(["a"])
    expect(isPendingMark({ id: "pending:x" })).toBe(true)
  })
})
