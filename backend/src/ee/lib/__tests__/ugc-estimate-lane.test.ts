/**
 * The estimate of a UGC video whose clips are cut from one recorded speech, priced as the canvas runs
 * it: the script's language reaches the plugin's estimate, the speech-first steps and the finish are
 * priced once, and the clips as canvas tickets beside the join and the cards' tail. English is
 * untouched. Every price and id here is a placeholder.
 */
import { ugcChainInput, ugcChains } from "@nodaro/render-rules"
import { beforeEach, describe, expect, it, vi } from "vitest"

type Call = { tool: string; args: Record<string, unknown> }
const h = vi.hoisted(() => ({ services: {} as Record<string, unknown> }))
/** Placeholder call prices: a clip's render, its reading, the three speech-first steps, the finish, the creator image. */
const PRICE: Record<string, number> = { generate_speech: 30, forced_alignment: 30, ugc_split_speech: 10, ugc_finish_clips: 30, image_to_text: 5, generate_image: 40 }
const priceOf = (c: Call): number => (c.tool === "generate_video" ? 400 : PRICE[c.tool] ?? Number.NaN)
/** Placeholder rows for the steps the estimate reads off its own rows (by what each id names). */
const rowOf = (id: string): number | undefined =>
  id === "ugc-script" ? 20
  : id.endsWith("forced-alignment") ? 30
  : id === DEFAULT_TRANSCRIBE_NODE_PROVIDER ? 20
  : id === "video-overlay" ? 20
  : id.startsWith("add-captions") ? 50
  : undefined
vi.mock("../ugc-quote.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ugc-quote.js")>()
  return { ...real, priceUgcCalls: vi.fn(async (_caller: unknown, calls: Call[]) => calls.map(priceOf)) }
})
vi.mock("../../billing/credits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../billing/credits.js")>()),
  getModelCreditCostFromDB: vi.fn(async (id: string) => {
    const credits = rowOf(id)
    if (credits === undefined) throw new Error(`no row for ${id}`)
    return { creditCost: credits, isEnabled: true, tierRestriction: null }
  }),
}))
vi.mock("../../../lib/private-plugins/load.js", () => ({ getPluginServices: () => h.services }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({})) }))
vi.mock("../../billing/service-margin.js", () => ({ applyServiceMarkup: (base: number) => base }))

import { DEFAULT_TRANSCRIBE_NODE_PROVIDER, estimateCombineVideosCredits } from "@nodaro/shared"
import { estimateUgcRun } from "../ugc-estimate.js"

const laneTicket = (index: number) => ({ v: 1, index, durationSec: 7, video: { tool: "generate_video", args: { model: "lane-model", duration: 7 } }, speech: null })
const LANE = {
  prelude: [{ tool: "generate_speech", args: { text: "t" } }, { tool: "forced_alignment", args: { transcript: "t" } }, { tool: "ugc_split_speech", args: { plan: {} } }],
  finish: { tool: "ugc_finish_clips", args: {} },
  ceilingTickets: [0, 1, 2, 3, 4].map(laneTicket),
  estimateClipCount: 3,
  clipCount: 5,
}
const estimate = vi.fn((input: { language?: string; targetDurationSec: number }) => ({
  tickets: input.language === "he" ? [0, 1, 2].map(laneTicket) : [{ v: 1, index: 0, clipCount: 1, durationSec: 15, video: { tool: "generate_video", args: { duration: 15 } }, speech: null }],
  creatorImage: { tool: "generate_image", args: { prompt: "p" } },
  creatorChecks: [{ tool: "image_to_text", args: { custom_prompt: "q" } }],
  ...(input.language === "he" ? { lane: LANE } : {}),
}))

beforeEach(() => {
  vi.clearAllMocks()
  h.services = { ugc: { estimate, clipHoldFactor: () => 2 } }
})

/**
 * The worked example, with these placeholder prices, for a Hebrew script with three screenshots whose speech
 * is expected to need 3 clips (the most the rules plan for: 5):
 * - the script 20, the creator image 40 and its check 5 (65);
 * - the speech-first steps: speech 30 + word timings 30 + split 10 (70); the finish, once, 30;
 * - each clip: a render 400 + its reading 5 = 405, held at twice that (810) while it renders;
 * - the tail: the join (combine-videos' own amount at its fallback clip length: 60 for three clips, 110 for five), word timings 30,
 *   speech check 20, screenshot cards 20, captions 50.
 * Expected (3 clips): 65 + 70 + 30 + 3 × 405 + 60 + 120 = 1,560.
 * Held (3 clips): 65 + 70 + 30 + 3 × 810 + 180 = 2,775.
 * The most clips (5): expected 2,420; every clip held (the worst case) 4,445.
 */
describe("the estimate of a video cut from one recorded speech, as the canvas runs it", () => {
  const HE = { targetDurationSec: 30, screenshotCount: 3, source: "sampled" as const, language: "he" }
  it("passes the script's language to the plugin, once: no 0.8x / 1.2x runs (the speech decides the clips)", async () => {
    await estimateUgcRun({ userId: "u1" }, HE)
    expect(estimate).toHaveBeenCalledTimes(1)
    expect(estimate.mock.calls[0]![0]).toMatchObject({ language: "he", targetDurationSec: 30 })
  })
  it("the worked example: expected 1,560, held 2,775, range to 2,420, worst case 4,445", async () => {
    const r = await estimateUgcRun({ userId: "u1" }, HE)
    const join = (n: number) => estimateCombineVideosCredits({ transition: "cut", trimStartFrames: 1, trimEndFrames: 2 }, Array.from({ length: n }, () => undefined))
    expect(join(3)).toBe(60)
    expect(join(5)).toBe(110)
    expect({ expected: r.expected, ceiling: r.ceiling, range: r.range, worstCase: r.worstCase }).toEqual({ expected: 1560, ceiling: 2775, range: [1560, 2420], worstCase: 4445 })
  })
  it("names each line by its id, in run order: the script and creator, the speech-first steps, the clips, the finish, the join and the tail", async () => {
    const r = await estimateUgcRun({ userId: "u1" }, HE)
    expect(r.lines.map((l) => [l.key, l.credits])).toEqual([
      ["script", 20], ["creatorImage", 40], ["creatorCheck", 5],
      ["speech", 30], ["alignment", 30], ["split", 10],
      ["clip", 405], ["clip", 405], ["clip", 405],
      ["finish", 30],
      ["join", 60], ["alignment", 30], ["speechCheck", 20], ["cards", 20], ["captions", 50],
    ])
    expect(r.lines.find((l) => l.key === "speech")!.label).toBe("Speech")
    expect(r.lines.find((l) => l.key === "split")!.label).toBe("Split the speech")
    expect(r.lines.find((l) => l.key === "finish")!.label).toBe("Finish the clips")
  })
  it("the parts add up to the expected figure; the holds to the worst case", async () => {
    const r = await estimateUgcRun({ userId: "u1" }, HE)
    expect(Object.values(r.parts).reduce((a, b) => a + b, 0)).toBe(r.expected)
    expect(Object.values(r.holdParts).reduce((a, b) => a + b, 0)).toBe(r.worstCase)
  })
  it("English: the estimate it always was — no language sent, the three runs", async () => {
    await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })
    expect(estimate).toHaveBeenCalledTimes(3)
    for (const [input] of estimate.mock.calls) expect(input).not.toHaveProperty("language")
  })
})

describe("the script's language, read off the graph", () => {
  const languageOf = (data: Record<string, unknown>, overrides?: Record<string, Record<string, unknown>>) => {
    const nodes = [{ id: "s", type: "ugc-script", data }]
    return ugcChainInput(ugcChains(nodes, [])[0]!, nodes, [], overrides ? { overrides } : {}).input.language
  }
  it("the node's choice; English (or none) is no key at all", () => {
    expect(languageOf({ language: "he" })).toBe("he")
    expect(languageOf({ language: "en" })).toBeUndefined()
    expect(languageOf({})).toBeUndefined()
    expect(languageOf({ language: "xx" })).toBeUndefined()
  })
  it("an app run's override wins over the node's", () => {
    expect(languageOf({ language: "en" }, { s: { language: "he" } })).toBe("he")
  })
  it("a kept script hands on its saved plan: the plan's own language wins", () => {
    const kept = { keepResult: true, language: "en", result: { plan: { language: "he", hook: "h", beats: [] }, productCategory: "saas", warnings: [], notes: [], rounds: 1 } }
    expect(languageOf(kept)).toBe("he")
  })
})
