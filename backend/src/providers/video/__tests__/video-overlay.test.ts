// backend/src/providers/video/__tests__/video-overlay.test.ts
/**
 * The provider's ORCHESTRATION (spec §4.2): what runs, in which order, and
 * how each failure is classified. ffmpeg, the downloads, the image reads and
 * the pre-fit are mocked; the shared contract, the gate and the graph builder
 * are real (the e2e file renders for real).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { basename } from "node:path"

const m = vi.hoisted(() => {
  /** `layerProbes[<file name>]`: what a video layer's probe returns (a base probe otherwise). */
  const state = { calls: [] as string[], inSlot: false, layerProbes: {} as Record<string, unknown> }
  return {
    state,
    downloadFile: vi.fn(),
    probeVideoOverlayBase: vi.fn(),
    runFfmpeg: vi.fn(),
    withFfmpegSlot: vi.fn(),
    fetchVideoOverlayImage: vi.fn(),
    inspectVideoOverlayImage: vi.fn(),
    prefitVideoOverlayLayer: vi.fn(),
    throwIfJobCancelled: vi.fn(),
  }
})
vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: m.downloadFile,
  probeVideoOverlayBase: m.probeVideoOverlayBase,
  runFfmpeg: m.runFfmpeg,
  withFfmpegSlot: m.withFfmpegSlot,
}))
vi.mock("../video-overlay-images.js", async (importOriginal) => ({
  // The REAL gate; only the two I/O steps are stubbed.
  ...(await importOriginal<typeof import("../video-overlay-images.js")>()),
  fetchVideoOverlayImage: m.fetchVideoOverlayImage,
  inspectVideoOverlayImage: m.inspectVideoOverlayImage,
}))
vi.mock("../video-overlay-prefit.js", () => ({ prefitVideoOverlayLayer: m.prefitVideoOverlayLayer }))
vi.mock("../../../lib/job-cancellation.js", () => ({ throwIfJobCancelled: m.throwIfJobCancelled }))

import { clampVideoOverlayLayers, renderVideoOverlay, type VideoOverlayJobPayload } from "../video-overlay.js"
import { DeterministicJobError, isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { VIDEO_OVERLAY_MAX_LAYER_VIDEO_BYTES, expandVideoOverlayLayer } from "@nodaro/shared/video"
import { canvasPeakMemoryMiB } from "../ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "../ffmpeg-threads.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "../ffmpeg-timeouts.js"

const WORK = "/w"
const PROBE = {
  width: 1920, height: 1080, rotation: 0, sar: 1, rFrameRate: "30/1", avgFrameRate: "30/1",
  streamDurationSec: 5, startTimeSec: 0, audioCodec: "aac" as string | null,
}
const PNG_2x1 = { bytes: 1000, svg: false, decodable: true, format: "png", width: 400, height: 200 }
/** A video layer's probe: a 1280×720 clip at 24 fps with sound. */
const LAYER_PROBE = { ...PROBE, width: 1280, height: 720, rFrameRate: "24/1", avgFrameRate: "24/1", streamDurationSec: 3 }
const A = "https://cdn.example/a.png"
const B = "https://cdn.example/b.png"
const V = "https://cdn.example/v.mp4"
// A run with a video layer carries the units it was charged for (the route / the workflow run write them):
// 12, the 60 s cap, unless a case says otherwise. An image-only run ignores the field.
const payload = (over: Partial<VideoOverlayJobPayload> = {}): VideoOverlayJobPayload => ({
  videoUrl: "https://cdn.example/base.mp4",
  layers: [
    { imageUrl: A, start: 1, end: 2, preset: "card" },
    { imageUrl: B, start: 0 },
  ],
  billedUnits: 12,
  ...over,
})
const ffmpegArgs = (): string[] => m.runFfmpeg.mock.calls[0]![0] as string[]

async function refusal(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run()
  } catch (err) {
    expect(isDeterministicJobError(err)).toBe(true)
    return err as Error
  }
  throw new Error("expected a refusal")
}

beforeEach(() => {
  vi.clearAllMocks()
  m.state.calls = []
  m.state.inSlot = false
  m.state.layerProbes = {}
  m.downloadFile.mockImplementation(async (_url: string, dest: string) => void m.state.calls.push(`download:${basename(dest)}`))
  m.probeVideoOverlayBase.mockImplementation(async (path: string) => {
    const name = basename(path)
    if (name === "input.mp4") return m.state.calls.push("probe"), { ...PROBE }
    m.state.calls.push(`probe:${name}`)
    return { ...((m.state.layerProbes[name] as typeof PROBE | undefined) ?? LAYER_PROBE) }
  })
  m.fetchVideoOverlayImage.mockImplementation(async (_url: string, _dest: string, ref: { layer: number }) => void m.state.calls.push(`fetch:${ref.layer}`))
  m.inspectVideoOverlayImage.mockImplementation(async (path: string) => (m.state.calls.push(`inspect:${basename(path)}`), { ...PNG_2x1 }))
  m.withFfmpegSlot.mockImplementation(async (fn: () => Promise<unknown>) => {
    m.state.calls.push("slot:enter")
    m.state.inSlot = true
    try {
      return await fn()
    } finally {
      m.state.inSlot = false
      m.state.calls.push("slot:exit")
    }
  })
  m.prefitVideoOverlayLayer.mockImplementation(async (_src: string, dest: string, size: { width: number; height: number }) => {
    m.state.calls.push(`prefit:${basename(dest)}:${m.state.inSlot ? "in-slot" : "NO-SLOT"}`)
    return { width: size.width, height: size.height }
  })
  m.throwIfJobCancelled.mockImplementation(async () => void m.state.calls.push("cancel-check"))
  m.runFfmpeg.mockImplementation(async () => (m.state.calls.push(`ffmpeg:${m.state.inSlot ? "IN-SLOT" : "own-slot"}`), ""))
})

describe("renderVideoOverlay — the order (spec §4.2)", () => {
  it("base → probe → images one at a time → ONE slot of pre-fits → cancel check → ONE render outside that slot", async () => {
    const result = await renderVideoOverlay(payload(), WORK)
    expect(m.state.calls).toEqual([
      "download:input.mp4",
      "probe",
      "fetch:0", "inspect:image-0",
      "fetch:1", "inspect:image-1",
      "slot:enter", "prefit:layer-0.png:in-slot", "prefit:layer-1.png:in-slot", "slot:exit",
      "cancel-check",
      "ffmpeg:own-slot",
    ])
    expect(result).toEqual({ outputPath: "/w/output.mp4", warnings: [], width: 1920, height: 1080, durationSec: 5 })
  })

  it("pre-fits each layer to its DRAWN size (card: contain 1296×648; default corner badge: 346×172)", async () => {
    await renderVideoOverlay(payload(), WORK)
    expect(m.prefitVideoOverlayLayer.mock.calls).toEqual([
      ["/w/image-0", "/w/layer-0.png", { width: 1296, height: 648 }, "contain"],
      ["/w/image-1", "/w/layer-1.png", { width: 346, height: 172 }, "contain"],
    ])
  })

  it("hands the builder the base, each window (an absent end = the stream duration) and the output", async () => {
    await renderVideoOverlay(payload(), WORK)
    const args = ffmpegArgs()
    expect(args.slice(0, 3)).toEqual(["-y", "-i", "/w/input.mp4"])
    expect(args.join(" ")).toContain("-framerate 30/1 -t 1.000 -i /w/layer-0.png")
    expect(args.join(" ")).toContain("-framerate 30/1 -t 5.000 -i /w/layer-1.png")
    expect(args.at(-1)).toBe("/w/output.mp4")
    expect(args).toContain("copy")
  })

  it("renders on the target canvas when outputAspect is set (contain pads with the colour)", async () => {
    const result = await renderVideoOverlay(payload({ outputAspect: "9:16", baseFit: "contain", backgroundColor: "#ff0000" }), WORK)
    expect([result.width, result.height]).toEqual([1080, 1920])
    expect(ffmpegArgs()[ffmpegArgs().indexOf("-filter_complex") + 1]).toContain("pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0xff0000[base]")
  })

  it("the canvas resolves the base's SAR (640×480 at 2:1 → 1280×480)", async () => {
    m.probeVideoOverlayBase.mockResolvedValueOnce({ ...PROBE, width: 640, height: 480, sar: 2 })
    const result = await renderVideoOverlay(payload(), WORK)
    expect([result.width, result.height]).toEqual([1280, 480])
  })
})

describe("renderVideoOverlay — validate + clamp (spec §4.2 step 4)", () => {
  it("refuses an invalid payload after the probe, before any image — the DAG path's last net", async () => {
    const err = await refusal(() => renderVideoOverlay(payload({ layers: [{ imageUrl: A, start: 3, end: 2, slot: 4 }] }), WORK))
    expect(err.message).toBe("Layer 4: end (2 s) must be after start (3 s)")
    expect(m.state.calls).toEqual(["download:input.mp4", "probe"])
  })

  it("a probe refusal stops everything: no image is fetched", async () => {
    m.probeVideoOverlayBase.mockRejectedValueOnce(Object.assign(new Error("The base input is not a video"), { deterministic: true }))
    const err = await refusal(() => renderVideoOverlay(payload(), WORK))
    expect(err.message).toBe("The base input is not a video")
    expect(m.fetchVideoOverlayImage).not.toHaveBeenCalled()
  })

  it("clips an end past the video and skips a start at or after it — a skipped image is never fetched", async () => {
    const result = await renderVideoOverlay(payload({ layers: [{ imageUrl: A, start: 1, end: 9 }, { imageUrl: B, start: 5, slot: 2 }] }), WORK)
    expect(result.warnings).toEqual([
      { layer: 0, code: "clipped", detail: "ends at 9 s, clipped to the video end (5.00 s)" },
      { layer: 1, slot: 2, code: "skipped", detail: "starts at 5 s, after the video ends (5.00 s)" },
    ])
    expect(m.state.calls).not.toContain("fetch:1")
    expect(ffmpegArgs().join(" ")).toContain("-t 4.000 -i /w/layer-0.png")
  })

  it("every layer after the end → one deterministic refusal, nothing fetched", async () => {
    const err = await refusal(() => renderVideoOverlay(payload({ layers: [{ imageUrl: A, start: 6 }, { imageUrl: B, start: 5 }] }), WORK))
    expect(err.message).toBe("Every layer starts after the video ends (5.00 s)")
    expect(m.fetchVideoOverlayImage).not.toHaveBeenCalled()
  })

  it("clampVideoOverlayLayers keeps the index of every kept layer", () => {
    const layers = [expandVideoOverlayLayer({ imageUrl: A, start: 7 }), expandVideoOverlayLayer({ imageUrl: B, start: 1, end: 3 })]
    expect(clampVideoOverlayLayers(layers, 5).kept.map((k) => [k.index, k.end])).toEqual([[1, 3]])
  })
})

describe("renderVideoOverlay — images, warnings", () => {
  it("a refused image stops the next download", async () => {
    m.inspectVideoOverlayImage.mockResolvedValueOnce({ bytes: 10, svg: true, decodable: false })
    const err = await refusal(() => renderVideoOverlay(payload(), WORK))
    expect(err.message).toBe("layers[0]: SVG images are not supported by Video Overlay yet — rasterise it with Image Overlay first")
    expect(m.state.calls).not.toContain("fetch:1")
    expect(m.runFfmpeg).not.toHaveBeenCalled()
  })

  it("an image that passes the header check but fails to decode in the pre-fit → the gate's 'not an image', once, libvips' text for the operator only", async () => {
    m.prefitVideoOverlayLayer.mockRejectedValueOnce(new Error("VipsJpeg: premature end of JPEG image"))
    const err = await refusal(() => renderVideoOverlay(payload(), WORK))
    expect(err.message).toBe("layers[0]: not an image (PNG, JPEG or WebP)")
    expect((err as { internalDetails?: string }).internalDetails).toBe("VipsJpeg: premature end of JPEG image")
    expect(m.runFfmpeg).not.toHaveBeenCalled()
  })

  it("a canvas layer's decode failure is labelled by its slot", async () => {
    m.prefitVideoOverlayLayer.mockImplementationOnce(async (_s: string, _d: string, size: { width: number; height: number }) => ({ ...size }))
    m.prefitVideoOverlayLayer.mockRejectedValueOnce(new Error("pngload: end of stream"))
    const layers = [{ imageUrl: A, start: 0, slot: 1 }, { imageUrl: B, start: 0, slot: 4 }]
    const err = await refusal(() => renderVideoOverlay(payload({ layers }), WORK))
    expect(err.message).toBe("Layer 4: not an image (PNG, JPEG or WebP)")
  })

  it("a system error in the pre-fit (errno code) is not the image's fault: rethrown as is, so BullMQ retries", async () => {
    m.prefitVideoOverlayLayer.mockRejectedValueOnce(Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }))
    const err = await renderVideoOverlay(payload(), WORK).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(false)
    expect((err as Error).message).toBe("ENOSPC: no space left on device")
  })

  it("collects clamp → image → audio warnings, in that order", async () => {
    m.probeVideoOverlayBase.mockResolvedValueOnce({ ...PROBE, audioCodec: "pcm_s16le" })
    m.inspectVideoOverlayImage.mockResolvedValueOnce({ ...PNG_2x1 }).mockResolvedValueOnce({ ...PNG_2x1, format: "webp", pages: 3 })
    const result = await renderVideoOverlay(payload({ layers: [{ imageUrl: A, start: 0, end: 8 }, { imageUrl: B, start: 1 }] }), WORK)
    expect(result.warnings).toEqual([
      { layer: 0, code: "clipped", detail: "ends at 8 s, clipped to the video end (5.00 s)" },
      { layer: 1, code: "animated_first_frame", detail: "animated image (3 frames): its first frame is used" },
      { code: "audio_reencoded", detail: "the base's pcm_s16le audio was re-encoded to AAC" },
    ])
    expect(ffmpegArgs().join(" ")).toContain("-c:a aac -b:a 128k")
  })
})

describe("renderVideoOverlay — the render (spec §4.2 step 9)", () => {
  it("a cancel during the downloads costs no render", async () => {
    m.throwIfJobCancelled.mockRejectedValueOnce(new Error("Job job-1 was cancelled"))
    await expect(renderVideoOverlay(payload(), WORK)).rejects.toThrow("Job job-1 was cancelled")
    expect(m.runFfmpeg).not.toHaveBeenCalled()
  })

  it("the 10-minute watchdog → 'Render exceeded the 10-minute limit', ffmpeg's tail kept for the operator", async () => {
    m.runFfmpeg.mockRejectedValueOnce(Object.assign(new Error("ffmpeg failed: frame= 9000"), { killed: true, timedOut: true }))
    const err = await refusal(() => renderVideoOverlay(payload(), WORK))
    expect(err.message).toBe("Render exceeded the 10-minute limit")
    expect((err as { internalDetails?: string }).internalDetails).toBe("ffmpeg failed: frame= 9000")
  })

  it.each([
    ["any ffmpeg failure", {}],
    ["a maxBuffer kill (not the watchdog)", { killed: true, timedOut: false }],
  ])("%s → one generic deterministic message, ffmpeg's tail in internalDetails", async (_name, flags) => {
    m.runFfmpeg.mockRejectedValueOnce(Object.assign(new Error("ffmpeg failed: Error reinitializing filters!"), flags))
    const err = await refusal(() => renderVideoOverlay(payload(), WORK))
    expect(err.message).toBe("Video Overlay could not render this combination of video and layers")
    expect((err as { internalDetails?: string }).internalDetails).toBe("ffmpeg failed: Error reinitializing filters!")
  })
})

const filterOf = (): string => ffmpegArgs()[ffmpegArgs().indexOf("-filter_complex") + 1]!
/** The overlay line that draws a layer's rect (centred on it). */
const drawnAt = (left: number, top: number, width: number, height: number): string =>
  `overlay=x='${left}+(${width}-overlay_w)/2':y='${top}+(${height}-overlay_h)/2':eof_action=pass`
const PORTRAIT = { outputAspect: "9:16" as const }

describe("renderVideoOverlay — video layers: fetch, probe, order", () => {
  it("a video layer is downloaded under its own cap and probed in its turn, never pre-fitted; only the image enters the slot", async () => {
    await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0 }, { imageUrl: B, start: 0 }] }), WORK)
    expect(m.state.calls).toEqual([
      "download:input.mp4",
      "probe",
      "download:video-0", "probe:video-0",
      "fetch:1", "inspect:image-1",
      "slot:enter", "prefit:layer-1.png:in-slot", "slot:exit",
      "cancel-check",
      "ffmpeg:own-slot",
    ])
    expect(m.downloadFile).toHaveBeenCalledWith(V, "/w/video-0", { maxBytes: VIDEO_OVERLAY_MAX_LAYER_VIDEO_BYTES })
    expect(m.prefitVideoOverlayLayer).toHaveBeenCalledTimes(1)
    const args = ffmpegArgs().join(" ")
    expect(args).toContain("-y -i /w/input.mp4 -i /w/video-0 -f image2 -loop 1 -framerate 30/1 -t 5.000 -i /w/layer-1.png")
  })

  it("a base past the 60 s cap with a video layer is refused before any layer is fetched (the last net; the route and the workflow run refuse it before charging)", async () => {
    m.probeVideoOverlayBase.mockImplementationOnce(async () => ({ ...PROBE, streamDurationSec: 61 }))
    const err = await refusal(() => renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0 }, { imageUrl: B, start: 0 }] }), WORK))
    expect(err.message).toBe("The base video is 61 seconds. A Video Overlay with a video layer takes a base of up to 60 seconds — trim it first.")
    expect(m.state.calls).toEqual(["download:input.mp4"])
    expect(m.fetchVideoOverlayImage).not.toHaveBeenCalled()
  })

  it("a base that has grown past the units the run was charged for is refused before any layer is fetched", async () => {
    m.probeVideoOverlayBase.mockImplementationOnce(async () => ({ ...PROBE, streamDurationSec: 30 }))
    const err = await refusal(() => renderVideoOverlay(payload({ billedUnits: 1, layers: [{ videoUrl: V, start: 0 }] }), WORK))
    expect(err.message).toBe("The base video is 30 seconds, longer than the 5 seconds this run was priced for — run it again")
    expect(m.state.calls).toEqual(["download:input.mp4"])
  })

  it("a re-measure up to half a second longer renders; past it, refused: billed for 10 s, downloaded 10.4 s / 10.6 s", async () => {
    m.probeVideoOverlayBase.mockImplementationOnce(async () => ({ ...PROBE, streamDurationSec: 10.4 }))
    await renderVideoOverlay(payload({ billedUnits: 2, layers: [{ videoUrl: V, start: 0 }] }), WORK)
    expect(m.runFfmpeg).toHaveBeenCalledTimes(1)
    m.probeVideoOverlayBase.mockImplementationOnce(async () => ({ ...PROBE, streamDurationSec: 10.6 }))
    const err = await refusal(() => renderVideoOverlay(payload({ billedUnits: 2, layers: [{ videoUrl: V, start: 0 }] }), WORK))
    expect(err.message).toBe("The base video is 11 seconds, longer than the 10 seconds this run was priced for — run it again")
  })

  it("a base no longer than it was priced for renders (5 s, 1 unit)", async () => {
    await renderVideoOverlay(payload({ billedUnits: 1, layers: [{ videoUrl: V, start: 0 }] }), WORK)
    expect(m.runFfmpeg).toHaveBeenCalledTimes(1)
  })

  it("a run with a video layer that carries no priced units is refused; an image-only one renders", async () => {
    const err = await refusal(() => renderVideoOverlay(payload({ billedUnits: undefined, layers: [{ videoUrl: V, start: 0 }] }), WORK))
    expect(err.message).toBe("This run was not priced for a video layer — run it again")
    vi.clearAllMocks()
    await renderVideoOverlay(payload({ billedUnits: undefined }), WORK)
    expect(m.runFfmpeg).toHaveBeenCalledTimes(1)
  })

  it("an image-only run over 60 s is not capped", async () => {
    m.probeVideoOverlayBase.mockImplementationOnce(async () => ({ ...PROBE, streamDurationSec: 600 }))
    await renderVideoOverlay(payload({ layers: [{ imageUrl: B, start: 0 }] }), WORK)
    expect(m.runFfmpeg).toHaveBeenCalledTimes(1)
  })

  it("a run of video layers only holds no raster slot", async () => {
    await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0 }] }), WORK)
    expect(m.withFfmpegSlot).not.toHaveBeenCalled()
    expect(m.state.calls).toEqual(["download:input.mp4", "probe", "download:video-0", "probe:video-0", "cancel-check", "ffmpeg:own-slot"])
  })

  it("a skipped video layer is never downloaded", async () => {
    await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 9 }, { imageUrl: B, start: 0 }] }), WORK)
    expect(m.state.calls).not.toContain("download:video-0")
  })

  it("a layer whose probe finds no video → 'not a video', once, and the next layer is never fetched (Review Focus 4)", async () => {
    m.probeVideoOverlayBase.mockImplementationOnce(async () => (m.state.calls.push("probe"), { ...PROBE }))
    m.probeVideoOverlayBase.mockRejectedValueOnce(new DeterministicJobError("The base input is not a video"))
    const err = await refusal(() => renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0, slot: 1 }, { imageUrl: B, start: 0, slot: 2 }] }), WORK))
    expect(err.message).toBe("Layer 1: not a video")
    expect(m.fetchVideoOverlayImage).not.toHaveBeenCalled()
    expect(m.runFfmpeg).not.toHaveBeenCalled()
  })

  it("a layer probe that timed out is not the file's fault: rethrown as is, so BullMQ retries", async () => {
    m.probeVideoOverlayBase.mockImplementationOnce(async () => ({ ...PROBE }))
    m.probeVideoOverlayBase.mockRejectedValueOnce(Object.assign(new Error("ffprobe timed out"), { killed: true, timedOut: true }))
    const err = await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0 }] }), WORK).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(false)
    expect((err as Error).message).toBe("ffprobe timed out")
  })

  it("a layer video over its cap → 'video is too large', once", async () => {
    m.downloadFile.mockImplementationOnce(async () => undefined)
    m.downloadFile.mockRejectedValueOnce(new Error(`Download exceeds 200 MB: ${V}`))
    const err = await refusal(() => renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0 }, { imageUrl: B, start: 0 }] }), WORK))
    expect(err.message).toBe("layers[0]: video is too large (over 200 MB)")
    expect(m.fetchVideoOverlayImage).not.toHaveBeenCalled()
  })

  it("any other failed layer download → 'video could not be fetched', once, no URL in the message", async () => {
    m.downloadFile.mockImplementationOnce(async () => undefined)
    m.downloadFile.mockRejectedValueOnce(new Error(`Failed to download: ${V} (404)`))
    const err = await refusal(() => renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0, slot: 3 }] }), WORK))
    expect(err.message).toBe("Layer 3: video could not be fetched")
  })
})

describe("renderVideoOverlay — video layers: geometry", () => {
  it("a video layer draws in its box at the probed DISPLAY aspect (a sideways phone clip probes 1080×1920) — fitted in the graph (Review Focus 3)", async () => {
    m.state.layerProbes["video-0"] = { ...LAYER_PROBE, width: 1080, height: 1920, rotation: 90 }
    await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0, anchor: "top-left", x: 0, y: 0, width: 20 }] }), WORK)
    // 20 % of 1920 = 384 wide, 9:16 → box 384×683, drawn contain 384×682.
    expect(filterOf()).toContain("[1:v]scale=iw*sar:ih,setsar=1,scale=384:682,fps=30/1,")
    expect(filterOf()).toContain(drawnAt(0, 0, 384, 682))
  })

  it("a video layer's rect is even on every side: a centred 51 % box", async () => {
    await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0, anchor: "center", x: 0, y: 0, width: 51 }] }), WORK)
    // box 979×551 at (471, 265); drawn contain 978×550 at (471, 265) → (470, 264).
    expect(filterOf()).toContain(drawnAt(470, 264, 978, 550))
  })

  it("an image layer's rect is never even-rounded, in a run with a video too", async () => {
    await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0 }, { imageUrl: B, start: 0, anchor: "center", x: 0, y: 0, width: 51 }] }), WORK)
    // a 2:1 image: box 979×490 at (471, 295); drawn 978×488 at (471, 296), as an image-only run draws it.
    expect(filterOf()).toContain(drawnAt(471, 296, 978, 488))
  })

  it("pip: the inset in the bottom-right corner, 30 % wide, no fade; the base as today", async () => {
    await renderVideoOverlay(payload({ layout: "pip", layers: [{ videoUrl: V, start: 0 }] }), WORK)
    // 576×324 at (1267, 713) → (1266, 712).
    expect(filterOf()).toContain(drawnAt(1266, 712, 576, 324))
    expect(filterOf()).not.toContain("fade=")
    expect(filterOf()).toContain("[0:v]scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1[base]")
  })

  it("stack-whole: the base above the first video layer, both whole and touching, its stored box ignored", async () => {
    await renderVideoOverlay(payload({ ...PORTRAIT, layout: "stack-whole", layers: [{ videoUrl: V, start: 0, anchor: "top-left", x: 0, y: 0, width: 10 }] }), WORK)
    expect(filterOf()).toContain("[bfit]scale=1080:606[b];[bg][b]overlay=0:354[base]")
    expect(filterOf()).toContain("[1:v]scale=iw*sar:ih,setsar=1,scale=1080:606,fps=30/1,")
    expect(filterOf()).toContain(drawnAt(0, 960, 1080, 606))
  })

  it("stack-filled: both halves cropped (cover), whatever fit is stored", async () => {
    await renderVideoOverlay(payload({ ...PORTRAIT, layout: "stack-filled", layers: [{ videoUrl: V, start: 0, anchor: "center", width: 50, fit: "contain" }] }), WORK)
    expect(filterOf()).toContain("[bfit]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[b];[bg][b]overlay=0:0[base]")
    expect(filterOf()).toContain("scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,fps=30/1,")
    expect(filterOf()).toContain(drawnAt(0, 960, 1080, 960))
  })

  it("stack-whole of a 16:9 base above a 1:1 layer: both tops floored to even, the join exact", async () => {
    m.state.layerProbes["video-0"] = { ...LAYER_PROBE, width: 720, height: 720 }
    await renderVideoOverlay(payload({ ...PORTRAIT, layout: "stack-whole", layers: [{ videoUrl: V, start: 0 }] }), WORK)
    expect(filterOf()).toContain("[bg][b]overlay=0:116[base]")
    expect(filterOf()).toContain(drawnAt(0, 722, 1080, 1080))
  })

  it("a probed aspect is clamped to [1/8, 8] before the stack: a 1:1000 sliver stays on the canvas", async () => {
    m.state.layerProbes["video-0"] = { ...LAYER_PROBE, width: 2, height: 2000 }
    await renderVideoOverlay(payload({ ...PORTRAIT, layout: "stack-whole", layers: [{ videoUrl: V, start: 0 }] }), WORK)
    // clamped to 1:8 → both 224 wide: the base 224×126 at (428, 1) → (428, 0), the layer 224×1792 at (428, 127) → (428, 126); it ends at 1918.
    expect(filterOf()).toContain("[bfit]scale=224:126[b];[bg][b]overlay=428:0[base]")
    expect(filterOf()).toContain(drawnAt(428, 126, 224, 1792))
  })

  it("video-bottom: the base whole and flush on the bottom edge; an image layer drawn as it would be without the layout", async () => {
    const card = { imageUrl: B, start: 0, anchor: "top" as const, x: 0, y: 8, width: 80 }
    await renderVideoOverlay(payload({ ...PORTRAIT, layers: [card] }), WORK)
    const plain = filterOf()
    m.runFfmpeg.mockClear()
    await renderVideoOverlay(payload({ ...PORTRAIT, layout: "video-bottom", layers: [card] }), WORK)
    expect(filterOf()).toContain("[bfit]scale=1080:606[b];[bg][b]overlay=0:1314[base]")
    const imageLine = (f: string) => f.split(";").find((c) => c.startsWith("[v0][ov1]") || c.startsWith("[base][ov1]"))
    expect(imageLine(filterOf())).toBe(imageLine(plain))
  })

  it("an explicit baseBox wins over video-top and uses its own fit", async () => {
    await renderVideoOverlay(
      payload({ ...PORTRAIT, layout: "video-top", baseBox: { anchor: "center", x: 0, y: 0, width: 50, height: 25, fit: "cover" }, layers: [{ imageUrl: B, start: 0 }] }),
      WORK,
    )
    expect(filterOf()).toContain("[bfit]scale=540:480:force_original_aspect_ratio=increase,crop=540:480[b];[bg][b]overlay=270:720[base]")
  })

  it("a stack whose video layer starts after the video ends is refused before any layer is fetched", async () => {
    const err = await refusal(() =>
      renderVideoOverlay(payload({ ...PORTRAIT, layout: "stack-whole", layers: [{ imageUrl: B, start: 0, slot: 1 }, { videoUrl: V, start: 6, slot: 2 }] }), WORK),
    )
    expect(err.message).toBe("Layer 2: the stacked video starts at 6 s, after the video ends (5.00 s)")
    expect(m.state.calls).toEqual(["download:input.mp4", "probe"])
  })
})

describe("renderVideoOverlay — video layers: sound and warnings", () => {
  it("sound on a layer with no audio track → layer_no_audio, and the base's audio is copied as is (Review Focus 1)", async () => {
    m.state.layerProbes["video-0"] = { ...LAYER_PROBE, audioCodec: null }
    const result = await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0, slot: 2, sound: { volume: 0.5 } }] }), WORK)
    expect(result.warnings).toEqual([{ layer: 0, slot: 2, code: "layer_no_audio", detail: "the video has no sound, so none was mixed in" }])
    expect(ffmpegArgs().join(" ")).toContain("-map 0:a:0? -c:v libx264")
    expect(ffmpegArgs()).toContain("copy")
  })

  it("a layer with sound and no sound setting is silent: the base's audio is copied as is", async () => {
    const result = await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0 }] }), WORK)
    expect(result.warnings).toEqual([])
    expect(filterOf()).not.toContain("amix")
    expect(ffmpegArgs()).toContain("copy")
  })

  it("a sounding layer is mixed; a PCM base is then not reported as re-encoded (the mix is AAC)", async () => {
    m.probeVideoOverlayBase.mockImplementationOnce(async () => ({ ...PROBE, audioCodec: "pcm_s16le" }))
    const result = await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 1, sound: { volume: 0.8 } }] }), WORK)
    expect(result.warnings).toEqual([])
    expect(filterOf()).toContain("[1:a:0]atrim=duration=4.000,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=0.800,adelay=1000:all=1[a1]")
    expect(ffmpegArgs().join(" ")).toContain("-map [aout]")
  })

  it("a layer's picture and sound keep the file's offset: a picture that starts 0.067 s after its sound holds its first frame that long", async () => {
    m.state.layerProbes["video-0"] = { ...LAYER_PROBE, startTimeSec: 0.066667, audioStartTimeSec: 0 }
    await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 1, sound: { volume: 1 } }] }), WORK)
    expect(filterOf()).toContain(",setpts=PTS-STARTPTS,fps=30/1,tpad=start_mode=clone:start_duration=0.067:stop_mode=clone:stop_duration=4.000,")
    expect(filterOf()).toContain("[1:a:0]atrim=duration=4.000,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=1.000,adelay=1000:all=1[a1]")
  })

  it("a sound that starts after its picture is delayed by the difference; a layer with no audio has no offset", async () => {
    m.state.layerProbes["video-0"] = { ...LAYER_PROBE, startTimeSec: 0, audioStartTimeSec: 0.04 }
    m.state.layerProbes["video-1"] = { ...LAYER_PROBE, startTimeSec: 0.1, audioCodec: null }
    await renderVideoOverlay(
      payload({ layers: [{ videoUrl: V, start: 1, sound: { volume: 1 } }, { videoUrl: V, start: 0 }] }),
      WORK,
    )
    expect(filterOf()).toContain("[1:a:0]atrim=duration=3.960,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=1.000,adelay=1040:all=1[a1]")
    expect(filterOf()).not.toContain("start_mode=clone")
  })

  it("a layer whose sound has no stated start has no offset", async () => {
    m.state.layerProbes["video-0"] = { ...LAYER_PROBE, startTimeSec: 0.1 }
    await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0, sound: { volume: 1 } }] }), WORK)
    expect(filterOf()).not.toContain("start_mode=clone")
    expect(filterOf()).toContain("[1:a:0]atrim=duration=5.000,asetpts=PTS-STARTPTS,aresample=async=1:min_hard_comp=0:first_pts=0,volume=1.000,adelay=0:all=1[a1]")
  })

  it("a silent base with a layer's sound on: the output's audio is that layer's (Review Focus 2)", async () => {
    m.probeVideoOverlayBase.mockImplementationOnce(async () => ({ ...PROBE, audioCodec: null }))
    await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0, sound: { volume: 1 } }] }), WORK)
    expect(filterOf()).toContain("[a1]amix=inputs=1:duration=longest:normalize=0,alimiter=level=disabled:limit=0.891251:latency=enabled,apad=whole_dur=5.000,atrim=duration=5.000[aout]")
  })
})

describe("renderVideoOverlay — the render's memory reservation", () => {
  const threads = () => ffmpegEffectiveThreads()
  it("an image-only run calls ffmpeg exactly as before: the argv alone", async () => {
    await renderVideoOverlay(payload(), WORK)
    expect(m.runFfmpeg.mock.calls[0]).toHaveLength(1)
  })

  it("a run with a video layer reserves for each decoded video: the base and every video layer", async () => {
    m.state.layerProbes["video-1"] = { ...LAYER_PROBE, width: 3840, height: 2160 }
    await renderVideoOverlay(payload({ layers: [{ videoUrl: V, start: 0 }, { videoUrl: V, start: 0 }, { imageUrl: B, start: 0 }] }), WORK)
    const [, timeoutMs, launch] = m.runFfmpeg.mock.calls[0]!
    expect(timeoutMs).toBe(DEFAULT_FFMPEG_TIMEOUT_MS)
    expect(launch).toEqual({
      peakMemoryMiB: canvasPeakMemoryMiB({ width: 1920, height: 1080 }, 3, threads(), { inputs: 3, cameraMegapixels: (3840 * 2160) / 1e6 }),
    })
  })

  it("a placed base adds its canvas copy to the pictures it holds", async () => {
    await renderVideoOverlay(payload({ ...PORTRAIT, layout: "video-bottom", layers: [{ imageUrl: B, start: 0 }] }), WORK)
    expect(m.runFfmpeg.mock.calls[0]![2]).toEqual({
      peakMemoryMiB: canvasPeakMemoryMiB({ width: 1080, height: 1920 }, 2, threads(), { inputs: 1, cameraMegapixels: (1920 * 1080) / 1e6 }),
    })
  })
})
