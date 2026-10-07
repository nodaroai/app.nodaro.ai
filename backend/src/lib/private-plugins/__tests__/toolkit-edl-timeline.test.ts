/**
 * `tk.ffmpeg.renderEdlTimeline` — the EDL timeline lent to a plugin that
 * draws its own picture (Speaker View C2.0, SV1 b). The member threads the
 * plugin's picture, framing, canvas and label to core's timeline, uploads the
 * render plain under the job's id (tracked to its owner) with a thumbnail, and
 * cleans up. It is additive-optional: a plugin feature-detects it, so no
 * capability marker and no CONTRACT_VERSION bump.
 */
import { describe, it, expect, vi, beforeEach, expectTypeOf } from "vitest"

const fx = vi.hoisted(() => ({
  render: vi.fn(),
  upload: vi.fn(),
  thumb: vi.fn(),
  rm: vi.fn(),
}))

vi.mock("../../../providers/video/edl-timeline.js", () => ({ APPLY_EDL_LABEL: "apply-edl", renderEdlTimeline: fx.render }))
vi.mock("../../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../storage.js")>()),
  uploadFileToR2: fx.upload,
}))
vi.mock("../../../workers/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../workers/shared.js")>()),
  generateAndUploadThumbnail: fx.thumb,
}))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, promises: { ...actual.promises, rm: fx.rm } }
})

import { buildToolkit } from "../toolkit.js"
import { isDeterministicJobError } from "../../deterministic-job-error.js"
import { CONTRACT_VERSION, type PluginEdlPictureContext, type PluginEdlPictureFragment, type PluginEdlPictureSlot, type PluginEdlTimelineOptions, type PluginFfmpegToolkit } from "../types.js"
import type { EdlTimelineOptions } from "../../../providers/video/edl-timeline.js"
import type { EdlPictureContext, EdlPictureFragment, EdlPictureSlot } from "../../../providers/video/edl-picture.js"

const EDL = { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "A" }] } as never

describe("tk.ffmpeg.renderEdlTimeline", () => {
  beforeEach(() => {
    fx.render.mockReset().mockResolvedValue({ outputPath: "/work/speaker-view-x/chunk-0.mp4", durationMs: 1000 })
    fx.upload.mockReset().mockResolvedValue("https://r2.test/videos/job-1.mp4")
    fx.thumb.mockReset().mockResolvedValue("https://r2.test/thumbnails/job-1.png")
    fx.rm.mockReset().mockResolvedValue(undefined)
  })

  it("is on the host's toolkit, without a contract bump", () => {
    expect(typeof buildToolkit().ffmpeg.renderEdlTimeline).toBe("function")
    expect(CONTRACT_VERSION).toBe(1)
  })

  it("renders on core's timeline with the plugin's picture, framing, canvas and label, then uploads plain with a thumbnail", async () => {
    const picture = vi.fn(() => ({ chain: "null" }))
    const regions = [{ source: "A", speaker: "Host", region: { x: 0, y: 0, w: 0.5, h: 1 } }]
    const regionFor = vi.fn(() => ({ x: 0.2, y: 0, w: 0.4, h: 1 }))
    const onProgress = vi.fn()
    const res = await buildToolkit().ffmpeg.renderEdlTimeline!({
      edl: EDL, quality: "proxy", jobId: "job-1", jobUserId: "user-1",
      picture, speakerRegions: regions, regionFor, canvas: { width: 720, height: 1280 }, label: "speaker-view", onProgress,
    })
    expect(fx.render).toHaveBeenCalledWith({
      edl: EDL, output: "video", quality: "proxy", jobId: "job-1", jobUserId: "user-1", label: "speaker-view",
      picture, speakerRegions: regions, regionFor, canvas: { width: 720, height: 1280 }, onProgress,
    })
    expect(fx.upload).toHaveBeenCalledWith("/work/speaker-view-x/chunk-0.mp4", "job-1", "video", "user-1")
    expect(fx.thumb).toHaveBeenCalledWith("https://r2.test/videos/job-1.mp4", "job-1", "user-1")
    expect(res).toEqual({ url: "https://r2.test/videos/job-1.mp4", thumbnailUrl: "https://r2.test/thumbnails/job-1.png", durationMs: 1000 })
    expect(fx.rm).toHaveBeenCalledWith("/work/speaker-view-x", { recursive: true, force: true })
  })

  it("renders sound with the plugin's label and makes no thumbnail for it", async () => {
    await buildToolkit().ffmpeg.renderEdlTimeline!({ edl: EDL, quality: "final", jobId: "job-2", output: "audio", label: "speaker-view" })
    expect(fx.render).toHaveBeenCalledWith({ edl: EDL, output: "audio", quality: "final", jobId: "job-2", jobUserId: undefined, label: "speaker-view" })
    expect(fx.upload).toHaveBeenCalledWith(expect.any(String), "job-2", "audio", undefined)
    expect(fx.thumb).not.toHaveBeenCalled()
  })

  it("cleans up even when the upload fails", async () => {
    fx.upload.mockRejectedValue(new Error("r2 down"))
    await expect(buildToolkit().ffmpeg.renderEdlTimeline!({ edl: EDL, quality: "final", jobId: "j", label: "speaker-view" })).rejects.toThrow("r2 down")
    expect(fx.rm).toHaveBeenCalled()
  })

  // Decided 2026-10-06: a plugin names its OWN render, so its checkpoints
  // (`<label>-cache/`), work dir and logs never mix with Apply EDL's
  // `apply-edl-cache/`. No default: a missing, malformed or borrowed label is
  // refused deterministically (fails now, no retry) before anything renders.
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a string", 42],
    ["Apply EDL's own label", "apply-edl"],
    ["a path", "../x"],
    ["uppercase", "Speaker-View"],
    ["a leading digit", "1view"],
    ["a trailing hyphen", "speaker-"],
    ["a doubled hyphen", "speaker--view"],
    ["an underscore", "speaker_view"],
    ["longer than 40 characters", "a".repeat(41)],
  ])("refuses a label that is %s, deterministically and before rendering", async (_why, label) => {
    const run = buildToolkit().ffmpeg.renderEdlTimeline!({ edl: EDL, quality: "final", jobId: "j", label } as unknown as PluginEdlTimelineOptions)
    const err = await run.then(() => null, (e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/^renderEdlTimeline: label/)
    expect(fx.render).not.toHaveBeenCalled()
    expect(fx.upload).not.toHaveBeenCalled()
  })

  it("accepts a short slug of the plugin's own", async () => {
    for (const label of ["speaker-view", "sv2", "a", "apply-edl-preview", "a".repeat(40)]) {
      fx.render.mockClear()
      await buildToolkit().ffmpeg.renderEdlTimeline!({ edl: EDL, quality: "final", jobId: "j", label })
      expect(fx.render).toHaveBeenCalledWith(expect.objectContaining({ label }))
    }
  })

  it("the contract's options mirror the timeline's (a plugin's picture is the core builder's shape)", () => {
    expectTypeOf<NonNullable<PluginFfmpegToolkit["renderEdlTimeline"]>>().parameter(0).toEqualTypeOf<PluginEdlTimelineOptions>()
    type Core = Omit<EdlTimelineOptions, "checkpoint" | "output" | "maxSegmentsPerChunk" | "chunkThreshold" | "pictureSlots">
    type Plugin = Omit<PluginEdlTimelineOptions, "output">
    expectTypeOf<keyof Plugin>().toEqualTypeOf<keyof Core>()
    expectTypeOf<NonNullable<PluginEdlTimelineOptions["picture"]>>().toExtend<NonNullable<EdlTimelineOptions["picture"]>>()
    expectTypeOf<NonNullable<PluginEdlTimelineOptions["regionFor"]>>().toExtend<NonNullable<EdlTimelineOptions["regionFor"]>>()
    // The picture's context is mirrored field for field: a field core hands the
    // builder (each slot's source-clock span, the frame grid's lead — P3.8t)
    // that the mirror lacks is one a plugin can never read. The `toExtend`
    // above cannot see it (a parameter type is contravariant).
    expectTypeOf<keyof PluginEdlPictureContext>().toEqualTypeOf<keyof EdlPictureContext>()
    expectTypeOf<keyof PluginEdlPictureSlot>().toEqualTypeOf<keyof EdlPictureSlot>()
    expectTypeOf<PluginEdlPictureSlot["sourceSpan"]>().toEqualTypeOf<EdlPictureSlot["sourceSpan"]>()
    // The fragment is mirrored whole, its optional memory hint included
    // (decided 2026-10-07): a hint the mirror lacked would be one a plugin
    // could never send, and its zoom slices would reserve too little.
    expectTypeOf<PluginEdlPictureFragment>().toEqualTypeOf<EdlPictureFragment>()
    expectTypeOf<NonNullable<PluginEdlPictureFragment["memoryHint"]>>().toEqualTypeOf<{ readonly zoom?: boolean }>()
    // Required for a plugin (decided 2026-10-06); only core's own caller may
    // lean on the timeline's Apply EDL default.
    expectTypeOf<PluginEdlTimelineOptions["label"]>().toEqualTypeOf<string>()
    // @ts-expect-error — a plugin call without its own label does not typecheck
    const noLabel: PluginEdlTimelineOptions = { edl: EDL, quality: "final", jobId: "j" }
    void noLabel
    expect(true).toBe(true)
  })
})
