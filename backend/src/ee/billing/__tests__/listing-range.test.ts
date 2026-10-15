import { describe, it, expect, vi } from "vitest"

/**
 * A published app's listed price is a RANGE: "from" the saved settings (the
 * listing as it always was), "up to" the most expensive combination the app's
 * user can choose over the app's exposed fields — the publisher's restricted
 * values (`allowedValues`) where set, else every value the field takes. Each
 * combination is normalized per model the way the run normalizes it
 * (`normalizeNodeModelParams`), so a value one model does not take is priced as
 * what that model would run. Above LISTING_RANGE_MAX_COMBINATIONS the "up to" is
 * found per model by taking each other field at its priciest value.
 */
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => false,
}))

import { estimateWorkflowListingCredits, estimateWorkflowListingRange, type EstimateNode } from "../credits.js"
import { LISTING_RANGE_MAX_COMBINATIONS } from "../listing-range.js"

const field = (nodeId: string, f: string, allowedValues?: unknown[]) =>
  ({ type: "field", id: `${nodeId}-${f}`, nodeId, field: f, ...(allowedValues ? { allowedValues } : {}) })
const settings = (items: unknown[]) => ({ presentationSettings: { inputItems: items } })
const listing = (nodes: EstimateNode[]) => estimateWorkflowListingCredits(nodes, [], { publishType: "app", replaceableMediaNodeIds: new Set() })
const range = (nodes: EstimateNode[], items: unknown[]) =>
  estimateWorkflowListingRange(nodes, [], { publishType: "app", replaceableMediaNodeIds: new Set(), snapshotSettings: settings(items) })

const gv = (data: Record<string, unknown>): EstimateNode => ({ id: "gv", type: "generate-video", data: { provider: "seedance-2-5", duration: 8, resolution: "480p", ...data } })

describe("estimateWorkflowListingRange", () => {
  it("no exposed field: the ceiling is the floor", async () => {
    const r = await range([gv({})], [])
    expect(r.ceiling).toEqual(r.floor)
    expect(r.floor).toEqual(await listing([gv({})]))
  })

  it("a restricted field: up to its priciest allowed value", async () => {
    const r = await range([gv({})], [field("gv", "resolution", ["480p", "720p"])])
    expect(r.floor).toEqual(await listing([gv({})]))
    expect(r.ceiling.preview).toBe((await listing([gv({ resolution: "720p" })])).preview)
  })

  it("a value the node's model does not take is priced as the model runs it (normalized)", async () => {
    // Seedance 2.5 has no 4k: a run snaps it to its nearest band, 1080p.
    const r = await range([gv({})], [field("gv", "resolution", ["480p", "4k"])])
    expect(r.ceiling.preview).toBe((await listing([gv({ resolution: "1080p" })])).preview)
  })

  it("per allowed model: the model field and a model-dependent field are priced together", async () => {
    const r = await range([gv({})], [field("gv", "provider", ["seedance-2-5", "seedance-2-mini"]), field("gv", "resolution", ["480p", "1080p"])])
    const best = Math.max(
      (await listing([gv({ resolution: "1080p" })])).preview,
      (await listing([gv({ provider: "seedance-2-mini", resolution: "720p" })])).preview, // mini tops out at 720p
    )
    expect(r.ceiling.preview).toBe(best)
  })

  it("past the combination cap, each field is taken at its priciest value (exact for independent nodes)", async () => {
    const clip = (id: string): EstimateNode => ({ id, type: "generate-video", data: { provider: "seedance-2-5", duration: 4, resolution: "480p" } })
    const nodes = [clip("a"), clip("b"), clip("c")]
    const r = await range(nodes, [field("a", "duration"), field("b", "duration"), field("c", "duration")])
    // 3 × 31 durations is far past the cap: the per-field path ran.
    expect(31 ** 3).toBeGreaterThan(LISTING_RANGE_MAX_COMBINATIONS)
    const longest = (await listing([{ id: "a", type: "generate-video", data: { provider: "seedance-2-5", duration: 30, resolution: "480p" } }])).preview
    expect(r.ceiling.preview).toBe(3 * longest)
    expect(r.floor.preview).toBeLessThan(r.ceiling.preview)
  })

  it("a toggle is priced both ways", async () => {
    const t2v: EstimateNode = { id: "t", type: "text-to-video", data: { provider: "kling-3.0", duration: 5, sound: false, generateAudio: false } }
    const r = await range([t2v], [field("t", "generateAudio")])
    expect(r.ceiling.preview).toBeGreaterThanOrEqual(r.floor.preview)
  })
})
