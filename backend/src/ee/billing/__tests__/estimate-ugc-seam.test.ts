/**
 * The publish estimate seam (spec section 6.8): `estimateWorkflowCredits` prices
 * the UGC part of a graph through the plugin's estimate, under the estimate
 * caller (no payer), and leaves the UGC nodes and the nodes downstream of UGC
 * Clip that the estimate already counts out of the per-node sum.
 *
 * The module is mocked PARTIALLY: only `estimateUgcRun` is stubbed; the real
 * video reading (`@nodaro/render-rules`' `ugcChains` / `ugcChainInput`) runs. `getChargedPriceTable` is called inside
 * credits.ts, so the database is stubbed instead: with no rows every node prices
 * at its STATIC_CREDIT_COSTS row, unmarked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { db, settings, edition } = vi.hoisted(() => ({
  db: {
    rows: [] as Array<{ model_identifier: string; credit_cost: number }>,
    /** PostgREST's max_rows: the most rows one response can carry. */
    cap: 1000,
    /** How many whole-table reads fail before one succeeds. */
    failReads: 0,
    rangeCalls: 0,
  },
  settings: {
    value: { cost_markup_percent: 0, service_margin_percent: {} as Record<string, number> },
  },
  edition: { hasCredits: true },
}))

function modelPricingQuery() {
  let identifier: string | undefined
  const query = {
    select: () => query,
    order: () => query,
    eq: (_column: string, value: string) => {
      identifier = value
      return query
    },
    single: async () => {
      const row = db.rows.find((r) => r.model_identifier === identifier)
      return row
        ? { data: { credit_cost: row.credit_cost, is_enabled: true, tier_restriction: null }, error: null }
        : { data: null, error: { code: "PGRST116" } }
    },
    range: async (from: number, to: number) => {
      db.rangeCalls++
      if (db.failReads > 0) {
        db.failReads--
        return { data: null, error: { message: "connection reset" } }
      }
      const sorted = [...db.rows].sort((a, b) => a.model_identifier.localeCompare(b.model_identifier))
      return { data: sorted.slice(from, Math.min(to + 1, from + db.cap)), error: null }
    },
  }
  return query
}

/** The payer's profile a Render final quote's balance check reads (`checkRunSetCredits`). */
function profilesQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({ data: { tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0, subscription_credits: 1_000_000, topup_credits: 0 }, error: null }),
  }
  return query
}

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "profiles") return profilesQuery()
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      return modelPricingQuery()
    },
  },
}))

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: async () => settings.value,
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => edition.hasCredits }
})

// R58: the plugin's reading mode, the one switch for whether a clip's reading is an estimate.
const readingMode = vi.hoisted(() => ({ value: "fixed" as "metered" | "fixed" }))
const h = vi.hoisted(() => ({ estimate: vi.fn() }))
vi.mock("../../lib/ugc-estimate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ugc-estimate.js")>()),
  estimateUgcRun: h.estimate,
  ugcClipReadingMode: () => readingMode.value,
}))

import { stripUgcPublishState } from "@nodaro/render-rules"
import { ESTIMATE_CALLER } from "../../lib/ugc-quote.js"
import { UgcEstimateUnavailable } from "../../lib/ugc-estimate.js"
import { CreditsService, estimateWorkflowListingCredits } from "../credits.js"

const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
const NODES = [
  n("site", "text-prompt", { text: "" }),
  n("shot1", "upload-image"), n("shot2", "upload-image"), n("shot3", "upload-image"),
  n("script", "ugc-script", { targetDurationSec: 20 }),
  n("creator", "ugc-creator", { source: "photo" }),
  n("clips", "ugc-clips"), n("clip", "ugc-clip", { rerender: {} }), n("cards", "ugc-cards"),
  n("join", "combine-videos", { transition: "cut" }), n("overlay", "video-overlay"), n("captions", "add-captions"),
]
const e = (source: string, target: string, targetHandle: string) => ({ source, target, targetHandle })
const EDGES = [
  e("shot1", "script", "screenshot"), e("shot2", "script", "screenshot2"), e("shot3", "script", "screenshot3"),
  e("script", "clips", "plan"), e("creator", "clips", "creator"), e("clips", "clip", "clip"),
  e("clip", "join", "in"), e("clip", "cards", "notes"), e("join", "cards", "video"), e("join", "overlay", "video"),
  // A caption wire names its pip (an edge without one reads Cards' primary output, the layer plan).
  e("cards", "overlay", "layerPlan"), { ...e("cards", "captions", "captionPlan"), sourceHandle: "captionPlan" }, e("overlay", "captions", "in"),
]
const INPUTS = NODES.slice(0, 4)

/** One video's parts, adding up to its expected 2563. */
const PARTS = { script: 20, creator: 3, clip: 2366, cards: 52, join: 30, overlay: 20, captions: 72 }
const ZERO = { script: 0, creator: 0, clip: 0, cards: 0, join: 0, overlay: 0, captions: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  h.estimate.mockResolvedValue({ expected: 2563, range: [2083, 3033], worstCase: 5876, lines: [], ceiling: 0, parts: PARTS, holdParts: PARTS })
})

describe("the publish estimate seam (spec 6.8)", () => {
  it("prices the UGC part through the seam under the estimate caller, with the graph's inputs", async () => {
    const total = await CreditsService.estimateWorkflowCredits(NODES, EDGES)
    expect(h.estimate).toHaveBeenCalledTimes(1)
    expect(h.estimate).toHaveBeenCalledWith(ESTIMATE_CALLER, { targetDurationSec: 20, screenshotCount: 3, source: "photo" })
    // The input nodes price the same alone; the five UGC nodes and the three downstream nodes are inside the seam's
    // figure, so a leak into the sum shows as their static rows (ugc-script 20, combine-videos, video-overlay 20, add-captions).
    expect(total).toBe(2563 + (await CreditsService.estimateWorkflowCredits(INPUTS, [])))
  })
  it("a Combine Videos node NOT downstream of UGC Clip is still priced by the sum", async () => {
    const extra = n("other", "combine-videos", { transition: "cut" })
    const total = await CreditsService.estimateWorkflowCredits([...NODES, extra], EDGES)
    const alone = await CreditsService.estimateWorkflowCredits([extra], [])
    expect(alone).toBeGreaterThan(0)
    expect(total).toBe(2563 + alone + (await CreditsService.estimateWorkflowCredits(INPUTS, [])))
  })
  it("a call with no edges cannot place a node in a video: each UGC node is priced at its own part, every other node by the sum", async () => {
    const total = await CreditsService.estimateWorkflowCredits(NODES)
    const downstream = NODES.filter((x) => ["combine-videos", "video-overlay", "add-captions"].includes(x.type))
    const counted = await CreditsService.estimateWorkflowCredits(downstream, [])
    expect(counted).toBeGreaterThan(0)
    const ownParts = PARTS.script + PARTS.creator + PARTS.clip + PARTS.cards
    expect(total).toBe(ownParts + counted + (await CreditsService.estimateWorkflowCredits(INPUTS, [])))
  })
  it("a downstream node with no id is counted", async () => {
    const anonymous = { type: "video-overlay", data: {} }
    const total = await CreditsService.estimateWorkflowCredits([...NODES, anonymous], EDGES)
    const alone = await CreditsService.estimateWorkflowCredits([anonymous], [])
    expect(alone).toBeGreaterThan(0)
    expect(total).toBe(2563 + alone + (await CreditsService.estimateWorkflowCredits(INPUTS, [])))
  })
  it("a listing estimate (whole-graph scope) takes the same UGC figure", async () => {
    const total = await CreditsService.estimateWorkflowCredits(NODES, EDGES, { scope: "whole-graph" })
    expect(total).toBe(2563 + (await CreditsService.estimateWorkflowCredits(INPUTS, [], { scope: "whole-graph" })))
  })
  it("an unavailable estimate counts the UGC part as 0 and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    h.estimate.mockRejectedValueOnce(new UgcEstimateUnavailable())
    const total = await CreditsService.estimateWorkflowCredits(NODES, EDGES)
    expect(total).toBe(await CreditsService.estimateWorkflowCredits(INPUTS, []))
    expect(warn).toHaveBeenCalledWith("[estimate] UGC estimate unavailable; UGC nodes counted as 0", expect.anything())
  })
  it("a graph without ugc-clip never calls the seam", async () => {
    await CreditsService.estimateWorkflowCredits([n("a", "generate-image")], [])
    expect(h.estimate).not.toHaveBeenCalled()
  })
  it("the estimator never prices a UGC node from its own row", async () => {
    // ugc-clip's row is 0 and ugc-script's is 20: with the seam answering 0, the figure is the input nodes' alone.
    h.estimate.mockResolvedValueOnce({ expected: 0, range: [0, 0], worstCase: 0, lines: [], ceiling: 0, parts: ZERO, holdParts: ZERO })
    expect(await CreditsService.estimateWorkflowCredits(NODES, EDGES)).toBe(await CreditsService.estimateWorkflowCredits(INPUTS, []))
  })
})

describe("the seam prices each UGC video, and only the nodes each one owns", () => {
  const second = (p: string) => ({
    nodes: [
      n(`${p}script`, "ugc-script", { targetDurationSec: 30 }), n(`${p}creator`, "ugc-creator", { source: "sampled" }),
      n(`${p}clips`, "ugc-clips"), n(`${p}clip`, "ugc-clip"), n(`${p}cards`, "ugc-cards"),
    ],
    edges: [e(`${p}script`, `${p}clips`, "plan"), e(`${p}creator`, `${p}clips`, "creator"), e(`${p}clips`, `${p}clip`, "clip"), e(`${p}clip`, `${p}cards`, "notes")],
  })

  it("two videos are two estimates, each read through its own wires, and both are priced", async () => {
    const b = second("b-")
    // B's nodes first: its own script and creator are read, never A's.
    const total = await CreditsService.estimateWorkflowCredits([...b.nodes, ...NODES], [...EDGES, ...b.edges])
    expect(h.estimate).toHaveBeenCalledTimes(2)
    expect(h.estimate.mock.calls.map((c) => c[1])).toEqual([
      { targetDurationSec: 30, screenshotCount: 0, source: "sampled" },
      { targetDurationSec: 20, screenshotCount: 3, source: "photo" },
    ])
    // B prices its script, creator, clip and cards (it has no join, overlay or captions); A every part.
    const bParts = PARTS.script + PARTS.creator + PARTS.clip + PARTS.cards
    const aParts = Object.values(PARTS).reduce((x, y) => x + y, 0)
    expect(total).toBe(bParts + aParts + (await CreditsService.estimateWorkflowCredits(INPUTS, [])))
  })

  it("an outro join and a logo overlay after the captions keep their own prices", async () => {
    const extra = [n("intro", "upload-video"), n("outro", "combine-videos", { transition: "cut" }), n("logo", "video-overlay", { layers: [{ imageUrl: "https://cdn.example/logo.png" }] })]
    const edges = [...EDGES, e("captions", "outro", "in"), e("intro", "outro", "in2"), e("outro", "logo", "video")]
    const before = await CreditsService.estimateWorkflowCredits(NODES, EDGES)
    const after = await CreditsService.estimateWorkflowCredits([...NODES, ...extra], edges)
    // The video's own figure is the same answer (one estimate each time); the two extra nodes add
    // their own prices — at least the logo overlay's own row — where reading them as the video's
    // join and overlay added nothing.
    expect(h.estimate).toHaveBeenCalledTimes(2)
    expect(h.estimate.mock.calls[1]![1]).toEqual(h.estimate.mock.calls[0]![1])
    expect(after - before).toBeGreaterThanOrEqual(20)
  })

  it("a kept script is priced at its own plan's screenshot cards, never the script's wires now", async () => {
    // Placeholders: written with three screenshots; its wires removed since.
    const shot = { url: "https://cdn.example/1.png" }
    const plan = { v: 1, hook: "h", targetDurationSec: 40, beats: [0, 1, 2].map((i) => ({ line: `b${i}`, screenshot: shot })) }
    const kept = NODES.map((x) => (x.id === "script" ? n("script", "ugc-script", { targetDurationSec: 20, keepResult: true, result: { plan } }) : x))
    const unwired = EDGES.filter((x) => !x.targetHandle.startsWith("screenshot"))
    await CreditsService.estimateWorkflowCredits(kept, unwired)
    expect(h.estimate.mock.calls[0]![1]).toEqual({ targetDurationSec: 40, screenshotCount: 3, source: "photo" })
  })

  it("a kept script makes no call: its part is not added", async () => {
    const kept = NODES.map((x) => (x.id === "script" ? n("script", "ugc-script", { targetDurationSec: 20, keepResult: true, result: { plan: { v: 1, hook: "h", targetDurationSec: 40 } } }) : x))
    const total = await CreditsService.estimateWorkflowCredits(kept, EDGES)
    expect(total).toBe(2563 - PARTS.script + (await CreditsService.estimateWorkflowCredits(INPUTS, [])))
    // Priced at the kept plan's length, never the setting.
    expect(h.estimate.mock.calls[0]![1]).toMatchObject({ targetDurationSec: 40 })
  })
})

describe("a published listing is priced on what its runners run", () => {
  // The author ran the video with Keep on: the kept script (its plan written for 40 seconds) and the
  // kept creator make no call in the author's own runs. Placeholders.
  const PHOTO = "https://cdn.example/author.png"
  const authors = () =>
    NODES.map((x) =>
      x.id === "script"
        ? n("script", "ugc-script", { targetDurationSec: 20, keepResult: true, result: { plan: { v: 1, hook: "h", targetDurationSec: 40 } }, ugcOutputs: { plan: "{}" } })
        : x.id === "creator"
          ? n("creator", "ugc-creator", { source: "photo", photoUrl: PHOTO, keepResult: true, result: { v: 1, gender: "man", identityImages: [PHOTO] }, ugcOutputs: { creator: "{}", image: PHOTO } })
          : x,
    )
  const listed = async (nodes: ReturnType<typeof authors>) => {
    const split = await estimateWorkflowListingCredits(nodes, EDGES, { publishType: "template" })
    return split.preview + split.final
  }

  it("the author's own graph would list without the kept script and creator, at the plan's length: 2563 − 20 − 3 = 2540", async () => {
    const base = await listed(INPUTS as ReturnType<typeof authors>)
    expect(await listed(authors())).toBe(2540 + base)
    expect(h.estimate.mock.calls.at(-1)![1]).toEqual({ targetDurationSec: 40, screenshotCount: 3, source: "photo" })
  })

  it("what ships (Keep off, nothing kept) lists the script and the creator too, at the length setting: 2563", async () => {
    const base = await listed(INPUTS as ReturnType<typeof authors>)
    expect(await listed(stripUgcPublishState(authors(), EDGES))).toBe(2563 + base)
    expect(h.estimate.mock.calls.at(-1)![1]).toEqual({ targetDurationSec: 20, screenshotCount: 3, source: "photo" })
  })
})

// A clip's frame reading and the creator check are billed metered (owner decision D15): while metered
// pricing is on, the parts holding them are estimates (`≈`) — the total is the same sum either way.
describe("the UGC part's estimate flag (metered LLM pricing, Task 12)", () => {
  it("metered: the clip and creator parts are estimates, the listing too; rollback: nothing is", async () => {
    const { setLlmMeteredSchemaReadyForTesting } = await import("../../../lib/llm-metered-schema-gate.js")
    const { config } = await import("../../../lib/config.js")
    const { estimateWorkflowCreditsDetailed } = await import("../credits.js")
    setLlmMeteredSchemaReadyForTesting(true)
    try {
      // The quote's own answer says which parts are estimates (`estimateParts`, R58's rule lives in
      // ugc-estimate.ts): here, as the real quote answers — fixed mode marks the creator check only.
      const answer = (estimateParts: string[]) => ({ expected: 2563, range: [2083, 3033], worstCase: 5876, lines: [], ceiling: 0, parts: PARTS, holdParts: PARTS, estimateParts })
      h.estimate.mockImplementation(async () => answer(readingMode.value === "metered" ? ["creator", "clip"] : ["creator"]))
      // R58, fixed mode (every deployed plugin): the clip's reading is the tier row the plugin charges —
      // not an estimate; the creator check (the host's metered route) still is.
      readingMode.value = "fixed"
      const fixed = await estimateWorkflowCreditsDetailed(NODES, EDGES)
      expect(fixed.perNode.clip).toEqual({ credits: PARTS.clip, estimate: false })
      expect(fixed.perNode.creator).toEqual({ credits: PARTS.creator, estimate: true })
      readingMode.value = "metered"
      const metered = await estimateWorkflowCreditsDetailed(NODES, EDGES)
      expect(metered.credits).toBe(await CreditsService.estimateWorkflowCredits(NODES, EDGES))
      expect(metered.perNode.clip).toEqual({ credits: PARTS.clip, estimate: true })
      expect(metered.perNode.creator).toEqual({ credits: PARTS.creator, estimate: true })
      expect(metered.perNode.script).toEqual({ credits: PARTS.script, estimate: false })
      expect(metered.estimate).toBe(true)
      expect((await estimateWorkflowListingCredits(NODES, EDGES, { publishType: "app" })).estimate).toBe(true)
      ;(config as { LLM_TIER_PRICING_ROLLBACK: boolean }).LLM_TIER_PRICING_ROLLBACK = true
      const rolledBack = await estimateWorkflowCreditsDetailed(NODES, EDGES)
      expect(rolledBack.estimate).toBe(false)
      expect(rolledBack.credits).toBe(metered.credits)
      expect((await estimateWorkflowListingCredits(NODES, EDGES, { publishType: "app" })).estimate).toBeUndefined()
    } finally {
      readingMode.value = "fixed"
      ;(config as { LLM_TIER_PRICING_ROLLBACK: boolean }).LLM_TIER_PRICING_ROLLBACK = false
      setLlmMeteredSchemaReadyForTesting(undefined)
    }
  })
})

// A Render final quote's `≈` (render-final-run.ts): `runHoldsMeteredLlmEstimate` reads the run's own
// lines, so a UGC part its quote flags — the creator check — makes the quote an estimate, exactly as
// the run estimate's `perNode` reads it (`estimateUgcPart`), from the same answer: one quote, not two.
describe("a Render final quote of a UGC graph: `≈` from the UGC parts its quote flags", () => {
  it("the creator check (flagged in fixed reading mode) marks it `≈`; no flagged part, or the rollback, does not", async () => {
    const { setLlmMeteredSchemaReadyForTesting } = await import("../../../lib/llm-metered-schema-gate.js")
    const { config } = await import("../../../lib/config.js")
    const { runHoldsMeteredLlmEstimate, estimateRunSetCredits } = await import("../credits.js")
    const { renderFinalCredits } = await import("../../../lib/render-final-run.js")
    const answer = (estimateParts: string[]) => ({ expected: 2563, range: [2083, 3033], worstCase: 5876, lines: [], ceiling: 0, parts: PARTS, holdParts: PARTS, estimateParts })
    const runNodeIds = NODES.map((node) => node.id)
    const quote = () => renderFinalCredits({ userId: "u1", nodes: NODES, edges: EDGES, runNodeIds, overrides: undefined, surface: {} })
    setLlmMeteredSchemaReadyForTesting(true)
    try {
      readingMode.value = "fixed"
      h.estimate.mockImplementation(async () => answer(["creator"]))
      // No node of the graph makes a metered call of its own: the graph walk alone sees no estimate.
      expect(runHoldsMeteredLlmEstimate(NODES, EDGES, new Set(runNodeIds))).toBe(false)
      const lines: Array<{ credits: number; estimate: boolean }> = []
      const figure = await estimateRunSetCredits(NODES, EDGES, new Set(runNodeIds), undefined, undefined, (_id, credits, estimate) => lines.push({ credits, estimate }))
      expect(lines.reduce((sum, l) => sum + l.credits, 0)).toBe(figure)
      expect(runHoldsMeteredLlmEstimate(NODES, EDGES, new Set(runNodeIds), lines)).toBe(true)
      const flagged = await quote()
      expect(flagged).toMatchObject({ estimatedCredits: figure, estimate: true, sufficient: true })
      // One quote per UGC video for the figure and its flag alike (the flag is read off the figure's own lines).
      const calls = h.estimate.mock.calls.length
      await quote()
      expect(h.estimate.mock.calls.length - calls).toBe(1)

      h.estimate.mockImplementation(async () => answer([]))
      expect((await quote())?.estimate).toBeUndefined()

      h.estimate.mockImplementation(async () => answer(["creator"]))
      ;(config as { LLM_TIER_PRICING_ROLLBACK: boolean }).LLM_TIER_PRICING_ROLLBACK = true
      const rolledBack = await quote()
      expect(rolledBack?.estimate).toBeUndefined()
      expect(rolledBack?.estimatedCredits).toBe(figure)
    } finally {
      readingMode.value = "fixed"
      ;(config as { LLM_TIER_PRICING_ROLLBACK: boolean }).LLM_TIER_PRICING_ROLLBACK = false
      setLlmMeteredSchemaReadyForTesting(undefined)
    }
  })
})
