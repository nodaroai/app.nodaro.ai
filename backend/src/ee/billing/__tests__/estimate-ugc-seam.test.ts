/**
 * The publish estimate seam (spec section 6.8): `estimateWorkflowCredits` prices
 * the UGC part of a graph through the plugin's estimate, under the estimate
 * caller (no payer), and leaves the UGC nodes and the nodes downstream of UGC
 * Clip that the estimate already counts out of the per-node sum.
 *
 * The module is mocked PARTIALLY: the real `ugcEstimateInputOf` runs and only
 * `estimateUgcRun` is stubbed. `getChargedPriceTable` is called inside
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

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
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

const h = vi.hoisted(() => ({ estimate: vi.fn() }))
vi.mock("../../lib/ugc-estimate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ugc-estimate.js")>()),
  estimateUgcRun: h.estimate,
}))

import { ESTIMATE_CALLER } from "../../lib/ugc-quote.js"
import { UgcEstimateUnavailable } from "../../lib/ugc-estimate.js"
import { CreditsService } from "../credits.js"

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
  e("cards", "overlay", "layerPlan"), e("cards", "captions", "captionPlan"), e("overlay", "captions", "in"),
]
const INPUTS = NODES.slice(0, 4)

beforeEach(() => {
  vi.clearAllMocks()
  h.estimate.mockResolvedValue({ expected: 2563, range: [2083, 3033], worstCase: 5876, lines: [], ceiling: 0 })
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
  it("a call with no edges cannot show a node is downstream, so it is counted (over-quote, never under-quote)", async () => {
    const total = await CreditsService.estimateWorkflowCredits(NODES)
    const downstream = NODES.filter((x) => ["combine-videos", "video-overlay", "add-captions"].includes(x.type))
    const counted = await CreditsService.estimateWorkflowCredits(downstream, [])
    expect(counted).toBeGreaterThan(0)
    expect(total).toBe(2563 + counted + (await CreditsService.estimateWorkflowCredits(INPUTS, [])))
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
    h.estimate.mockResolvedValueOnce({ expected: 0, range: [0, 0], worstCase: 0, lines: [], ceiling: 0 })
    expect(await CreditsService.estimateWorkflowCredits(NODES, EDGES)).toBe(await CreditsService.estimateWorkflowCredits(INPUTS, []))
  })
})
