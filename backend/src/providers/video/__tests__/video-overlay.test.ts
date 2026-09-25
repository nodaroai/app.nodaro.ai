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
  const state = { calls: [] as string[], inSlot: false }
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
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { expandVideoOverlayLayer } from "@nodaro/shared"

const WORK = "/w"
const PROBE = {
  width: 1920, height: 1080, rotation: 0, sar: 1, rFrameRate: "30/1", avgFrameRate: "30/1",
  streamDurationSec: 5, startTimeSec: 0, audioCodec: "aac" as string | null,
}
const PNG_2x1 = { bytes: 1000, svg: false, decodable: true, format: "png", width: 400, height: 200 }
const A = "https://cdn.example/a.png"
const B = "https://cdn.example/b.png"
const payload = (over: Partial<VideoOverlayJobPayload> = {}): VideoOverlayJobPayload => ({
  videoUrl: "https://cdn.example/base.mp4",
  layers: [
    { imageUrl: A, start: 1, end: 2, preset: "card" },
    { imageUrl: B, start: 0 },
  ],
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
  m.downloadFile.mockImplementation(async (_url: string, dest: string) => void m.state.calls.push(`download:${basename(dest)}`))
  m.probeVideoOverlayBase.mockImplementation(async () => (m.state.calls.push("probe"), { ...PROBE }))
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
