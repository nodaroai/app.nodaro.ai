import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockRun, mockProbe, mockEnsure, mockImageSize } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockProbe: vi.fn(),
  mockEnsure: vi.fn(async (url: string) => url),
  mockImageSize: vi.fn(async (): Promise<{ width: number; height: number } | undefined> => ({ width: 1080, height: 1080 })),
}))
vi.mock("../client.js", async (orig) => ({ ...(await orig<object>()), runReplicatePrediction: mockRun }))
vi.mock("../../video/ffmpeg-utils.js", () => ({ probeVideoSource: mockProbe }))
vi.mock("../../kie/video.js", () => ({ ensureImageForProvider: mockEnsure }))
vi.mock("../../../lib/image-source-size.js", () => ({ probeImageDisplaySize: mockImageSize }))

import { runTopazImageUpscale, runTopazVideoUpscale, TOPAZ_IMAGE_REPLICATE_MODEL, TOPAZ_VIDEO_REPLICATE_MODEL } from "../topaz.js"
import { topazBilledUnits } from "../topaz-units.js"

beforeEach(() => {
  mockRun.mockReset()
  mockProbe.mockReset()
  mockEnsure.mockClear()
  mockRun.mockResolvedValue({
    output: "https://replicate.delivery/up.mp4",
    cost: 0.001,
    predictionId: "p1",
    metrics: { predict_time: 72.5, unspecified_billing_metric: 3 },
  })
})

describe("runTopazVideoUpscale", () => {
  it("sends a complete target as asked, without probing the source", async () => {
    const reconcileOpts = { onTaskCreated: vi.fn() }
    const out = await runTopazVideoUpscale("https://cdn/v.mp4", { targetResolution: "4k", targetFps: 60 }, undefined, reconcileOpts)
    const arg = mockRun.mock.calls[0][0]
    expect(arg.model).toBe(TOPAZ_VIDEO_REPLICATE_MODEL)
    expect(arg.input).toEqual({ video: "https://cdn/v.mp4", target_resolution: "4k", target_fps: 60 })
    expect(arg.reconcileOpts).toBe(reconcileOpts)
    expect(mockProbe).not.toHaveBeenCalled()
    // Charged by the units Replicate reported; provider_cost from the same count.
    expect(out).toMatchObject({ url: "https://replicate.delivery/up.mp4", billedUnits: 3, providerMs: 72500 })
    expect(out.cost).toBeCloseTo(0.24)
  })

  it("maps a legacy factor over the probed source, at the source's own rate", async () => {
    mockProbe.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 5, fps: 24 })
    await runTopazVideoUpscale("https://cdn/v.mp4", { upscaleFactor: "1" })
    expect(mockRun.mock.calls[0][0].input).toEqual({ video: "https://cdn/v.mp4", target_resolution: "720p", target_fps: 24 })
  })

  it("falls back to 1080p / 30 fps when the source cannot be probed", async () => {
    mockProbe.mockRejectedValue(new Error("probe failed"))
    await runTopazVideoUpscale("https://cdn/v.mp4", {})
    expect(mockRun.mock.calls[0][0].input).toEqual({ video: "https://cdn/v.mp4", target_resolution: "1080p", target_fps: 30 })
  })

  it("reports no units (and no cost) when the prediction carries none", async () => {
    mockRun.mockResolvedValue({ output: ["https://replicate.delivery/a.mp4"], cost: null, predictionId: "p2", metrics: { predict_time: 10 } })
    const out = await runTopazVideoUpscale("https://cdn/v.mp4", { targetResolution: "1080p", targetFps: 30 })
    expect(out.url).toBe("https://replicate.delivery/a.mp4")
    expect(out).not.toHaveProperty("billedUnits")
    expect(out.cost).toBeNull()
  })
})

describe("runTopazImageUpscale", () => {
  it.each([["1", "None"], ["2", "2x"], ["4", "4x"]])("factor %s → upscale_factor %s, lossless PNG out", async (factor, wire) => {
    mockRun.mockResolvedValue({ output: "https://replicate.delivery/up.png", cost: 0, predictionId: "p", metrics: { unspecified_billing_metric: 1 } })
    const out = await runTopazImageUpscale("https://cdn/a.png", { upscale_factor: factor })
    const arg = mockRun.mock.calls[0][0]
    expect(arg.model).toBe(TOPAZ_IMAGE_REPLICATE_MODEL)
    expect(arg.input).toEqual({ image: "https://cdn/a.png", upscale_factor: wire, output_format: "png" })
    expect(out).toMatchObject({ url: "https://replicate.delivery/up.png", billedUnits: 1 })
    expect(out.cost).toBeCloseTo(0.05)
  })

  it("comes back as JPG when the output is over 24 MP, and as PNG when the size cannot be read", async () => {
    mockRun.mockResolvedValue({ output: "https://replicate.delivery/up.jpg", cost: 0, predictionId: "p", metrics: { unspecified_billing_metric: 4 } })
    mockImageSize.mockResolvedValueOnce({ width: 2048, height: 2048 })
    await runTopazImageUpscale("https://cdn/a.png", { upscale_factor: "4" })
    expect(mockRun.mock.calls[0][0].input.output_format).toBe("jpg")
    mockImageSize.mockResolvedValueOnce(undefined)
    await runTopazImageUpscale("https://cdn/a.png", { upscale_factor: "4" })
    expect(mockRun.mock.calls[1][0].input.output_format).toBe("png")
  })

  it("defaults to 2x and never moves the source's pixel grid (the identity plate's 2× gate)", async () => {
    await runTopazImageUpscale("https://cdn/a.heic")
    expect(mockRun.mock.calls[0][0].input.upscale_factor).toBe("2x")
    expect(mockEnsure).toHaveBeenCalledWith("https://cdn/a.heic", "topaz-image-upscale", expect.objectContaining({ preserveGeometry: true, preferLossless: true }))
  })
})

describe("topazBilledUnits", () => {
  it("reads Replicate's billing metric, and nothing else", () => {
    expect(topazBilledUnits({ unspecified_billing_metric: 19 })).toBe(19)
    expect(topazBilledUnits({ predict_time: 3 })).toBeUndefined()
    expect(topazBilledUnits({ unspecified_billing_metric: "3" })).toBeUndefined()
    expect(topazBilledUnits(undefined)).toBeUndefined()
  })
})
