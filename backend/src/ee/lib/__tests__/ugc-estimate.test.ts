import { UGC_SCRIPT_DEFAULT_TARGET_SEC } from "@nodaro/shared/ugc"
import { estimateCombineVideosCredits } from "@nodaro/shared/credits"
import { UGC_ESTIMATE_PARTS, UGC_QUOTE_LINE_KEYS, ugcChainInput, ugcChains } from "@nodaro/render-rules"
import { beforeEach, describe, expect, it, vi } from "vitest"

type Call = { tool: string; args: Record<string, unknown> }
const h = vi.hoisted(() => ({
  rows: {} as Record<string, number>,
  services: {} as Record<string, unknown>,
  priceFails: false,
  /** While set, every price read waits for it (a cold cache's round trip); `begun` counts the reads under way. */
  gate: null as Promise<void> | null,
  begun: 0,
}))
/** Two image models priced apart, so a line can be told from another; any other image is 45. */
const IMAGE_PRICES: Record<string, number> = { "m-1": 15, "m-2": 18 }
const priceOf = (c: Call): number =>
  c.tool === "generate_video" ? 100 * Number(c.args.duration)
  : c.tool === "generate_speech" ? 10
  : c.tool === "image_to_text" ? 3
  : c.tool === "generate_image" ? IMAGE_PRICES[String(c.args.model)] ?? 45
  : Number.NaN

vi.mock("../ugc-quote.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ugc-quote.js")>()
  const { priceUgcCallLinesVia } = await import("./helpers/ugc-price-lines.js")
  const priceUgcCalls = vi.fn(async (_caller: unknown, calls: Call[]) => {
    h.begun += 1
    if (h.gate) await h.gate
    if (h.priceFails) throw new real.UgcQuoteError("Clip 1")
    return calls.map(priceOf)
  })
  return { ...real, priceUgcCalls, priceUgcCallLines: priceUgcCallLinesVia(priceUgcCalls) }
})
vi.mock("../../billing/credits.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../billing/credits.js")>()
  return {
    ...real,
    // The join's one-unit row (the combine-videos charge reads it): the code's own row, no database.
    getModelCreditBaseCost: vi.fn(async (id: string) => ({ creditCost: real.STATIC_CREDIT_COSTS[id]!, isEnabled: true, tierRestriction: null })),
    getModelCreditCostFromDB: vi.fn(async (id: string) => {
      h.begun += 1
      if (h.gate) await h.gate
      if (!(id in h.rows)) throw new Error(`no row for ${id}`)
      return { creditCost: h.rows[id]!, isEnabled: true, tierRestriction: null }
    }),
  }
})
vi.mock("../../../lib/private-plugins/load.js", () => ({ getPluginServices: () => h.services }))
// The leaf the consumers read from forwards to the mock above.
vi.mock("../../../lib/private-plugins/services-registry.js", async () => ({ getPluginServices: (await import("../../../lib/private-plugins/load.js")).getPluginServices }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({})) }))
// The metered side of a clip's reading (round 3): side holds on/off, and the one-frame side hold.
const side = vi.hoisted(() => ({ available: false, hold: 7, holdCalls: [] as unknown[][] }))
vi.mock("../../../lib/llm-side-hold-availability.js", () => ({ sideHoldsAvailable: () => side.available }))
vi.mock("../../billing/llm-hold-for-calls.js", () => ({
  llmHoldForCalls: vi.fn(async (...a: unknown[]) => (side.holdCalls.push(a), { chargeId: "image-to-text:m", holdCredits: side.hold })),
}))
vi.mock("../../billing/service-margin.js", () => ({ applyServiceMarkup: (base: number) => base }))

import { ESTIMATE_CALLER, UgcQuoteError, priceUgcCalls } from "../ugc-quote.js"
import { UgcEstimateUnavailable, estimateUgcRun, quoteUgcTickets } from "../ugc-estimate.js"

/**
 * The join as a run commits it: the UGC template's join settings, and no per-clip length (the clips
 * reach the join as one Bundle list, which carries none), so each clip is priced at the fallback length.
 */
/** The join of clips of these ticket lengths: each clip at its ticket's length, the most a finished clip runs. */
const joinOf = (...ticketSecs: number[]) => estimateCombineVideosCredits({ transition: "cut", trimStartFrames: 1, trimEndFrames: 2 }, ticketSecs)

describe("the inputs read off a UGC graph", () => {
  it("a script with no length set is estimated at the length the UGC Script wires send for it", () => {
    const lengthOf = (data: Record<string, unknown>) => {
      const nodes = [{ id: "s", type: "ugc-script", data }]
      return ugcChainInput(ugcChains(nodes, [])[0]!, nodes, []).input.targetDurationSec
    }
    expect(lengthOf({})).toBe(UGC_SCRIPT_DEFAULT_TARGET_SEC)
    expect(lengthOf({ targetDurationSec: 30 })).toBe(30)
  })
})

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
  h.gate = null
  h.begun = 0
  side.available = false
  side.holdCalls = []
})

describe("the dry-run estimate (spec §6.7)", () => {
  it("prices the three lengths, the script, the creator and each length's steps at once, never one round trip after another", async () => {
    const serial = await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })
    let open!: () => void
    h.gate = new Promise((resolve) => { open = resolve })
    h.begun = 0
    const priced = estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })
    // Three lengths' clips and their four step rows, the script's row and the creator: all under way before any answers.
    await vi.waitFor(() => expect(h.begun).toBe(3 * (1 + 4) + 1 + 1))
    open()
    expect(await priced).toEqual(serial)
  })

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
  it("R58: fixed mode (every deployed plugin) prices the in-clip reading at the TIER row the plugin charges; the creator check (a host route) at its estimate", async () => {
    vi.mocked(priceUgcCalls).mockClear()
    await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12)], false)
    const clipCall = vi.mocked(priceUgcCalls).mock.calls.find(([, calls]) => (calls as Call[]).some((c) => c.tool === "generate_video"))!
    expect((clipCall[1] as Call[]).map((c) => c.tool)).toEqual(["generate_video", "image_to_text"])
    expect(clipCall[2]).toBe("tier")
    vi.mocked(priceUgcCalls).mockClear()
    await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })
    const creatorCall = vi.mocked(priceUgcCalls).mock.calls.find(([, calls]) => (calls as Call[]).some((c) => c.tool === "generate_image"))!
    expect(creatorCall[2]).toBe("estimate")
  })
  it("R58 flags: fixed mode marks only the creator check an estimate (its part `≈`); the ticket form marks nothing", async () => {
    const tickets = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12)], false)
    expect(tickets.estimateParts).toBeUndefined()
    expect(tickets.lines.some((l) => l.estimate)).toBe(false)
    const run = await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })
    expect(run.estimateParts).toEqual(["creator"])
    expect(run.lines.filter((l) => l.estimate).map((l) => l.key)).toEqual(["creatorCheck"])
  })
  it("an absent plugin service → UgcEstimateUnavailable", async () => {
    h.services = {}
    await expect(estimateUgcRun(ESTIMATE_CALLER, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })).rejects.toBeInstanceOf(UgcEstimateUnavailable)
  })
  it("the ticket form: two tickets → a join line, each ticket's expected and its 2x ceiling", async () => {
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12, true), ticket(1, 10)], true)
    const join = joinOf(12, 10)
    expect(r.lines.slice(0, 3).map(({ label, credits }) => ({ label, credits }))).toEqual([
      { label: "Clip 1 (12 s)", credits: 1200 + 10 + 3 },
      { label: "Clip 2 (10 s)", credits: 1000 + 3 },
      { label: "Join the clips", credits: join },
    ])
    expect(r.expected).toBe(1213 + 1003 + join + FIXED)
    expect(r.ceiling).toBe(2 * 1213 + 2 * 1003 + join + FIXED)
    const one = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12)], false)
    expect(one.lines.map((l) => l.label)).toEqual(["Clip 1 (12 s)", "Word timings", "Speech check", "Captions"])
  })
  it("each part's expected credits add up to the expected figure: the fixed lines are the join, the cards' word timings and speech check, the screenshot cards and the captions", async () => {
    const r = await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })
    expect(r.parts).toEqual({ script: 20, creator: 45 + 3, clip: 1503, cards: 30 + 22, join: 0, overlay: 20, captions: 50 })
    expect(Object.keys(r.parts).sort()).toEqual([...UGC_ESTIMATE_PARTS].sort())
    expect(Object.values(r.parts).reduce((a, b) => a + b, 0)).toBe(r.expected)
    const photo = await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 0, source: "photo" })
    expect(photo.parts).toMatchObject({ creator: 3, overlay: 0 })
    expect(Object.values(photo.parts).reduce((a, b) => a + b, 0)).toBe(photo.expected)
  })
  it("the ticket form states its parts too: the clips, the join and the fixed lines, and no script or creator", async () => {
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12, true), ticket(1, 10)], true)
    const join = joinOf(12, 10)
    expect(r.parts).toEqual({ script: 0, creator: 0, clip: 1213 + 1003, cards: 30 + 22, join, overlay: 20, captions: 50 })
    expect(Object.values(r.parts).reduce((a, b) => a + b, 0)).toBe(r.expected)
    // The public lines keep their shape: the part a line prices stays inside.
    for (const line of r.lines) expect(Object.keys(line).filter((k) => !["credits", "label", "key", "n", "seconds"].includes(k))).toEqual([])
  })
  it("each part's hold, what a run holds while the clips render at the longest length the estimate allows, adds up to the worst case", async () => {
    const r = await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 3, source: "sampled" })
    // The worst case is the 1.2x run (18 s), each clip held at twice its price; the steps around the clips hold their price.
    expect(r.holdParts).toEqual({ script: 20, creator: 45 + 3, clip: 2 * 1803, cards: 30 + 22, join: 0, overlay: 20, captions: 50 })
    expect(Object.values(r.holdParts).reduce((a, b) => a + b, 0)).toBe(r.worstCase)
    // A fired moderation fallback is in no figure: the creator holds what it is expected to cost.
    expect(r.holdParts.creator).toBe(r.parts.creator)
  })
  it("the ticket form's hold adds up to its ceiling: each clip twice", async () => {
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12, true), ticket(1, 10)], true)
    const join = joinOf(12, 10)
    expect(r.holdParts).toEqual({ script: 0, creator: 0, clip: 2 * (1213 + 1003), cards: 30 + 22, join, overlay: 20, captions: 50 })
    expect(Object.values(r.holdParts).reduce((a, b) => a + b, 0)).toBe(r.ceiling)
  })
  it("docs/nodes/ai-video/ugc-clip.md worked example", async () => {
    // A clip whose video is priced at 1,000 (10 s at 100 a second) and its frame reading at 3, not voiced.
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 10)], false)
    // Passing its check on the first render, it costs 1,003.
    expect(r.lines[0]).toMatchObject({ key: "clip", credits: 1003 })
    expect(r.parts.clip).toBe(1003)
    // While it renders it holds 2,006: twice that, what a clip that needs its re-render costs.
    expect(r.holdParts.clip).toBe(2006)
    expect(r.holdParts.clip).toBe(2 * r.parts.clip)
  })
  it("each line names itself by a stable id beside its English label, a clip with its number and length", async () => {
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12, true), ticket(1, 10)], true)
    expect(r.lines.map(({ key, label }) => [key, label])).toEqual([
      ["clip", "Clip 1 (12 s)"], ["clip", "Clip 2 (10 s)"], ["join", "Join the clips"], ["alignment", "Word timings"],
      ["speechCheck", "Speech check"], ["cards", "Screenshot cards"], ["captions", "Captions"],
    ])
    expect(r.lines.slice(0, 2).map(({ n, seconds }) => ({ n, seconds }))).toEqual([{ n: 1, seconds: 12 }, { n: 2, seconds: 10 }])
    for (const line of r.lines.slice(2)) expect(line).not.toHaveProperty("n")
    for (const line of r.lines) expect(UGC_QUOTE_LINE_KEYS).toContain(line.key)
  })
  it("the ticket form with reusedClips: a clip handed back costs nothing and holds nothing; the join still takes every clip", async () => {
    const all = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12, true), ticket(1, 10), ticket(2, 8)], true)
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12, true), ticket(1, 10), ticket(2, 8)], true, false, new Set([1, 3]))
    const join = joinOf(12, 10, 8)
    expect(r.lines.slice(0, 3)).toEqual([
      { label: "Clip 1 (12 s), reused", key: "clip", n: 1, seconds: 12, credits: 0, reused: true },
      { label: "Clip 2 (10 s)", key: "clip", n: 2, seconds: 10, credits: 1003 },
      { label: "Clip 3 (8 s), reused", key: "clip", n: 3, seconds: 8, credits: 0, reused: true },
    ])
    expect(r.parts.clip).toBe(1003)
    expect(r.holdParts.clip).toBe(2 * 1003)
    expect(r.expected).toBe(1003 + join + FIXED)
    expect(r.ceiling).toBe(2 * 1003 + join + FIXED)
    // Every other part is the one a quote with no clip reused gives.
    expect({ ...r.parts, clip: 0 }).toEqual({ ...all.parts, clip: 0 })
  })
  it("every clip handed back: the clip part is nothing", async () => {
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 6), ticket(1, 6)], false, false, new Set([1, 2]))
    expect(r.parts.clip).toBe(0)
    expect(r.holdParts.clip).toBe(0)
    // No reuse given: every clip renders, as before.
    const none = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 6), ticket(1, 6)], false)
    expect(none.parts.clip).toBe(2 * 603)
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

describe("a sampled creator drawn by more than one image candidate", () => {
  const image = (model: string) => ({ tool: "generate_image", args: { prompt: "p", model } })
  const check = { tool: "image_to_text", args: { custom_prompt: "q" } }
  const plan = (candidates: Call[] | undefined, creatorImage: Call | null = image("m-1")) =>
    vi.fn((input: { targetDurationSec: number }) => ({
      tickets: [ticket(0, input.targetDurationSec)],
      creatorImage,
      creatorChecks: [check],
      ...(candidates ? { creatorCandidates: candidates } : {}),
    }))
  const input = { targetDurationSec: 15, screenshotCount: 3, source: "sampled" } as const
  const creatorLines = (lines: ReadonlyArray<{ label: string; credits: number }>) =>
    lines.filter((l) => l.label.startsWith("Creator")).map(({ label, credits }) => ({ label, credits }))

  it("the estimate's own lines name themselves too: the script, each creator image and each check", async () => {
    h.services = { ugc: { estimate: plan([image("m-1"), image("m-2")]) } }
    const r = await estimateUgcRun({ userId: "u1" }, input, { rendersEveryCandidate: true })
    expect(r.lines.slice(0, 5).map(({ key, label }) => [key, label])).toEqual([
      ["script", "Script"], ["creatorImage", "Creator image"], ["creatorImage", "Creator image"], ["creatorCheck", "Creator check"], ["creatorCheck", "Creator check"],
    ])
    for (const line of r.lines) expect(UGC_QUOTE_LINE_KEYS).toContain(line.key)
  })

  it("a run that renders only the primary prices the primary and its check, as before", async () => {
    h.services = { ugc: { estimate: plan([image("m-1"), image("m-2")]) } }
    const r = await estimateUgcRun({ userId: "u1" }, input)
    expect(creatorLines(r.lines)).toEqual([{ label: "Creator image", credits: 15 }, { label: "Creator check", credits: 3 }])
    expect(r.expected).toBe(20 + 15 + 3 + 1503 + FIXED)
  })

  it("a run that renders every candidate prices each candidate's image and the check on each; every figure rises by exactly the second image and its check", async () => {
    h.services = { ugc: { estimate: plan([image("m-1"), image("m-2")]) } }
    const primary = await estimateUgcRun({ userId: "u1" }, input)
    const every = await estimateUgcRun({ userId: "u1" }, input, { rendersEveryCandidate: true })
    expect(creatorLines(every.lines)).toEqual([
      { label: "Creator image", credits: 15 },
      { label: "Creator image", credits: 18 },
      { label: "Creator check", credits: 3 },
      { label: "Creator check", credits: 3 },
    ])
    const second = 18 + 3
    expect(every.expected).toBe(primary.expected + second)
    expect(every.ceiling).toBe(primary.ceiling + second)
    expect(every.range).toEqual([primary.range[0] + second, primary.range[1] + second])
    expect(every.worstCase).toBe(primary.worstCase + second)
    // Everything after the creator is the same run.
    expect(every.lines.filter((l) => !l.label.startsWith("Creator"))).toEqual(primary.lines.filter((l) => !l.label.startsWith("Creator")))
  })

  it("a run that renders every candidate states the creator part as every image and its check; the parts add up to the expected figure", async () => {
    h.services = { ugc: { estimate: plan([image("m-1"), image("m-2")]) } }
    const every = await estimateUgcRun({ userId: "u1" }, input, { rendersEveryCandidate: true })
    expect(every.parts.creator).toBe(15 + 18 + 3 + 3)
    expect(Object.values(every.parts).reduce((a, b) => a + b, 0)).toBe(every.expected)
    expect(every.parts.script).toBe(20)
    const clipLines = every.lines.filter((l) => l.label.startsWith("Clip "))
    expect(clipLines.length).toBeGreaterThan(0)
    expect(every.parts.clip).toBe(clipLines.reduce((sum, l) => sum + l.credits, 0))
    // The primary alone: the same run, with one image and one check in its creator part.
    const primary = await estimateUgcRun({ userId: "u1" }, input)
    expect(primary.parts).toEqual({ ...every.parts, creator: 15 + 3 })
  })

  it("docs/nodes/ai-video/ugc-creator.md worked example: 39 in the editor, 18 in an app", async () => {
    h.services = { ugc: { estimate: plan([image("m-1"), image("m-2")]) } }
    expect((await estimateUgcRun({ userId: "u1" }, input, { rendersEveryCandidate: true })).parts.creator).toBe(39)
    expect((await estimateUgcRun({ userId: "u1" }, input)).parts.creator).toBe(18)
  })

  it.each([
    ["an older plugin that lists no candidates", undefined],
    ["a creator with one candidate", [image("m-1")]],
  ])("%s: a run that renders every candidate prices the primary alone", async (_name, candidates) => {
    h.services = { ugc: { estimate: plan(candidates) } }
    const r = await estimateUgcRun({ userId: "u1" }, input, { rendersEveryCandidate: true })
    expect(creatorLines(r.lines)).toEqual([{ label: "Creator image", credits: 15 }, { label: "Creator check", credits: 3 }])
  })

  // A photo renders no image: the plugin lists no candidates for it, or an empty list.
  it.each([
    ["no candidate list", undefined],
    ["an empty candidate list", []],
  ])("a photo creator with %s renders no image, whatever the run: its check is priced once", async (_name, candidates) => {
    h.services = { ugc: { estimate: plan(candidates, null) } }
    for (const opts of [{}, { rendersEveryCandidate: true }]) {
      const r = await estimateUgcRun({ userId: "u1" }, { ...input, source: "photo" }, opts)
      expect(creatorLines(r.lines)).toEqual([{ label: "Creator check", credits: 3 }])
    }
  })
})

describe("the multiple of a clip's price a run holds comes from the plugin", () => {
  const input = { targetDurationSec: 15, screenshotCount: 3, source: "sampled" } as const
  const TICKETS = [ticket(0, 12, true), ticket(1, 10)]
  const CLIPS = 1213 + 1003
  const join = joinOf(12, 10)
  const withFactor = (clipHoldFactor: unknown) => { h.services = { ugc: { estimate, clipHoldFactor } } }
  /** Both forms' holds at `factor`: the ticket form's ceiling and clip hold, the estimate's at its longest length. */
  async function expectHeldAt(factor: number) {
    const quote = await quoteUgcTickets({ userId: "u1" }, TICKETS, true)
    expect(quote.ceiling).toBe(factor * CLIPS + join + FIXED)
    expect(quote.holdParts).toEqual({ script: 0, creator: 0, clip: factor * CLIPS, cards: 30 + 22, join, overlay: 20, captions: 50 })
    const run = await estimateUgcRun({ userId: "u1" }, input)
    expect(run.ceiling).toBe(20 + 45 + 3 + factor * 1503 + FIXED)
    expect(run.worstCase).toBe(20 + 45 + 3 + factor * 1803 + FIXED)
    expect(run.holdParts.clip).toBe(factor * 1803)
    expect(Object.values(run.holdParts).reduce((a, b) => a + b, 0)).toBe(run.worstCase)
  }

  it("a plugin factor of 3: the ceiling and each part's hold hold every clip at three times its price; the price does not move", async () => {
    withFactor(() => 3)
    await expectHeldAt(3)
    const quote = await quoteUgcTickets({ userId: "u1" }, TICKETS, true)
    expect(quote.expected).toBe(CLIPS + join + FIXED)
    expect(quote.parts.clip).toBe(CLIPS)
  })

  it("a plugin that predates the factor: twice", async () => {
    expect(h.services).toEqual({ ugc: { estimate } })
    await expectHeldAt(2)
  })

  it.each([
    ["0", 0],
    ["-1", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["the string \"2\"", "2"],
  ])("a factor of %s is no multiple to hold: twice", async (_name, factor) => {
    withFactor(() => factor)
    await expectHeldAt(2)
  })

  it("a factor that throws: twice, and the quote still answers", async () => {
    withFactor(() => { throw new Error("contract") })
    await expectHeldAt(2)
  })

  it("each answer reads the factor once, so its ceiling, its holds and its worst case share one value", async () => {
    const factor = vi.fn(() => 3)
    withFactor(factor)
    await estimateUgcRun({ userId: "u1" }, input)
    expect(factor).toHaveBeenCalledTimes(1)
    factor.mockClear()
    await quoteUgcTickets({ userId: "u1" }, TICKETS, true)
    expect(factor).toHaveBeenCalledTimes(1)
  })

  it("a factor that is not a whole number holds each clip at its multiple, rounded up to a whole credit", async () => {
    withFactor(() => 1.5)
    const quote = await quoteUgcTickets({ userId: "u1" }, TICKETS, true)
    // 1.5 x 1213 = 1819.5 and 1.5 x 1003 = 1504.5, each rounded up.
    expect(quote.holdParts.clip).toBe(1820 + 1505)
    expect(quote.ceiling).toBe(1820 + 1505 + join + FIXED)
  })
})

describe("round 3 — a clip's reading as the plugin charges it (clipReadingMode)", () => {
  const metered = (model?: string) => {
    h.services = { ugc: { estimate, clipReadingMode: () => "metered", ...(model ? { clipReadingModel: () => model } : {}) } }
    side.available = true
  }

  it("absent (an older plugin) → today's fixed model: the reading inside each clip, held at the clip factor", async () => {
    side.available = true
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12, true), ticket(1, 10)], true)
    expect(r.lines.some((l) => l.key === "clipReading")).toBe(false)
    expect(r.lines[0]!.credits).toBe(1200 + 10 + 3)
    expect(r.ceiling).toBe(2 * 1213 + 2 * 1003 + joinOf(12, 10) + FIXED)
  })

  it("metered but side holds unavailable (the rollback) → fixed, exactly as today", async () => {
    metered()
    side.available = false
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12)], false)
    expect(r.lines.some((l) => l.key === "clipReading")).toBe(false)
    expect(r.lines[0]!.credits).toBe(1200 + 3)
  })

  it("metered: the clip holds video + speech only; one reading line per clip — expected one reading, held one side hold", async () => {
    metered("claude-sonnet-5.5")
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12, true), ticket(1, 10)], true)
    expect(r.lines.slice(0, 4).map(({ key, n, credits }) => ({ key, n, credits }))).toEqual([
      { key: "clip", n: 1, credits: 1210 },
      { key: "clipReading", n: 1, credits: 3 },
      { key: "clip", n: 2, credits: 1000 },
      { key: "clipReading", n: 2, credits: 3 },
    ])
    // The reading lines are estimates (charged their actual usage), and so is the clip part: the editor shows `≈`.
    expect(r.lines.filter((l) => l.estimate).map((l) => l.key)).toEqual(["clipReading", "clipReading"])
    expect(r.estimateParts).toEqual(["clip"])
    const join = joinOf(12, 10)
    expect(r.expected).toBe(1210 + 3 + 1000 + 3 + join + FIXED)
    // Never the reading at the clip factor (held twice, affordable users refused): the clips at 2x, each reading's side hold once.
    expect(r.ceiling).toBe(2 * 1210 + 7 + 2 * 1000 + 7 + join + FIXED)
    expect(r.holdParts.clip).toBe(2 * 1210 + 7 + 2 * 1000 + 7)
    // R56: priced at the lane it runs — direct (Advanced) — on the model the plugin pins, as an estimate.
    const { priceUgcCalls: priced } = await import("../ugc-quote.js")
    const readingCall = vi.mocked(priced).mock.calls.find(([, calls]) => (calls as Call[]).some((c) => c.args.advanced_mode === true))
    expect(readingCall?.[1]).toEqual([{ tool: "image_to_text", args: { llmModel: "claude-sonnet-5.5", advanced_mode: true } }])
    expect(readingCall?.[2]).toBe("estimate")
    // The side hold sized as `side.holdFor`: a one-frame call pinned direct, under image-to-text.
    expect(side.holdCalls[0]![0]).toBe("image-to-text")
    expect((side.holdCalls[0]![1] as Array<{ request: { requireLane: string } }>)[0]!.request.requireLane).toBe("direct")
  })

  it("a reused clip makes no reading", async () => {
    metered()
    const r = await quoteUgcTickets({ userId: "u1" }, [ticket(0, 12), ticket(1, 10)], false, false, new Set([1]))
    expect(r.lines.filter((l) => l.key === "clipReading").map((l) => l.n)).toEqual([2])
  })

  it("the estimate's worst case holds every re-render's reading (hold factor × the reading's side hold)", async () => {
    metered()
    const r = await estimateUgcRun({ userId: "u1" }, { targetDurationSec: 15, screenshotCount: 0, source: "photo" })
    const high = Math.round(15 * 1.2)
    expect(r.holdParts.clip).toBe(2 * 100 * high + 2 * 7)
    expect(r.ceiling).toBe(r.expected - 3 - 1500 + 2 * 1500 + 7)
  })
})
