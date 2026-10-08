/**
 * EDIT PLAN PER STARTED MINUTE (decided 2026-10-07).
 *
 * A plugin that declares `supports().editPlanPerMinute` reserves
 * `edit-plan:<mode>:<tier>:<N>m` for N started minutes of the source. The
 * price is ONE rate row and ONE flat row per mode × tier — `flat + rate × N`
 * — read by every lookup (the reserve's single lookup, the price table every
 * estimate reads, the static table), so an admin retune of a row moves the
 * listing, the estimate and the reserve together.
 *
 * The 1–180 guard: with the capability on, for every mode, tier and length,
 * the LISTING at N minutes = the workflow ESTIMATE of a source that long = the
 * RESERVE a run of it makes (at base prices, where no markup rounding
 * separates them), and that price is never above the old step price (equal on
 * a step). With it off, the estimate and the reserve stay on the steps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  EDIT_PLAN_BUCKET_MINUTES,
  EDIT_PLAN_MODES,
  EDIT_PLAN_TIERS,
  editPlanBucketMinutes,
  editPlanFlatCreditId,
  editPlanMinutesCreditId,
  editPlanRateCreditId,
  type EditPlanMode,
  type EditPlanTier,
} from "@nodaro/shared"

const { db, probe } = vi.hoisted(() => ({
  db: { rows: [] as Array<{ model_identifier: string; credit_cost: number }> },
  probe: vi.fn(),
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
      const sorted = [...db.rows].sort((a, b) => a.model_identifier.localeCompare(b.model_identifier))
      return { data: sorted.slice(from, to + 1), error: null }
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
  getAppSettings: async () => ({ cost_markup_percent: 0, service_margin_percent: {} }),
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true }
})
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe }))

import {
  STATIC_CREDIT_COSTS,
  estimateWorkflowCredits,
  estimateWorkflowListingCredits,
  getModelCreditCostFromDB,
  getModelCreditBaseCost,
  getChargedPriceTable,
  chargedCredits,
  invalidateModelPricingCache,
} from "../credits.js"
import { computeEditPlanReserveId } from "../../../lib/edit-plan-pricing.js"
import { setPluginSupports, _resetPluginSupportsForTests } from "../../../lib/private-plugins/supports-registry.js"

const RATE: Record<EditPlanTier, number> = { economy: 2, standard: 4, premium: 8 }
const FLAT: Record<EditPlanTier, number> = { economy: 10, standard: 20, premium: 40 }
const flatOf = (mode: EditPlanMode, tier: EditPlanTier) => (mode === "clips" || mode === "trailer" ? FLAT[tier] : 0)
/** The step price a run was charged before: rate × the step N rounds up to, plus the flat. */
const stepPrice = (mode: EditPlanMode, tier: EditPlanTier, n: number) => RATE[tier] * editPlanBucketMinutes(n * 60) + flatOf(mode, tier)

beforeEach(() => {
  db.rows = []
  invalidateModelPricingCache()
  _resetPluginSupportsForTests()
  probe.mockReset()
})
afterEach(() => _resetPluginSupportsForTests())

describe("the price rows", () => {
  it("one rate row and one flat row per mode × tier; no row per minute or per step", () => {
    for (const mode of EDIT_PLAN_MODES) {
      for (const tier of EDIT_PLAN_TIERS) {
        expect(STATIC_CREDIT_COSTS[editPlanRateCreditId(mode, tier)], `${mode}/${tier} rate`).toBe(RATE[tier])
        expect(STATIC_CREDIT_COSTS[editPlanFlatCreditId(mode, tier)], `${mode}/${tier} flat`).toBe(flatOf(mode, tier))
      }
    }
    const minuteIds = Object.keys(STATIC_CREDIT_COSTS).filter((id) => /^edit-plan:.*:\d+m$/.test(id))
    expect(minuteIds).toEqual([])
  })

  it("the bare edit-plan id stays the table maximum (premium clips or trailer at 180 minutes)", () => {
    expect(STATIC_CREDIT_COSTS["edit-plan"]).toBe(40 + 8 * 180)
  })

  it("a minutes id is priced from the two rows on every lookup", async () => {
    const id = editPlanMinutesCreditId("trailer", "standard", 45)
    expect((await getModelCreditBaseCost(id)).creditCost).toBe(20 + 4 * 45)
    expect((await getChargedPriceTable()).base(id)).toBe(20 + 4 * 45)
  })

  it("an admin retune of a row moves every lookup together", async () => {
    db.rows = [
      { model_identifier: editPlanRateCreditId("tighten", "standard"), credit_cost: 5 },
      { model_identifier: editPlanFlatCreditId("tighten", "standard"), credit_cost: 3 },
      // A stale step row is not the price: the rows are.
      { model_identifier: "edit-plan:tighten:standard:60m", credit_cost: 999 },
    ]
    const table = await getChargedPriceTable()
    for (const n of [1, 45, 60, 180]) {
      const id = editPlanMinutesCreditId("tighten", "standard", n)
      expect((await getModelCreditCostFromDB(id)).creditCost, id).toBe(3 + 5 * n)
      expect(chargedCredits(table, id), id).toBe(3 + 5 * n)
    }
  })
})

/** A recording of `sec` seconds (or unknown) feeding a plan. */
function graph(mode: EditPlanMode, tier: EditPlanTier, sec?: number) {
  const nodes = [
    { id: "rec", type: "upload-video", data: sec === undefined ? {} : { durationSeconds: sec } },
    { id: "plan", type: "edit-plan", data: { mode, planTier: tier } },
  ]
  const edges = [{ source: "rec", target: "plan", sourceHandle: "video", targetHandle: "sources" }]
  return { nodes, edges }
}

async function reserveAt(mode: EditPlanMode, tier: EditPlanTier, sec: number, perMinute: boolean): Promise<{ id: string; credits: number }> {
  probe.mockResolvedValue(sec)
  const payload: Record<string, unknown> = { mode, planTier: tier, sources: [{ id: "rec", url: "https://cdn/ep.mp4" }] }
  const id = (await computeEditPlanReserveId("edit-plan", payload, perMinute))!
  return { id, credits: (await getModelCreditCostFromDB(id)).creditCost }
}

describe("1–180 minutes with the capability on: listing = estimate = reserve, never above the step", () => {
  beforeEach(() => setPluginSupports({ editPlanPerMinute: true }))

  for (const mode of EDIT_PLAN_MODES) {
    for (const tier of EDIT_PLAN_TIERS) {
      it(`${mode} / ${tier}`, async () => {
        const g = graph(mode, tier)
        const listing = await estimateWorkflowListingCredits(g.nodes, g.edges, { publishType: "template" })
        expect(listing.previewPerMinute).toBe(RATE[tier])
        expect(listing.preview).toBe(flatOf(mode, tier))
        for (let n = 1; n <= 180; n++) {
          // A source that ends inside its Nth started minute.
          const sec = n * 60 - 30
          const listed = listing.preview + listing.previewPerMinute * n
          const known = graph(mode, tier, sec)
          const estimate = await estimateWorkflowCredits(known.nodes, known.edges)
          const reserve = await reserveAt(mode, tier, sec, true)
          expect(reserve.id, `n=${n}`).toBe(editPlanMinutesCreditId(mode, tier, n))
          expect(estimate, `estimate n=${n}`).toBe(listed)
          expect(reserve.credits, `reserve n=${n}`).toBe(listed)
          expect(listed, `n=${n} above the step`).toBeLessThanOrEqual(stepPrice(mode, tier, n))
          if (EDIT_PLAN_BUCKET_MINUTES.includes(n)) expect(listed, `step n=${n}`).toBe(stepPrice(mode, tier, n))
        }
      })
    }
  }
})

describe("with the capability off the estimate and the reserve stay on the steps", () => {
  beforeEach(() => setPluginSupports({}))

  it.each([1, 14, 16, 45, 61, 179])("standard tighten of %s minutes", async (n) => {
    const sec = n * 60 - 30
    const known = graph("tighten", "standard", sec)
    expect(await estimateWorkflowCredits(known.nodes, known.edges)).toBe(stepPrice("tighten", "standard", n))
    const reserve = await reserveAt("tighten", "standard", sec, false)
    expect(reserve.id).toBe(`edit-plan:tighten:standard:${editPlanBucketMinutes(sec)}m`)
    expect(reserve.credits).toBe(stepPrice("tighten", "standard", n))
  })

  it("an unknown length estimates the 180-minute step", async () => {
    const g = graph("clips", "premium")
    expect(await estimateWorkflowCredits(g.nodes, g.edges)).toBe(stepPrice("clips", "premium", 180))
  })
})
