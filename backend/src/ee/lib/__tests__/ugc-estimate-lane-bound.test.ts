/**
 * Three price findings from Hebrew test runs, priced through the REAL pricer
 * (`priceUgcCalls`: each call's credit id, read from a price table). Every price here is a
 * placeholder:
 *
 * 1. The pre-run estimate's worst case covers the worst legal split. The plugin answers the
 *    worst splits a take can get (`lane.worstTicketSets`); the estimate holds the dearest. With
 *    these prices a 15 s, three-screenshot, photo Hebrew video's worst case was 3,004
 *    (three 7 s clips) and is now 4,733 (six clips, 7 / 7 / 7 / 5 / 4 / 4).
 * 2. The canvas ticket quote includes UGC Finish's job when the clips go through it.
 * 3. The quote's join holds what the join commits: the template's join settings, each clip at its
 *    ticket's length — a run charges each finished clip its real length, at most its ticket's
 *    (decided 2026-10-13) — so two 7 s clips' join is 33 (it was 44 while every clip was charged
 *    the 8 s fallback).
 *
 * The placeholder table: a 5 s clip 319 + its reading 4 = 323, a 7 s clip 440 + 4 = 444; the
 * finish 33; word timings 33; speech check 25; cards 22; captions 55; the script 22; the photo
 * check 4; speech 36; split 11; the join through a placeholder rule over its computed amount.
 */
import { DEFAULT_TRANSCRIBE_NODE_PROVIDER, estimateCombineVideosCredits } from "@nodaro/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ services: {} as Record<string, unknown>, read: [] as string[] }))
/** A placeholder price for each credit id the run reserves. */
const PRICES: Record<string, number> = {
  "minimax-h3:4s:768p": 253, "minimax-h3:5s:768p": 319, "minimax-h3:6s:768p": 374, "minimax-h3:7s:768p": 440,
  "ugc-finish": 33, "elevenlabs-forced-alignment": 33, [DEFAULT_TRANSCRIBE_NODE_PROVIDER]: 25, "video-overlay": 22,
  "add-captions:kinetic": 55, "ugc-script": 22, "ugc-segments": 11, "speech-model": 36,
}
/** The reading of a clip and the photo check: whatever id the LLM tier resolves to, 4. */
const READING_PRICE = 4
vi.mock("../../billing/credits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../billing/credits.js")>()),
  // The join's one-unit row (its units are priced at it, `unitRateBaseCredits`): the code's own row, no database.
  getModelCreditBaseCost: vi.fn(async (id: string) => {
    if (id !== "combine-videos") throw new Error(`no base row for ${id}`)
    return { creditCost: 10, isEnabled: true, tierRestriction: null }
  }),
  getModelCreditCostFromDB: vi.fn(async (id: string) => {
    h.read.push(id)
    const credits = PRICES[id] ?? (id.includes("image-to-text") ? READING_PRICE : undefined)
    if (credits === undefined) throw new Error(`no row for ${id}`)
    return { creditCost: credits, isEnabled: true, tierRestriction: null }
  }),
}))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  speechLengthPricingEnabled: () => false,
}))
vi.mock("../../../lib/private-plugins/load.js", () => ({ getPluginServices: () => h.services }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({})) }))
// The join's computed amount, through a placeholder rule (a 19 s join: 50 → 55).
vi.mock("../../billing/service-margin.js", () => ({ applyServiceMarkup: (base: number) => Math.ceil((base * 11) / 10) }))

const { estimateUgcRun, quoteUgcTickets, ugcRenderHold } = await import("../ugc-estimate.js")
const { ESTIMATE_CALLER, UgcQuoteError } = await import("../ugc-quote.js")

/** A lane ticket as the plugin builds it: the clip model at 768P, 9:16, its segment's audio as the reference. */
const ticket = (durationSec: number, index: number, clipCount: number) => ({
  v: 1, index, clipCount, lane: "segmented-reference", language: "he", durationSec, speech: null, videoFallback: null,
  video: {
    tool: "generate_video",
    args: {
      prompt: "p", model: "minimax-h3", aspect_ratio: "9:16", duration: durationSec, resolution: "768P",
      reference_image_urls: ["https://cdn.example/c.png"], reference_audio_urls: [`https://cdn.example/seg${index + 1}.mp3`],
    },
  },
})
const tickets = (secs: readonly number[]) => secs.map((s, i) => ticket(s, i, secs.length))
const PROBE = [5, 7, 7]
const clipPrice = (s: number) => PRICES[`minimax-h3:${s}s:768p`]! + READING_PRICE
/** The join the quote holds: the template's join settings, each clip at its ticket's length (what a finished clip runs at most; a run charges each its real length). */
const joinPrice = (secs: readonly number[]) =>
  secs.length > 1 ? Math.ceil((estimateCombineVideosCredits({ transition: "cut", trimStartFrames: 1, trimEndFrames: 2 }, secs) * 11) / 10) : 0
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

/** The plugin's worst-split frontier for 21 s of speech (`worstSplitFrontier()`, plugins `lane/worst-split.ts`). */
const FRONTIER = [
  [7, 7, 7, 5, 4, 4], [7, 7, 6, 6, 4, 4], [7, 6, 5, 5, 5, 4], [6, 5, 5, 5, 5, 5],
  [7, 7, 7, 6, 4], [7, 7, 5, 5, 5], [7, 6, 6, 5, 5], [6, 6, 6, 6, 5],
  [7, 7, 7, 7],
]
const LANE = {
  prelude: [
    { tool: "generate_speech", args: { text: "t", model: "speech-model", language_code: "he" } },
    { tool: "forced_alignment", args: { transcript: "t" } },
    { tool: "ugc_split_speech", args: { plan: {} } },
  ],
  finish: { tool: "ugc_finish_clips", args: {} },
  ceilingTickets: tickets([7, 7, 7]),
  worstTicketSets: FRONTIER.map(tickets),
  estimateClipCount: 2,
  clipCount: 3,
}
const estimate = vi.fn(() => ({
  tickets: tickets([6, 6]),
  creatorImage: null,
  creatorChecks: [{ tool: "image_to_text", args: { custom_prompt: "q" } }],
  creatorCandidates: [],
  lane: LANE,
}))
const HE = { targetDurationSec: 15, screenshotCount: 3, source: "photo" as const, language: "he" }

beforeEach(() => {
  vi.clearAllMocks()
  h.read = []
  h.services = { ugc: { estimate, clipHoldFactor: () => 2 } }
})

describe("the canvas ticket quote includes UGC Finish's job", () => {
  it("a run of two 7 s clips: the finish (33) and the join (33, at the clips' 7 s) are lines of it — 1,089 expected", async () => {
    const q = await quoteUgcTickets(ESTIMATE_CALLER, tickets([7, 7]), true, true)
    expect(q.lines.map((l) => [l.key, l.credits])).toEqual([
      ["clip", 444], ["clip", 444], ["finish", 33],
      ["join", 33], ["alignment", 33], ["speechCheck", 25], ["cards", 22], ["captions", 55],
    ])
    expect(q.lines.find((l) => l.key === "finish")!.label).toBe("Finish the clips")
    expect({ expected: q.expected, ceiling: q.ceiling }).toEqual({ expected: 1089, ceiling: 1977 })
  })
  it("clips 5 / 7 / 7: 1,434 expected and 2,645 held — 33 over the quote without the finish", async () => {
    const q = await quoteUgcTickets(ESTIMATE_CALLER, tickets(PROBE), true, true)
    expect({ expected: q.expected, ceiling: q.ceiling }).toEqual({ expected: 1434, ceiling: 2645 })
    const without = await quoteUgcTickets(ESTIMATE_CALLER, tickets(PROBE), true)
    expect({ expected: without.expected, ceiling: without.ceiling }).toEqual({ expected: 1401, ceiling: 2612 })
  })
  it("equals the sum the run commits: each clip's render and reading, the finish job's row (ugc-finish), the join, and the cards' four rows", async () => {
    const q = await quoteUgcTickets(ESTIMATE_CALLER, tickets(PROBE), true, true)
    const committed =
      sum(PROBE.map(clipPrice)) + // UGC Clip ×3: the render and its reading
      PRICES["ugc-finish"]! + // UGC Finish: one job, reserved under the plugin's FINISH_JOB id
      joinPrice(PROBE) + // Combine Videos: its computed amount
      PRICES["elevenlabs-forced-alignment"]! + PRICES[DEFAULT_TRANSCRIBE_NODE_PROVIDER]! + PRICES["video-overlay"]! + PRICES["add-captions:kinetic"]! // UGC Cards
    expect(q.expected).toBe(committed)
    expect(h.read).toContain("ugc-finish")
    // The finish is charged once: never held at the clip hold factor.
    expect(q.ceiling - q.expected).toBe(sum(PROBE.map(clipPrice)))
    expect(Object.values(q.parts).reduce((a, b) => a + b, 0)).toBe(q.expected)
    expect(Object.values(q.holdParts).reduce((a, b) => a + b, 0)).toBe(q.ceiling)
  })
  it("English (no finish job): no finish line, the quote as it was", async () => {
    const q = await quoteUgcTickets(ESTIMATE_CALLER, tickets(PROBE), true, false)
    expect(q.lines.some((l) => l.key === "finish")).toBe(false)
    expect(h.read).not.toContain("ugc-finish")
  })
})

describe("the pre-run estimate's worst case covers the worst legal split", () => {
  /** What the run holds besides the clips and the tail: script 22, photo check 4, speech 36, timings 33, split 11, finish 33. */
  const FIXED = 22 + 4 + 36 + 33 + 11 + 33
  /** What a run whose clips split as `secs` holds while they render: every clip at twice its price, the rest once. */
  const heldRun = (secs: readonly number[]) => FIXED + 2 * sum(secs.map(clipPrice)) + joinPrice(secs) + 33 + 25 + 22 + 55

  it("15 s, three screenshots, a photo: expected and range as before; the worst case 3,004 → 4,733 (six clips, 7 / 7 / 7 / 5 / 4 / 4)", async () => {
    const r = await estimateUgcRun(ESTIMATE_CALLER, HE)
    expect(r.expected).toBe(FIXED + sum([6, 6].map(clipPrice)) + joinPrice([6, 6]) + 135)
    expect(r.range).toEqual([r.expected, FIXED + sum([7, 7, 7].map(clipPrice)) + joinPrice([7, 7, 7]) + 135])
    expect(heldRun([7, 7, 7])).toBe(3004)
    expect(r.worstCase).toBe(heldRun([7, 7, 7, 5, 4, 4]))
    expect(r.worstCase).toBe(4733)
    expect(Object.values(r.holdParts).reduce((a, b) => a + b, 0)).toBe(r.worstCase)
  })
  it("the test run's take (5 / 7 / 7, 2,751 held) and a 4-clip take (7 / 7 / 7 / 6) are under it; the old worst case (3,004) did not cover the second", async () => {
    const r = await estimateUgcRun(ESTIMATE_CALLER, HE)
    expect(heldRun(PROBE)).toBe(2751)
    expect(heldRun(PROBE)).toBeLessThanOrEqual(r.worstCase)
    expect(heldRun([7, 7, 7, 6])).toBeGreaterThan(3004)
    expect(heldRun([7, 7, 7, 6])).toBeLessThanOrEqual(r.worstCase)
  })
  it("invariant: every split the frontier covers (any 1-6 clips of 4-7 s with no more clips and none longer than an entry) holds at most the worst case", async () => {
    const r = await estimateUgcRun(ESTIMATE_CALLER, HE)
    const covered = (secs: number[]) => {
      const s = [...secs].sort((a, b) => b - a)
      return FRONTIER.some((f) => f.length >= s.length && s.every((x, i) => f[i]! >= x))
    }
    let checked = 0
    const walk = (secs: number[]) => {
      if (secs.length > 0 && covered(secs)) {
        checked++
        expect(heldRun(secs), secs.join("/")).toBeLessThanOrEqual(r.worstCase)
      }
      if (secs.length === 6) return
      for (let s = secs.length ? secs[secs.length - 1]! : 7; s >= 4; s--) walk([...secs, s])
    }
    walk([])
    expect(checked).toBeGreaterThan(100)
  })
  it("the speech cap by target (1.2 × the target, at most 21 s): 15 s → 4,065 (an 18 s take: 7 / 7 / 7 / 4 / 4); 20 s and 25 s → 4,733 (21 s)", async () => {
    // The plugin's frontier for an 18 s cap (`worstSplitFrontier(maxSpeechSecFor(15))`); 20 s and 25 s reach the 21 s one.
    const FRONTIER_18 = [[7, 7, 7, 4, 4], [7, 7, 5, 5, 4], [7, 6, 6, 5, 4], [6, 5, 5, 5, 5], [7, 7, 6, 5], [7, 6, 6, 6]]
    const worstAt = async (targetDurationSec: number, frontier: number[][]) => {
      estimate.mockReturnValueOnce({ ...estimate(), lane: { ...LANE, worstTicketSets: frontier.map(tickets) } } as never)
      return (await estimateUgcRun(ESTIMATE_CALLER, { ...HE, targetDurationSec })).worstCase
    }
    const figures = { 15: await worstAt(15, FRONTIER_18), 20: await worstAt(20, FRONTIER), 25: await worstAt(25, FRONTIER) }
    expect(figures).toEqual({ 15: heldRun([7, 7, 7, 4, 4]), 20: heldRun([7, 7, 7, 5, 4, 4]), 25: heldRun([7, 7, 7, 5, 4, 4]) })
    expect(figures).toEqual({ 15: 4065, 20: 4733, 25: 4733 })
    // Every legal split of a 15 s video's take (all covered by the 18 s frontier) holds at most its worst case.
    for (const f of FRONTIER_18) expect(heldRun(f)).toBeLessThanOrEqual(figures[15])
  })
  it("a plugin that predates the worst splits: the worst case holds the range's clips, as before", async () => {
    const { worstTicketSets: _w, ...older } = LANE
    estimate.mockReturnValueOnce({ ...estimate(), lane: older } as never)
    const r = await estimateUgcRun(ESTIMATE_CALLER, HE)
    expect(r.worstCase).toBe(3004)
  })
  it("a malformed worst-split list is a quote error, never a silent fallback", async () => {
    estimate.mockReturnValueOnce({ ...estimate(), lane: { ...LANE, worstTicketSets: [[]] } } as never)
    await expect(estimateUgcRun(ESTIMATE_CALLER, HE)).rejects.toBeInstanceOf(UgcQuoteError)
  })
})

describe("the hold check once the speech is split: the clips' quote against the clip-onward part of the worst case", () => {
  /** What the run has spent before the clips: the script, the photo check and the prelude (speech, word timings, split). */
  const BEFORE_CLIPS = 22 + 4 + 36 + 33 + 11

  it("the bound is what the pre-run worst case holds for the clips and the steps after them (4,733 − 106 = 4,627)", async () => {
    const r = await estimateUgcRun(ESTIMATE_CALLER, HE)
    const bound = await ugcRenderHold(ESTIMATE_CALLER, HE, true, true)
    expect(bound).toBe(r.worstCase - BEFORE_CLIPS)
    expect(bound).toBe(4627)
  })
  it("every take the worst splits cover passes, priced exactly as the check prices the clips a run hands on", async () => {
    const bound = await ugcRenderHold(ESTIMATE_CALLER, HE, true, true)
    for (const take of [PROBE, [7, 7, 7, 6], [6, 6], ...FRONTIER]) {
      expect((await quoteUgcTickets(ESTIMATE_CALLER, tickets(take), true, true)).ceiling, take.join("/")).toBeLessThanOrEqual(bound)
    }
    // A take no legal split gives (five 7 s clips: 35 s of speech) is over it: the check stops it.
    expect((await quoteUgcTickets(ESTIMATE_CALLER, tickets([7, 7, 7, 7, 7]), true, true)).ceiling).toBeGreaterThan(bound)
  })
  it("compares like with like: without screenshot cards, both sides drop the cards line", async () => {
    const withCards = await ugcRenderHold(ESTIMATE_CALLER, HE, true, true)
    const without = await ugcRenderHold(ESTIMATE_CALLER, HE, false, true)
    expect(withCards - without).toBe(PRICES["video-overlay"])
  })
  it("a plugin that predates the worst splits: the bound is the range's clips, so a four-clip take is stopped", async () => {
    const { worstTicketSets: _w, ...older } = LANE
    estimate.mockReturnValueOnce({ ...estimate(), lane: older } as never)
    const bound = await ugcRenderHold(ESTIMATE_CALLER, HE, true, true)
    expect(bound).toBe(3004 - BEFORE_CLIPS)
    expect((await quoteUgcTickets(ESTIMATE_CALLER, tickets([7, 7, 7, 6]), true, true)).ceiling).toBeGreaterThan(bound)
  })
})
