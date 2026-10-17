/**
 * A workflow run reserves a Speaker Frames job itself (P3.7, decided
 * 2026-10-16): the dispatch never meets the plugin's route, so
 * `speakerFramesCreditOverride` prices the payload the builder made — the
 * frames the server counts (the edit's spans on the ticked cameras, or a bare
 * video's PROBED length; never a number the client sent), in started blocks of
 * 1,000, at the `speaker-frames` row — marks it up once and stamps the row on
 * the job for the handler's commit on the frames it actually sampled.
 *
 * The first block's rate is a SENTINEL, not a price: what is under test is
 * that the reserve reads the row. The second block runs the real rate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Edl } from "@nodaro/shared/edl"

const m = vi.hoisted(() => ({
  rate: undefined as number | undefined,
  rateIds: [] as string[],
  markupIds: [] as string[],
  markup: (base: number) => base,
}))

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => true,
}))
vi.mock("@/ee/billing/credits.js", async () => {
  const { SPEAKER_FRAMES_CREDITS_PER_BLOCK } = await import("@nodaro/render-rules")
  return {
    getModelCreditBaseCost: async (id: string) => {
      m.rateIds.push(id)
      return { creditCost: m.rate ?? SPEAKER_FRAMES_CREDITS_PER_BLOCK, isEnabled: true, tierRestriction: null }
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

import { SPEAKER_FRAMES_CREDITS_PER_BLOCK, speakerFramesBaseCredits } from "@nodaro/render-rules"
import { buildPayload } from "../payload-builder.js"
import { speakerFramesCreditOverride } from "../../../lib/speaker-frames-plan.js"
import type { SimpleNode } from "../types.js"

const MIC = { id: "mic", url: "https://media.test/mic.wav", kind: "audio" as const, role: "master-audio" }
const cam = (id: string) => ({ id, url: `https://media.test/${id}.mp4`, kind: "video" as const })

/** One wide camera, 90 kept stretches of 55 s a minute apart: 10,616 frames, 11 blocks (the docs' example). */
const TIGHTEN_90: Edl = {
  version: 1,
  clock: "master",
  sources: [MIC, cam("wide")],
  segments: Array.from({ length: 90 }, (_, k) => ({ id: `s${k}`, inMs: k * 60_000, outMs: k * 60_000 + 55_000, video: "wide" })),
} as Edl

/** Two cameras over 10 minutes: each samples every kept span, 0–602 s (1,204 frames each). */
const TWO_CAMS: Edl = {
  version: 1,
  clock: "master",
  sources: [MIC, cam("a"), cam("b")],
  segments: [{ id: "s0", inMs: 0, outMs: 300_000, video: "a" }, { id: "s1", inMs: 300_000, outMs: 600_000, video: "b" }],
} as Edl

const node = (data: Record<string, unknown> = {}): SimpleNode => ({ id: "sf", type: "speaker-frames", data })
const build = (inputs: Record<string, unknown>, data: Record<string, unknown> = {}) =>
  buildPayload(node(data), "job-1", inputs, "usage-1") as { jobName: string; payload: Record<string, unknown>; modelIdentifier: string }

beforeEach(() => {
  m.rate = 7
  m.rateIds = []
  m.markupIds = []
  m.markup = (base) => base
})

describe("speaker-frames in a workflow run — the reserve reads the row, per started block", () => {
  it("names the one row, prices the edit's blocks at it, and stamps that rate for the commit", async () => {
    const { jobName, payload, modelIdentifier } = build({ edl: JSON.stringify(TIGHTEN_90) })
    expect([jobName, modelIdentifier, payload.reservedCreditId]).toEqual(["speaker-frames", "speaker-frames", "speaker-frames"])
    expect(await speakerFramesCreditOverride(jobName, payload, async () => { throw new Error("an edit is never probed") })).toBe(7 * 11)
    expect(payload.reservedCreditsPerBlock).toBe(7)
    expect(m.rateIds).toEqual(["speaker-frames"])
    expect(m.markupIds).toEqual(["speaker-frames"])
  })

  it("marks the base up once, at the row", async () => {
    m.markup = (base) => Math.ceil(base * 1.1)
    const { jobName, payload } = build({ edl: JSON.stringify(TIGHTEN_90) })
    expect(await speakerFramesCreditOverride(jobName, payload, async () => 0)).toBe(Math.ceil(7 * 11 * 1.1))
  })

  it("counts only the ticked cameras (the node's untick list, as the payload carries it)", async () => {
    const both = build({ edl: JSON.stringify(TWO_CAMS) })
    const one = build({ edl: JSON.stringify(TWO_CAMS) }, { excludeSourceIds: ["b"] })
    // 2,408 frames → 3 blocks; one camera unticked, 1,204 → 2.
    expect(await speakerFramesCreditOverride(both.jobName, both.payload)).toBe(7 * 3)
    expect(await speakerFramesCreditOverride(one.jobName, one.payload)).toBe(7 * 2)
    expect(one.payload.excludeSourceIds).toEqual(["b"])
  })

  it("a bare video is probed on the server: its length × 2 frames", async () => {
    const { jobName, payload } = build({ videoUrl: "https://media.test/clip.mp4" })
    const probed: string[] = []
    // 2,000.4 s → 4,001 frames → 5 blocks.
    expect(await speakerFramesCreditOverride(jobName, payload, async (url) => (probed.push(url), 2_000.4))).toBe(7 * 5)
    expect(probed).toEqual(["https://media.test/clip.mp4"])
  })

  it("a bare video that cannot be probed is reserved at the 180 minutes one camera may give (the job then refuses it and refunds)", async () => {
    const { jobName, payload } = build({ videoUrl: "https://media.test/clip.mp4" })
    expect(await speakerFramesCreditOverride(jobName, payload, async () => { throw new Error("unreadable") })).toBe(7 * 22)
  })

  it("is undefined for any other job, so the override chain falls through", async () => {
    expect(await speakerFramesCreditOverride("speaker-view", { edl: TIGHTEN_90 })).toBeUndefined()
    expect(m.rateIds).toEqual([])
  })
})

describe("at the real rate — the docs' worked examples, before the markup", () => {
  beforeEach(() => {
    m.rate = undefined
  })

  it("the rate is 2 base credits a block", () => {
    expect(SPEAKER_FRAMES_CREDITS_PER_BLOCK).toBe(2)
  })

  it("a 90-minute episode tightened, one wide camera: 11 blocks, 22", async () => {
    const { jobName, payload } = build({ edl: JSON.stringify(TIGHTEN_90) })
    expect(await speakerFramesCreditOverride(jobName, payload)).toBe(22)
    expect(speakerFramesBaseCredits(10_616)).toBe(22)
  })

  it("a clip pack of 8 clips folds into one run: 960 frames, 1 block, 2", async () => {
    const clips = Array.from({ length: 8 }, (_, i) => JSON.stringify({
      version: 1, clock: "master", sources: [MIC, cam("wide")],
      segments: [{ id: "s0", inMs: i * 100_000 + 10_000, outMs: i * 100_000 + 66_000, video: "wide" }],
    }))
    const { jobName, payload } = build({ inputs: clips })
    expect(Array.isArray(payload.edl) && payload.edl.length).toBe(8)
    expect(await speakerFramesCreditOverride(jobName, payload)).toBe(2)
  })

  it("a 14-second bare video: 28 frames, the one-block minimum, 2", async () => {
    const { jobName, payload } = build({ videoUrl: "https://media.test/clip.mp4" })
    expect(await speakerFramesCreditOverride(jobName, payload, async () => 14)).toBe(2)
  })
})
