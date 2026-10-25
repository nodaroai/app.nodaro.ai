/**
 * `tk.providers.videoUpscale` — the gvp tail-restoration lever's toolkit
 * member (2026-08-02). Wraps `videoUpscale` from `providers/router.ts`,
 * narrowing the surface to (url, model, factor) → { url }: reconcile /
 * progress hooks stay app-internal, and the RouteResult's cost field is
 * deliberately not exposed to plugins.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockVideoUpscale } = vi.hoisted(() => ({ mockVideoUpscale: vi.fn() }))
// editImage + generateImage must exist on the factory too — toolkit.ts
// imports them for the imageUpscale/generateImage members (a missing named
// export throws at import binding).
vi.mock("../../../providers/router.js", () => ({ videoUpscale: mockVideoUpscale, editImage: vi.fn(), generateImage: vi.fn() }))
// The result is re-hosted as browser-safe H.264 (Topaz delivers HEVC 10-bit).
const { mockTranscode, mockUpload } = vi.hoisted(() => ({
  mockTranscode: vi.fn(async (_in: string, out: string, _crf?: string) => out),
  mockUpload: vi.fn(async () => "https://r2/upscaled-h264.mp4"),
}))
vi.mock("../../../providers/video/ffmpeg-utils.js", async (orig) => ({
  ...(await orig<object>()),
  createWorkDir: vi.fn(async () => "/tmp/rehost-test"),
  cleanupWorkDir: vi.fn(async () => {}),
  downloadFile: vi.fn(async () => {}),
  transcodeToBrowserSafe: mockTranscode,
}))
vi.mock("../../storage.js", async (orig) => ({ ...(await orig<object>()), uploadFileToR2: mockUpload }))

import { buildToolkit } from "../toolkit.js"

describe("tk.providers.videoUpscale", () => {
  beforeEach(() => {
    mockVideoUpscale.mockReset()
  })

  it("threads (url, model, factor) to the provider router and unwraps { url }", async () => {
    mockVideoUpscale.mockResolvedValue({ url: "https://provider/upscaled.mp4", cost: 0.12 })
    const tk = buildToolkit()

    const result = await tk.providers.videoUpscale("https://r2/tail.mp4", "topaz", "2")

    // The plugin contract keeps its factor; the router takes it as the legacy lever.
    expect(mockVideoUpscale).toHaveBeenCalledWith("https://r2/tail.mp4", "topaz", { upscaleFactor: "2" })
    // Re-hosted as H.264 at the delivery CRF; cost NOT exposed.
    expect(mockTranscode).toHaveBeenCalledWith(expect.any(String), expect.any(String), "18")
    expect(result).toEqual({ url: "https://r2/upscaled-h264.mp4" })
  })

  it("sends no request when the plugin names no factor (the provider's defaults)", async () => {
    mockVideoUpscale.mockResolvedValue({ url: "https://provider/upscaled.mp4", cost: 0.12 })
    const tk = buildToolkit()

    await tk.providers.videoUpscale("https://r2/tail.mp4", "topaz")

    expect(mockVideoUpscale).toHaveBeenCalledWith("https://r2/tail.mp4", "topaz", undefined)
  })

  it("propagates provider failures unchanged (the plugin's fallback owns degradation)", async () => {
    mockVideoUpscale.mockRejectedValue(new Error("topaz 502"))
    const tk = buildToolkit()

    await expect(tk.providers.videoUpscale("https://r2/tail.mp4", "topaz", "2")).rejects.toThrow("topaz 502")
  })
})
