// @test-watches tools/fixtures/unit-quote-cases.json
/**
 * A per-unit run's QUOTE is its CHARGE. Every lane charges a run priced per
 * unit as ONE whole — the rate row's base × the units, rounded up, marked up
 * once at the rate — while the served one-unit price is already rounded up, so
 * a client multiplying it by the units over-quotes. The price lookups answer
 * the whole run under its own id, `<rateId>:<units>u`; these cases hold that
 * answer (the batch endpoint's rule over the price table, the single GET) and
 * the server's own run estimate to what the routes reserve, at a NON-ZERO
 * margin where the two rules part.
 *
 * The cases are the shared fixture (tools/fixtures/unit-quote-cases.json),
 * which the editor's suite holds its quote to and which covers every node
 * type in the editor's per-unit registry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const { settings } = vi.hoisted(() => ({
  settings: { current: { cost_markup_percent: 0, service_margin_percent: {} as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true, speechLengthPricingEnabled: () => true }
})
// No model_pricing rows: every price falls back to STATIC_CREDIT_COSTS.
function modelPricingQuery() {
  const query = {
    select: () => query,
    order: () => query,
    eq: () => query,
    single: async () => ({ data: null, error: { code: "PGRST116" } }),
    range: async () => ({ data: [], error: null }),
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
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings.current }))
// The run measures a Mask Composite foreground by probing the file: here, the
// length its upload recorded (the fixture's `duration`), keyed by its url.
const { probedSec } = vi.hoisted(() => ({ probedSec: new Map<string, number>() }))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  probeVideoSource: async (url: string) => {
    const durationSeconds = probedSec.get(url)
    if (durationSeconds === undefined) throw new Error(`no probe for ${url}`)
    return { durationSeconds }
  },
}))

import { speechLengthPriceModel } from "@nodaro/shared"
import { CreditsService, PriceNotConfiguredError, STATIC_CREDIT_COSTS, chargedCredits, getChargedPriceTable, getModelCreditBaseCost, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { ltxExtendBaseCredits } from "../../../lib/ltx-extend-credits.js"
import { ltxRetakeBaseCredits } from "../../../lib/ltx-retake-credits.js"
import { maskCompositeBaseCredits, maskCompositeReserveUnits, stampMaskCompositeLength } from "../../../lib/mask-composite-length.js"
import { unitRateBaseCredits } from "../../../lib/credit-base-cost.js"
import { VIDEO_UTILITY_JOB_NAMES, videoUtilityChargeBaseCredits } from "../../../lib/video-utility-credits.js"
import { resolveNodeInputs } from "../../../services/workflow-engine/input-resolver.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import type { SimpleEdge, SimpleNode } from "../../../services/workflow-engine/types.js"
import { SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE } from "../../../lib/speaker-view-plan.js"
import { dubbingBaseCredits } from "../../../lib/dubbing-span.js"
import { UNIT_QUOTE_MAX_UNITS, UNIT_QUOTE_RATE_IDS, parseRateQuoteCreditId } from "../../../lib/unit-quote-rates.js"

type Case = {
  name: string
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
  edges: Array<{ id: string; source: string; target: string; targetHandle: string }>
  node: string
  expect: { rateId: string; units: number; quoteId: string; servedUnit: number; credits: number; perUnitQuote: number }
}
const FIXTURE = resolve(__dirname, "../../../../../tools/fixtures/unit-quote-cases.json")
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  pricing: { chargePercent: number; serviceMarginPercent: Record<string, number>; unitRows: Record<string, number> }
  cases: Case[]
}

function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand)
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>
    if (typeof o.repeat === "number" && typeof o.of === "string") return ((o.prefix as string | undefined) ?? "") + o.of.repeat(o.repeat)
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expand(v)]))
  }
  return value
}

/**
 * What the run's own route reserves (base, before the markup) for `units` of
 * `rateId` — each the route's or the plan's own function, not a re-derivation.
 */
async function routeBase(nodeType: string, rateId: string, units: number): Promise<number> {
  switch (nodeType) {
    case "apply-edl":
    case "trim-video":
    case "loop-video":
    case "combine-videos":
    case "assemble-narrated-video":
      // routes/apply-edl.ts and the video-utility routes' computeCredits: the rate's row × the units.
      return unitRateBaseCredits(rateId, units)
    case "speaker-view":
      // The cloud plugin's route (its own copy of the rates; core's workflow run reads the row).
      return SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE[rateId as keyof typeof SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE] * units
    case "mask-composite":
      return maskCompositeBaseCredits(units)
    case "extend-video":
      return ltxExtendBaseCredits(units)
    case "video-retake":
      return ltxRetakeBaseCredits(units)
    case "dubbing":
      // routes/dubbing.ts computeCredits: the language's per-minute row × the span's whole minutes.
      return dubbingBaseCredits(rateId === "elevenlabs-dubbing-v2" ? "he" : "es", units * 60)
    case "text-to-speech":
    case "text-to-dialogue":
      // lib/speech-credits.ts: the unit row × the started hundreds.
      return STATIC_CREDIT_COSTS[rateId]! * units
    default:
      throw new Error(`no route rule for ${nodeType} — add one with its case`)
  }
}

/**
 * What a workflow RUN of the case's graph reserves for its per-unit node, when
 * the run reads its units off the graph (a video utility, Mask Composite): the
 * real input resolver hands the payload builder the wires (an upload's length
 * included), and the charge functions the run's reservation calls price it,
 * marked up once at the rate. Undefined for a node the run prices otherwise.
 */
async function runCharge(c: Case, rateId: string): Promise<number | undefined> {
  const nodes = c.nodes.map((n) => ({ ...n, data: expand(n.data) as Record<string, unknown> })) as unknown as SimpleNode[]
  const target = nodes.find((n) => n.id === c.node)!
  // A run with nothing wired is refused before it reserves (video_required).
  if (c.edges.length === 0) return undefined
  if (!VIDEO_UTILITY_JOB_NAMES.includes(target.type) && target.type !== "mask-composite") return undefined
  probedSec.clear()
  for (const n of c.nodes) {
    const d = n.data as { url?: unknown; duration?: unknown }
    if (typeof d.url === "string" && typeof d.duration === "number") probedSec.set(d.url, d.duration)
  }
  const inputs = resolveNodeInputs(target, c.edges as unknown as SimpleEdge[], {}, nodes)
  const { payload } = buildPayload(target, "job-1", inputs, "usage-1")
  let base: number | undefined
  if (target.type === "mask-composite") {
    expect(await stampMaskCompositeLength("mask-composite", payload)).toBeUndefined()
    base = await maskCompositeBaseCredits(maskCompositeReserveUnits("mask-composite", payload)!)
  } else {
    base = await videoUtilityChargeBaseCredits(target.type, payload)
  }
  return base === undefined ? undefined : applyServiceMarkup(base, settings.current as never, rateId)
}

/** The id a run's charge is marked up at: the rate itself, a speech row's model. */
const marginKey = (rateId: string) => speechLengthPriceModel(rateId) ?? rateId

beforeEach(() => {
  settings.current = { cost_markup_percent: fixture.pricing.chargePercent, service_margin_percent: fixture.pricing.serviceMarginPercent }
  invalidateModelPricingCache()
})

describe("the fixture's charge — every case, at its non-zero margins", () => {
  it("prices on the code's own rows, at a non-zero margin", () => {
    expect(fixture.pricing.chargePercent).toBeGreaterThan(0)
    for (const [id, row] of Object.entries(fixture.pricing.unitRows)) expect(STATIC_CREDIT_COSTS[id], id).toBe(row)
  })

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const { rateId, units, quoteId, servedUnit, credits } = c.expect
    const nodeType = c.nodes.find((n) => n.id === c.node)!.type

    // What the run's route reserves: its own base, marked up once at the rate.
    const charge = applyServiceMarkup(await routeBase(nodeType, rateId, units), settings.current as never, marginKey(rateId))
    expect(charge).toBe(credits)

    // What a client is told for the whole run: the batch endpoint's rule over the price table, and the single GET.
    const table = await getChargedPriceTable()
    expect(chargedCredits(table, quoteId)).toBe(credits)
    expect(await CreditsService.getModelCreditCost(quoteId)).toBe(credits)

    // The one-unit price the server serves, and the rule this replaces: it × the units, more than the charge.
    expect(chargedCredits(table, rateId)).toBe(servedUnit)
    expect(servedUnit * Math.ceil(units)).toBe(c.expect.perUnitQuote)
    expect(c.expect.perUnitQuote).toBeGreaterThan(credits)

    // The server's own run estimate (apps, templates, MCP) of the same graph is the same charge —
    // an uploaded clip's wire at the clip's recorded length, the length the run forwards to the
    // step (`forwardedVideoLengthSec`), not the estimators' fallback.
    const nodes = c.nodes.map((n) => ({ ...n, data: expand(n.data) as Record<string, unknown> }))
    expect(await CreditsService.estimateWorkflowCredits(nodes, c.edges)).toBe(credits)

    // …and so is what the workflow run itself reserves for that graph, where its units come
    // off the graph: an uploaded clip's length on its wire, a Mask Composite foreground probed.
    const run = await runCharge(c, rateId)
    if (run !== undefined) expect(run).toBe(credits)
  })
})

describe("which wires the server's run estimate reads a length off", () => {
  // The fix for uploaded clips reads RECORDINGS only (an upload, a Video URL). A generation's
  // wire keeps the estimators' fallback here, as before — whether to read its recorded or
  // configured length too (the editor does) is a separate decision.
  const trim = { id: "x", type: "trim-video", data: { trimMode: "keep-first-seconds", keepFirstSeconds: 23 } }
  const edges = [{ id: "v-x", source: "v", target: "x", targetHandle: "in" }]

  it("an upload: its recorded length (40 s → keep 23 s → 5 units)", async () => {
    const upload = { id: "v", type: "upload-video", data: { url: "https://m.test/v.mp4", duration: 40 } }
    expect(await CreditsService.estimateWorkflowCredits([trim, upload], edges, { runNodeIds: new Set(["x"]) })).toBe(applyServiceMarkup(50, settings.current as never, "trim-video"))
  })

  it("a generation: the 8 s fallback (keep 8 s → 2 units), its recorded length unread", async () => {
    const generated = { id: "v", type: "generate-video", data: { duration: 40, generatedResults: [{ url: "https://m.test/g.mp4", duration: 40 }] } }
    expect(await CreditsService.estimateWorkflowCredits([trim, generated], edges, { runNodeIds: new Set(["x"]) })).toBe(applyServiceMarkup(20, settings.current as never, "trim-video"))
  })
})

describe("what a whole-run quote id accepts", () => {
  it("every per-unit rate is priced, and quoted at the rate's own margin", async () => {
    const table = await getChargedPriceTable()
    for (const rateId of UNIT_QUOTE_RATE_IDS) {
      expect(chargedCredits(table, rateId), rateId).toBeDefined()
      settings.current = { cost_markup_percent: 15, service_margin_percent: { [rateId]: 37 } }
      invalidateModelPricingCache()
      const base = STATIC_CREDIT_COSTS[rateId]! * 7
      expect(chargedCredits(await getChargedPriceTable(), `${rateId}:7u`), rateId).toBe(applyServiceMarkup(base, settings.current as never, rateId))
    }
  })

  it.each([
    ["a rate not charged per unit", "nano-banana:3u"],
    ["no unit count", "trim-video:u"],
    ["zero units", "trim-video:0u"],
    ["a negative count", "trim-video:-2u"],
    ["an exponent", "trim-video:1e3u"],
    ["more units than any run", `trim-video:${UNIT_QUOTE_MAX_UNITS + 1}u`],
    ["a speech row through the rate reader (it has its own)", "elevenlabs-v4:per-100-chars:7u"],
  ])("refuses %s — priced nowhere", async (_label, id) => {
    if (!id.includes(":per-100-chars")) expect(parseRateQuoteCreditId(id)).toBeUndefined()
    expect(chargedCredits(await getChargedPriceTable(), id)).toBeUndefined()
    await expect(CreditsService.getModelCreditCost(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
  })

  it("reads fractional units back exactly as the editor wrote them", () => {
    expect(parseRateQuoteCreditId(`ltx-2.3-pro-retake:per-second:${String(2 + 1 / 3)}u`)).toEqual({ rateId: "ltx-2.3-pro-retake:per-second", units: 2 + 1 / 3 })
  })
})
