/**
 * A workflow run prices an Apply EDL node on the id of its QUALITY — a proxy
 * (preview) on `apply-edl:proxy`, a final on `apply-edl`, for a video and an
 * audio output alike — at both points the run touches credits: the reserve id
 * the payload builder names (which the node executor checks and reserves on)
 * and the per-minute base `applyEdlCreditOverride` reads and marks up. The two
 * must name the SAME row, and the job keeps its one name, `apply-edl`.
 *
 * The rates below are SENTINELS, not prices: what is under test is which row
 * each point reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Edl } from "@nodaro/shared"

const m = vi.hoisted(() => ({
  rate: { "apply-edl": 1000, "apply-edl:proxy": 7 } as Record<string, number>,
  rateIds: [] as string[],
  markupIds: [] as string[],
}))

vi.mock("@/ee/billing/credits.js", () => ({
  getModelCreditBaseCost: async (id: string) => {
    m.rateIds.push(id)
    return { creditCost: m.rate[id], isEnabled: true, tierRestriction: null }
  },
}))
vi.mock("@/ee/billing/service-margin.js", () => ({
  applyServiceMarkup: (base: number, _settings: unknown, id: string) => {
    m.markupIds.push(id)
    return base
  },
}))
vi.mock("@/lib/app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-settings.js")>()),
  getAppSettings: async () => ({}),
}))

import { buildPayload } from "../payload-builder.js"
import { applyEdlCreditOverride } from "../../../lib/apply-edl-plan.js"
import type { SimpleNode } from "../types.js"

/** 3 min 10 s of output → 4 billed minutes. */
const OUTPUT_MS = 190_000
const VIDEO_EDL: Edl = {
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://media.test/a.mp4", kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: OUTPUT_MS, video: "A", audio: "A" }],
}
const AUDIO_EDL: Edl = {
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://media.test/a.m4a", kind: "audio" }],
  segments: [{ id: "s0", inMs: 0, outMs: OUTPUT_MS, audio: "A" }],
}

beforeEach(() => {
  m.rateIds = []
  m.markupIds = []
})

describe("apply-edl in a workflow run — the credit id follows the render's quality", () => {
  it.each([
    { name: "a video proxy", data: { output: "video", quality: "proxy" }, edl: VIDEO_EDL, id: "apply-edl:proxy", base: 7 * 4 },
    { name: "an audio proxy (one id per quality, both outputs)", data: { output: "audio", quality: "proxy" }, edl: AUDIO_EDL, id: "apply-edl:proxy", base: 7 * 4 },
    { name: "a video final", data: { output: "video", quality: "final" }, edl: VIDEO_EDL, id: "apply-edl", base: 1000 * 4 },
    { name: "an audio final", data: { output: "audio", quality: "final" }, edl: AUDIO_EDL, id: "apply-edl", base: 1000 * 4 },
    { name: "no quality (the final, by default)", data: {}, edl: VIDEO_EDL, id: "apply-edl", base: 1000 * 4 },
  ])("$name → reserved on $id, priced and marked up on the same row", async ({ data, edl, id, base }) => {
    const node: SimpleNode = { id: "ae", type: "apply-edl", data }
    const result = buildPayload(node, "job-1", { edl: JSON.stringify(edl) }, "usage-1")
    expect(result.jobName).toBe("apply-edl")
    expect(result.modelIdentifier).toBe(id)
    expect(await applyEdlCreditOverride(result.jobName, result.payload)).toBe(base)
    expect(m.rateIds).toEqual([id])
    expect(m.markupIds).toEqual([id])
  })

  it("prices nothing for any other job", async () => {
    expect(await applyEdlCreditOverride("combine-videos", { edl: VIDEO_EDL, quality: "proxy" })).toBeUndefined()
    expect(m.rateIds).toEqual([])
  })
})
