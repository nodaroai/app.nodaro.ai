import { estimateCombineVideosCredits } from "@nodaro/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

type Call = { tool: string; args: Record<string, unknown> }
const h = vi.hoisted(() => ({
  rows: {} as Record<string, number>,
  services: {} as Record<string, unknown>,
  priceFails: false,
}))
const priceOf = (c: Call): number =>
  c.tool === "generate_video" ? 100 * Number(c.args.duration)
  : c.tool === "generate_speech" ? 10
  : c.tool === "image_to_text" ? 3
  : c.tool === "generate_image" ? 45
  : Number.NaN

vi.mock("../ugc-quote.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ugc-quote.js")>()
  return {
    ...real,
    priceUgcCalls: vi.fn(async (_caller: unknown, calls: Call[]) => {
      if (h.priceFails) throw new real.UgcQuoteError("Clip 1")
      return calls.map(priceOf)
    }),
  }
})
vi.mock("../../billing/credits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../billing/credits.js")>()),
  getModelCreditCostFromDB: vi.fn(async (id: string) => {
    if (!(id in h.rows)) throw new Error(`no row for ${id}`)
    return { creditCost: h.rows[id]!, isEnabled: true, tierRestriction: null }
  }),
}))
vi.mock("../../../lib/private-plugins/load.js", () => ({ getPluginServices: () => h.services }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({})) }))
vi.mock("../../billing/service-margin.js", () => ({ applyServiceMarkup: (base: number) => base }))

import { ESTIMATE_CALLER, UgcQuoteError } from "../ugc-quote.js"
import { UgcEstimateUnavailable, estimateUgcRun, quoteUgcTickets } from "../ugc-estimate.js"

const ticket = (index: number, durationSec: number, speech = false) => ({
  v: 1, index, clipCount: 1, durationSec,
  video: { tool: "generate_video", args: { duration: durationSec } },
  speech: speech ? { tool: "generate_speech", args: { text: "t" } } : null,
})
const estimate = vi.fn((input: { targetDurationSec: number; source: "sampled" | "photo" }) => ({
  tickets: [ticket(0, input.targetDurationSec)],
  creatorImage: input.source === "sampled" ? { tool: "generate_image", args: { prompt: "p" } } : null,
  creatorChecks: [{ tool: "image_to_text", args: { custom_prompt: "q" } }],
}))
const FIXED = 30 + 22 + 20 + 50          // alignment + transcription + overlay + captions, with cards
const FIXED_NO_CARDS = 30 + 22 + 50

beforeEach(() => {
  vi.clearAllMocks()
  h.rows = { "ugc-script": 20, "elevenlabs-forced-alignment": 30, "elevenlabs-stt": 22, "video-overlay": 20, "add-captions:kinetic": 50 }
  h.services = { ugc: { estimate } }
  h.priceFails = false
})

describe("the dry-run estimate (spec §6.7)", () => {
  it("the estimate prices 0.8x, 1x and 1.2x the target and states range and worst case", async () => {
    const r = await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })
    // 1x: script 20 + image 45 + check 3 + clip (1500 + 3) + the fixed lines
    expect(r.expected).toBe(20 + 45 + 3 + 1503 + FIXED)
    expect(r.range).toEqual([20 + 45 + 3 + 1203 + FIXED, 20 + 45 + 3 + 1803 + FIXED])
    expect(r.worstCase).toBe(20 + 45 + 3 + FIXED + 2 * 1803)
    expect(estimate).toHaveBeenCalledTimes(3)
    expect(estimate.mock.calls.map((c) => c[0].targetDurationSec)).toEqual([12, 15, 18])
  })
  it("no screenshots → no overlay line; a photo source → the photo reading, no image", async () => {
    const r = await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 0, source: "photo" })
    expect(r.lines.map((l) => l.label)).not.toContain("Screenshot cards")
    expect(r.expected).toBe(20 + 3 + 1503 + FIXED_NO_CARDS)
    // 1–2 screenshots are dropped by the script, so they price like none
    const two = await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 2, source: "photo" })
    expect(two.expected).toBe(r.expected)
  })
  it("an absent plugin service → UgcEstimateUnavailable", async () => {
    h.services = {}
    await expect(estimateUgcRun(ESTIMATE_CALLER, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })).rejects.toBeInstanceOf(UgcEstimateUnavailable)
  })
  it("the ticket form: two tickets → a join line, each ticket's expected and its 2x ceiling", async () => {
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12, true), ticket(1, 10)], true)
    const join = estimateCombineVideosCredits({ transition: "cut" }, [12, 10])
    expect(r.lines.slice(0, 3)).toEqual([
      { label: "Clip 1 (12 s)", credits: 1200 + 10 + 3 },
      { label: "Clip 2 (10 s)", credits: 1000 + 3 },
      { label: "Join the clips", credits: join },
    ])
    expect(r.expected).toBe(1213 + 1003 + join + FIXED)
    expect(r.ceiling).toBe(2 * 1213 + 2 * 1003 + join + FIXED)
    const one = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12)], false)
    expect(one.lines.map((l) => l.label)).toEqual(["Clip 1 (12 s)", "Word timings", "Speech check", "Captions"])
  })
  it("an unpriceable ticket call → UgcQuoteError, never 0", async () => {
    h.priceFails = true
    await expect(quoteUgcTickets({ userId: "u1" }, [ticket(0, 12)], true)).rejects.toBeInstanceOf(UgcQuoteError)
    h.priceFails = false
    delete h.rows["ugc-script"]
    await expect(estimateUgcRun(ESTIMATE_CALLER, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })).rejects.toBeInstanceOf(UgcQuoteError)
  })
  it("a ticket from a newer wire version is refused", async () => {
    await expect(quoteUgcTickets({ userId: "u1" }, [{ ...ticket(0, 12), v: 2 }], true)).rejects.toBeInstanceOf(UgcQuoteError)
  })
})
