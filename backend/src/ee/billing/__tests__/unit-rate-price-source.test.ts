/**
 * A per-unit run is CHARGED from the same price source it is QUOTED from.
 *
 * The quote of a per-unit run (`<rateId>:<units>u`, the batch price table and
 * the single GET) reads the rate's `model_pricing` row, falling back to
 * `STATIC_CREDIT_COSTS`. The charge used to read code constants for some rates
 * (Trim / Loop / Combine / Assemble Narrated Video multiplied units by
 * `VIDEO_UTIL_PRICING.CREDIT_UNIT`), so an administrator's retune of a row
 * moved the quote and left the charge where it was. Every per-unit charge now
 * resolves its price through `unitRateBaseCredits` (lib/credit-base-cost.ts):
 * the row through `getModelCreditBaseCost` × the units, rounded up once — the
 * composition the quote branch of `getModelCreditBaseCost` and the table's
 * quote reader use.
 *
 * These hold, for EVERY rate a whole-run quote may name
 * (`UNIT_QUOTE_RATE_IDS`), at admin rows that differ from the code's (one of
 * them fractional, so the rounding is exercised):
 * - the charge each lane in this repo reserves equals the quote, and moved off
 *   the code's price;
 * - each charge site calls the function this suite drives, and no charge site
 *   reads a code constant for the price.
 *
 * Speaker View's single-node route (`POST /v1/speaker-view`) is registered by
 * the cloud plugin, outside this repository. It reserves through the host's
 * `tk.http.unitRatePrice` (lib/private-plugins/toolkit.ts — the same
 * `unitRatePrice` composition its workflow run uses) and stamps the row that
 * read returned for its commit; the toolkit member is held below like every
 * other lane. (The plugin falls back to its own copy of the rates only on a
 * host that lacks the member.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const { rows, settings } = vi.hoisted(() => ({
  rows: new Map<string, number>(),
  settings: { current: { cost_markup_percent: 15, service_margin_percent: {} as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true, speechLengthPricingEnabled: () => true }
})
// model_pricing as an administrator left it: the single lookup (`.eq().single()`) and the paged read (`.range()`).
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      let id: string | undefined
      const query = {
        select: () => query,
        order: () => query,
        eq: (_col: string, value: string) => {
          id = value
          return query
        },
        single: async () => {
          const credit = id === undefined ? undefined : rows.get(id)
          return credit === undefined
            ? { data: null, error: { code: "PGRST116" } }
            : { data: { credit_cost: credit, is_enabled: true, tier_restriction: null }, error: null }
        },
        range: async (from: number) => ({
          data: from > 0 ? [] : [...rows].map(([model_identifier, credit_cost]) => ({ model_identifier, credit_cost })),
          error: null,
        }),
      }
      return query
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings.current }))

import { LTX_EXTEND_PER_SECOND_CREDIT_ID, LTX_RETAKE_PER_SECOND_CREDIT_ID, SPEAKER_VIEW_CREDIT_IDS, ltxRetakeDurationSec, unitQuoteCreditId, type Edl } from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS, chargedCredits, getChargedPriceTable, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { quoteBaseCredits } from "../../../lib/credit-base-cost.js"
import { UNIT_QUOTE_RATE_IDS } from "../../../lib/unit-quote-rates.js"
import { videoUtilityChargeBaseCredits } from "../../../lib/video-utility-credits.js"
import { maskCompositeBaseCredits } from "../../../lib/mask-composite-length.js"
import { ltxExtendBaseCredits } from "../../../lib/ltx-extend-credits.js"
import { ltxRetakeBaseCredits } from "../../../lib/ltx-retake-credits.js"
import { applyEdlCreditOverride } from "../../../lib/apply-edl-plan.js"
import { speakerViewCreditOverride } from "../../../lib/speaker-view-plan.js"
import { dubbingBaseCredits } from "../../../lib/dubbing-span.js"
import { buildToolkit } from "../../../lib/private-plugins/toolkit.js"
import { SRC, parseText, walk } from "../../../lib/__tests__/source-scan.js"

/** An admin row for every rate: the code's row plus 3, and one fractional row. */
const FRACTIONAL_RATE = "trim-video"
function seedAdminRows(): void {
  rows.clear()
  for (const rateId of UNIT_QUOTE_RATE_IDS) rows.set(rateId, (STATIC_CREDIT_COSTS[rateId] ?? 0) + 3)
  rows.set(FRACTIONAL_RATE, 10.5)
}

const markedUp = async (rateId: string, base: number) => applyServiceMarkup(base, settings.current as never, rateId)

/** An edit of `minutes` minutes on one source. */
const edlOf = (minutes: number): Edl =>
  ({
    version: 1,
    clock: "master",
    sources: [{ id: "A", url: "https://m.test/a.mp4", kind: "video" }],
    segments: [{ id: "s0", inMs: 0, outMs: minutes * 60_000, video: "A", audio: "A" }],
  }) as unknown as Edl

type Charge = { readonly units: number; readonly charge: () => Promise<number> }

/** Seven units of each video utility, by the body its route and its workflow run price. */
const videoUtility = (job: string, body: Record<string, unknown>): Charge => ({
  units: 7,
  charge: async () => markedUp(job, (await videoUtilityChargeBaseCredits(job, body))!),
})

/**
 * What each lane in this repo reserves for a run of a per-unit rate, MARKED UP:
 * the function the route's guard and the workflow run's override call. Keyed by
 * rate, and required for every rate a quote may name.
 */
const CHARGES: Readonly<Record<string, Charge>> = {
  // routes/{trim,loop,combine,assemble-narrated}-video.ts and the workflow run's computeVideoUtilityCreditOverride.
  "trim-video": videoUtility("trim-video", { trimMode: "time", startTime: 0, endTime: 35 }),
  "loop-video": videoUtility("loop-video", { mode: "duration", targetDuration: 35 }),
  "combine-videos": videoUtility("combine-videos", { transition: "cut", trimStartFrames: 0, trimEndFrames: 0, videoUrls: ["", ""], upstreamDurations: [15, 20] }),
  "assemble-narrated-video": videoUtility("assemble-narrated-video", { blocks: Array.from({ length: 24 }, () => ({})) }),
  // routes/mask-composite.ts and the workflow run's computeMaskCompositeCreditOverride.
  "mask-composite": { units: 7, charge: async () => markedUp("mask-composite", await maskCompositeBaseCredits(7)) },
  // routes/extend-video.ts and computeLtxExtendCreditOverride.
  [LTX_EXTEND_PER_SECOND_CREDIT_ID]: { units: 7, charge: async () => markedUp(LTX_EXTEND_PER_SECOND_CREDIT_ID, await ltxExtendBaseCredits(7)) },
  // routes/video-retake.ts and computeLtxRetakeCreditOverride (a window set to the frame).
  [LTX_RETAKE_PER_SECOND_CREDIT_ID]: {
    units: ltxRetakeDurationSec(3.3),
    charge: async () => markedUp(LTX_RETAKE_PER_SECOND_CREDIT_ID, await ltxRetakeBaseCredits(3.3)),
  },
  // routes/apply-edl.ts and the workflow run's applyEdlCreditOverride (already marked up).
  "apply-edl": { units: 7, charge: async () => (await applyEdlCreditOverride("apply-edl", { edl: edlOf(7), quality: "final" }))! },
  "apply-edl:proxy": { units: 7, charge: async () => (await applyEdlCreditOverride("apply-edl", { edl: edlOf(7), quality: "proxy" }))! },
  // routes/dubbing.ts: creditGuard(dubbingModelIdentifier(lang), { computeCredits: dubbingBaseCredits(lang, span) }),
  // whole started minutes (3 minutes of Spanish; 7 of Hebrew on the project lane).
  "elevenlabs-dubbing": { units: 3, charge: async () => markedUp("elevenlabs-dubbing", await dubbingBaseCredits("es", 150)) },
  "elevenlabs-dubbing-v2": { units: 7, charge: async () => markedUp("elevenlabs-dubbing-v2", await dubbingBaseCredits("he", 401)) },
  // The workflow run's speakerViewCreditOverride (already marked up). The
  // cloud plugin's single-node route is held through the toolkit, below.
  ...Object.fromEntries(
    SPEAKER_VIEW_CREDIT_IDS.map((id): [string, Charge] => [
      id,
      { units: 7, charge: async () => (await speakerViewCreditOverride("speaker-view", { edl: edlOf(7), reservedCreditId: id }))! },
    ]),
  ),
}

beforeEach(() => {
  settings.current = { cost_markup_percent: 15, service_margin_percent: {} }
  seedAdminRows()
  invalidateModelPricingCache()
})

describe("an admin retune of a per-unit rate moves the charge and the quote together", () => {
  it("every rate a whole-run quote may name has a charge case", () => {
    expect([...UNIT_QUOTE_RATE_IDS].filter((rateId) => !Object.hasOwn(CHARGES, rateId))).toEqual([])
  })

  it.each([...UNIT_QUOTE_RATE_IDS].map((rateId) => [rateId] as const))("%s", async (rateId) => {
    const { units, charge } = CHARGES[rateId]!
    const quoteId = unitQuoteCreditId(rateId, units)
    const charged = await charge()

    // The charge is the quote: the batch table's rule and the single GET.
    expect(chargedCredits(await getChargedPriceTable(), quoteId)).toBe(charged)
    expect(await CreditsService.getModelCreditCost(quoteId)).toBe(charged)
    // …at the admin row, not the code's: the retune moved both.
    expect(charged).toBe(await markedUp(rateId, quoteBaseCredits(rows.get(rateId)!, units)))
    expect(charged).not.toBe(await markedUp(rateId, quoteBaseCredits(STATIC_CREDIT_COSTS[rateId]!, units)))
  })

  it("the server's run estimate of a video utility follows the admin row too", async () => {
    const trim = { id: "t", type: "trim-video", data: { trimMode: "time", startTime: 0, endTime: 35 } }
    expect(await CreditsService.estimateWorkflowCredits([trim], [])).toBe(await CHARGES["trim-video"]!.charge())
    const loop = { id: "l", type: "loop-video", data: { mode: "duration", targetDuration: 35 } }
    expect(await CreditsService.estimateWorkflowCredits([loop], [])).toBe(await CHARGES["loop-video"]!.charge())
  })

  it("a fractional row is rounded up once over the whole run, on both sides", async () => {
    expect(rows.get(FRACTIONAL_RATE)).toBe(10.5)
    // 7 units × 10.5 = 73.5 → 74, then marked up once.
    expect(await CHARGES[FRACTIONAL_RATE]!.charge()).toBe(await markedUp(FRACTIONAL_RATE, 74))
  })

  it("with no admin row, the charge and the quote both fall back to the code's row", async () => {
    rows.clear()
    invalidateModelPricingCache()
    for (const rateId of UNIT_QUOTE_RATE_IDS) {
      const { units, charge } = CHARGES[rateId]!
      const charged = await charge()
      expect(charged, rateId).toBe(await markedUp(rateId, quoteBaseCredits(STATIC_CREDIT_COSTS[rateId]!, units)))
      expect(await CreditsService.getModelCreditCost(unitQuoteCreditId(rateId, units)), rateId).toBe(charged)
    }
  })
})

describe("the cloud plugin's Speaker View route prices through the host (tk.http.unitRatePrice)", () => {
  const tk = buildToolkit()
  const unitRatePrice = tk.http.unitRatePrice!
  // What the plugin's route reserves for an edit of 7 minutes on `id`: the
  // member's base, marked up by the credit guard's markup (`applyCreditMarkup`
  // is "the same configured markup used by creditGuard").
  const routeCharge = async (id: string) => tk.http.applyCreditMarkup(id, (await unitRatePrice(id, 7)).baseCredits)

  it("the member exists on this host", () => {
    expect(typeof tk.http.unitRatePrice).toBe("function")
  })

  it.each(SPEAKER_VIEW_CREDIT_IDS.map((id) => [id] as const))("%s: an admin row moves the route's charge and its quote together", async (id) => {
    const { unitBaseCredits, baseCredits } = await unitRatePrice(id, 7)
    // The row the job stamps for the handler's commit is the admin row…
    expect(unitBaseCredits).toBe(rows.get(id))
    expect(baseCredits).toBe(quoteBaseCredits(rows.get(id)!, 7))
    const charged = await routeCharge(id)
    // …and the reserve is the quote (batch table and single GET), the workflow run's charge, and off the code's price.
    expect(chargedCredits(await getChargedPriceTable(), unitQuoteCreditId(id, 7))).toBe(charged)
    expect(await CreditsService.getModelCreditCost(unitQuoteCreditId(id, 7))).toBe(charged)
    expect(await CHARGES[id]!.charge()).toBe(charged)
    expect(charged).not.toBe(await markedUp(id, quoteBaseCredits(STATIC_CREDIT_COSTS[id]!, 7)))
  })

  it("a fractional row is stamped as it is and rounded up once in the reserve", async () => {
    const id = SPEAKER_VIEW_CREDIT_IDS[0]!
    rows.set(id, 2.5)
    invalidateModelPricingCache()
    // 7 minutes × 2.5 = 17.5 → 18, then marked up once.
    expect(await unitRatePrice(id, 7)).toEqual({ unitBaseCredits: 2.5, baseCredits: 18 })
    expect(await routeCharge(id)).toBe(await markedUp(id, 18))
    expect(await CreditsService.getModelCreditCost(unitQuoteCreditId(id, 7))).toBe(await routeCharge(id))
  })

  it("with no admin row, it falls back to the code's row, as the quote does", async () => {
    rows.clear()
    invalidateModelPricingCache()
    for (const id of SPEAKER_VIEW_CREDIT_IDS) {
      expect((await unitRatePrice(id, 7)).unitBaseCredits, id).toBe(STATIC_CREDIT_COSTS[id])
      expect(await routeCharge(id), id).toBe(await CreditsService.getModelCreditCost(unitQuoteCreditId(id, 7)))
    }
  })

  it("refuses units that are not a finite non-negative number", async () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) await expect(unitRatePrice("speaker-view", bad)).rejects.toThrow(/units/)
  })
})

/** Every call to `name` in a file (comments are not AST nodes, so they never count). */
function callsIn(rel: string, names: ReadonlySet<string>): string[] {
  const file = join(SRC, rel)
  const sf = parseText(file, readFileSync(file, "utf8"))
  const found: string[] = []
  walk(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text)) found.push(n.expression.text)
  })
  return found
}

/** Every identifier named `name` in a file. */
function identifiersIn(rel: string, names: ReadonlySet<string>): string[] {
  const file = join(SRC, rel)
  const sf = parseText(file, readFileSync(file, "utf8"))
  const found: string[] = []
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && names.has(n.text)) found.push(n.text)
  })
  return found
}

describe("each charge site prices through the function this suite drives", () => {
  // Site → the functions it must call to charge (each one held above).
  const SITES: Readonly<Record<string, readonly string[]>> = {
    "routes/trim-video.ts": ["unitRateBaseCredits"],
    "routes/loop-video.ts": ["unitRateBaseCredits"],
    "routes/combine-videos.ts": ["unitRateBaseCredits"],
    "routes/assemble-narrated-video.ts": ["unitRateBaseCredits"],
    "routes/apply-edl.ts": ["unitRateBaseCredits"],
    "routes/mask-composite.ts": ["maskCompositeBaseCredits"],
    "routes/extend-video.ts": ["ltxExtendBaseCredits"],
    "routes/video-retake.ts": ["ltxRetakeBaseCredits"],
    "routes/dubbing.ts": ["dubbingBaseCredits"],
    "services/workflow-engine/node-executor.ts": [
      "videoUtilityChargeBaseCredits",
      "maskCompositeBaseCredits",
      "ltxExtendBaseCredits",
      "ltxRetakeBaseCredits",
      "applyEdlCreditOverride",
      "speakerViewCreditOverride",
    ],
    // The library functions the sites call: each reads the row through the shared lookup.
    "lib/video-utility-credits.ts": ["unitRateBaseCredits"],
    "lib/mask-composite-length.ts": ["unitRateBaseCredits"],
    "lib/ltx-extend-credits.ts": ["unitRateBaseCredits"],
    "lib/ltx-retake-credits.ts": ["unitRateBaseCredits"],
    "lib/apply-edl-plan.ts": ["unitRateBaseCredits"],
    "lib/speaker-view-plan.ts": ["unitRatePrice"],
    // The cloud plugin's Speaker View route reserves through this member.
    "lib/private-plugins/toolkit.ts": ["unitRatePrice"],
    "lib/dubbing-span.ts": ["baseCreditCostFor"],
  }

  it.each(Object.entries(SITES))("%s", (rel, required) => {
    const called = new Set(callsIn(rel, new Set(required)))
    expect(required.filter((name) => !called.has(name))).toEqual([])
  })

  it("no route or workflow charge reads a code constant for a per-unit price", () => {
    // VIDEO_UTIL_PRICING stays legitimate where units are COUNTED (lib/video-utility-credits.ts);
    // a charge site never names it, nor the code rows.
    const CONSTANTS = new Set(["VIDEO_UTIL_PRICING", "SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE", "STATIC_CREDIT_COSTS", "APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE"])
    const offenders = Object.keys(SITES)
      .filter((rel) => rel.startsWith("routes/") || rel.startsWith("services/"))
      .flatMap((rel) => identifiersIn(rel, CONSTANTS).map((name) => `${rel}: ${name}`))
    expect(offenders).toEqual([])
  })
})
