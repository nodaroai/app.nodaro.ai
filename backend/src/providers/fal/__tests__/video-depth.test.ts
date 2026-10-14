import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockRunFalRequest, mockExtractFalUrl } = vi.hoisted(() => ({
  mockRunFalRequest: vi.fn(),
  mockExtractFalUrl: vi.fn(),
}))
vi.mock("../client.js", () => ({ runFalRequest: mockRunFalRequest, extractFalUrl: mockExtractFalUrl }))

import { FAL_VIDEO_DEPTH_PROVIDERS } from "@nodaro/shared/media"
import { falVideoDepth, FAL_VIDEO_DEPTH_CONFIGS } from "../video-depth.js"

beforeEach(() => {
  mockRunFalRequest.mockReset()
  mockExtractFalUrl.mockReset()
  mockRunFalRequest.mockResolvedValue({ output: { video: { url: "https://fal.media/d.mp4" } }, requestId: "req-1" })
  mockExtractFalUrl.mockReturnValue("https://fal.media/d.mp4")
})

describe("falVideoDepth", () => {
  it("maps every lever and never asks for raw depths", async () => {
    const reconcileOpts = { onTaskCreated: vi.fn() }
    const out = await falVideoDepth(
      "video-depth-anything",
      "https://x/v.mp4",
      { modelSize: "base", colormap: "turbo", resolution: "720p", sideBySide: true, durationSec: 10 },
      reconcileOpts,
    )
    const arg = mockRunFalRequest.mock.calls[0][0]
    expect(arg.endpoint).toBe("fal-ai/depth-anything-video")
    expect(arg.input).toEqual({
      video_url: "https://x/v.mp4",
      model: "VDA-Base",
      colormap: "turbo",
      resolution: "720p",
      side_by_side: true,
    })
    expect(arg.reconcileOpts).toBe(reconcileOpts)
    // No nodaro.ai relay serves video-depth: a keyless run must not be told the connection covers it.
    expect(arg.keyCoverage).toEqual({ coveredByConnection: false })
    expect(out).toEqual({ videoUrl: "https://fal.media/d.mp4", cost: 0.4 })
  })

  it("defaults: large model, nothing optional sent", async () => {
    await falVideoDepth("video-depth-anything", "https://x/v.mp4", {})
    expect(mockRunFalRequest.mock.calls[0][0].input).toEqual({ video_url: "https://x/v.mp4", model: "VDA-Large" })
  })

  it("rejects a provider with no fal endpoint", async () => {
    await expect(falVideoDepth("depth-anything-frames", "https://x/v.mp4", {})).rejects.toThrow(
      /Unsupported fal video-depth provider/,
    )
    expect(mockRunFalRequest).not.toHaveBeenCalled()
  })

  it("registry is keyed by the shared fal set", () => {
    expect(Object.keys(FAL_VIDEO_DEPTH_CONFIGS)).toEqual(["video-depth-anything"])
    expect(new Set(Object.keys(FAL_VIDEO_DEPTH_CONFIGS))).toEqual(new Set(FAL_VIDEO_DEPTH_PROVIDERS))
  })
})
