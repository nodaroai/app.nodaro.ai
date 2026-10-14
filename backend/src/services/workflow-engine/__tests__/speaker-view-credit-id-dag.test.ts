/**
 * A workflow run prices a Speaker View node on the row of its QUALITY and its
 * PRICE TIER (C4, decided 2026-10-10) at both points the run touches credits:
 * the reserve id the payload builder names (which the node executor checks
 * and reserves on, and the job carries as `reservedCreditId`) and the
 * per-minute base `speakerViewCreditOverride` reads, marks up and stamps for
 * the handler's commit. The two must name the SAME row; the job keeps its one
 * name, `speaker-view`.
 *
 * The rates in the first block are SENTINELS, not prices: what is under test
 * is which row each point reads. The second block runs the real rates.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Edl } from "@nodaro/shared/edl"

const m = vi.hoisted(() => ({
  rate: undefined as Record<string, number> | undefined,
  rateIds: [] as string[],
  markupIds: [] as string[],
  markup: (base: number) => base,
}))

vi.mock("@/ee/billing/credits.js", async () => {
  const { SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE } = await import("../../../lib/speaker-view-plan.js")
  return {
    getModelCreditBaseCost: async (id: string) => {
      m.rateIds.push(id)
      const table = m.rate ?? (SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE as Record<string, number>)
      return { creditCost: table[id], isEnabled: true, tierRestriction: null }
    },
  }
})
vi.mock("@/ee/billing/service-margin.js", () => ({
  applyServiceMarkup: (base: number, _settings: unknown, id: string) => {
    m.markupIds.push(id)
    return m.markup(base)
  },
}))
vi.mock("@/lib/app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-settings.js")>()),
  getAppSettings: async () => ({}),
}))

import { buildPayload } from "../payload-builder.js"
import { SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE, speakerViewBaseCredits, speakerViewCreditOverride } from "../../../lib/speaker-view-plan.js"
import type { SimpleNode } from "../types.js"

const cam = (id: string) => ({ id, url: `https://media.test/${id}.mp4`, kind: "video" as const })
const MIC = { id: "mic", url: "https://media.test/mic.wav", kind: "audio" as const, role: "master-audio" }

/** `n` speakers on `n` cameras, one segment each, taking turns until `totalMs`. */
function edit(n: number, totalMs: number): Edl {
  const ids = ["a", "b", "c", "d", "e", "f"].slice(0, n)
  const segMs = 20_000
  const segments = Array.from({ length: Math.ceil(totalMs / segMs) }, (_, i) => {
    const inMs = i * segMs
    return { id: `s${i}`, inMs, outMs: Math.min(totalMs, inMs + segMs), video: ids[i % n]!, speaker: `S${i % n}` }
  })
  return { version: 1, clock: "master", sources: [MIC, ...ids.map(cam)], segments } as Edl
}

/** 3 min 10 s of output → 4 billed minutes. */
const OUTPUT_MS = 190_000

beforeEach(() => {
  m.rate = { "speaker-view": 1000, "speaker-view:proxy": 7, "speaker-view:complex": 5000, "speaker-view:complex:proxy": 11 }
  m.rateIds = []
  m.markupIds = []
  m.markup = (base) => base
})

const run = (data: Record<string, unknown>, e: Edl) => {
  const node: SimpleNode = { id: "sv", type: "speaker-view", data }
  return buildPayload(node, "job-1", { edl: JSON.stringify(e) }, "usage-1")
}

describe("speaker-view in a workflow run — the credit id follows quality AND tier", () => {
  it.each([
    { name: "two speakers side by side, final", data: { layout: "side-by-side" }, n: 2, id: "speaker-view", base: 1000 * 4 },
    { name: "two speakers side by side, preview", data: { layout: "side-by-side", quality: "proxy" }, n: 2, id: "speaker-view:proxy", base: 7 * 4 },
    { name: "one camera at a time (auto, no hints), final", data: {}, n: 2, id: "speaker-view", base: 1000 * 4 },
    { name: "a grid of three, final", data: { layout: "grid" }, n: 3, id: "speaker-view:complex", base: 5000 * 4 },
    { name: "a grid of six, preview", data: { layout: "grid", quality: "proxy" }, n: 6, id: "speaker-view:complex:proxy", base: 11 * 4 },
    { name: "single with a Zoom switch, final", data: { layout: "single", switchType: "zoom" }, n: 2, id: "speaker-view:complex", base: 5000 * 4 },
  ])("$name → reserved on $id, priced and marked up on the same row", async ({ data, n, id, base }) => {
    const result = run(data, edit(n, OUTPUT_MS))
    expect(result.jobName).toBe("speaker-view")
    expect(result.modelIdentifier).toBe(id)
    expect(result.payload.reservedCreditId).toBe(id)
    expect(await speakerViewCreditOverride(result.jobName, result.payload)).toBe(base)
    expect(m.rateIds).toEqual([id])
    expect(m.markupIds).toEqual([id])
  })

  it("stamps the per-minute base it reserved at, for the handler's commit of the rendered length", async () => {
    const result = run({ layout: "grid", quality: "proxy" }, edit(3, OUTPUT_MS))
    await speakerViewCreditOverride(result.jobName, result.payload)
    expect(result.payload.reservedCreditsPerMinute).toBe(11)
  })

  it("a payload that names no row reserves on its quality's dearer row", async () => {
    const payload: Record<string, unknown> = { edl: edit(2, 60_000), quality: "proxy" }
    expect(await speakerViewCreditOverride("speaker-view", payload)).toBe(11)
    expect(m.rateIds).toEqual(["speaker-view:complex:proxy"])
  })

  it("prices nothing for any other job, nor without an edit", async () => {
    expect(await speakerViewCreditOverride("apply-edl", { edl: edit(2, 60_000), reservedCreditId: "speaker-view" })).toBeUndefined()
    expect(await speakerViewCreditOverride("speaker-view", { reservedCreditId: "speaker-view" })).toBeUndefined()
    expect(m.rateIds).toEqual([])
  })
})

describe("the two reserve sites agree (C4): the plugin route's BASE, marked up, is the run's reserve", () => {
  beforeEach(() => {
    m.rate = undefined // the real rows
    m.markup = (base) => Math.ceil(base * 1.3) // any markup: both sites apply the guard's, on the same id
  })

  it.each([
    { data: { layout: "side-by-side" }, n: 2, ms: 12 * 60_000 },
    { data: { layout: "side-by-side", quality: "proxy" }, n: 2, ms: 12 * 60_000 + 1 },
    { data: { layout: "grid" }, n: 6, ms: 45 * 60_000 + 30_000 },
    { data: { layout: "grid", quality: "proxy" }, n: 4, ms: 30_000 },
    { data: { layout: "single", switchType: "zoom", quality: "proxy" }, n: 2, ms: 8 * 60_000 + 10_000 },
  ])("%j", async ({ data, n, ms }) => {
    const e = edit(n, ms)
    const result = run(data, e)
    const routeBase = speakerViewBaseCredits(e, result.payload.reservedCreditId as never)
    expect(await speakerViewCreditOverride(result.jobName, result.payload)).toBe(m.markup(routeBase))
    expect(result.payload.reservedCreditsPerMinute).toBe(SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE[result.payload.reservedCreditId as keyof typeof SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE])
  })
})
