import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — the fal queue client is stubbed so falLipSync is exercised against a
// faithful stand-in (no network). Pricing (./pricing.js) is pure → left real so
// the cost assertions exercise the actual falCostUsd math.
// ---------------------------------------------------------------------------

const { mockRunFalRequest, mockExtractFalUrl } = vi.hoisted(() => ({
  mockRunFalRequest: vi.fn(),
  mockExtractFalUrl: vi.fn(),
}))

vi.mock("../client.js", () => ({
  runFalRequest: mockRunFalRequest,
  extractFalUrl: mockExtractFalUrl,
}))

import { falLipSync, FAL_LIP_SYNC_CONFIGS } from "../lip-sync.js"

beforeEach(() => {
  mockRunFalRequest.mockReset()
  mockExtractFalUrl.mockReset()
  mockRunFalRequest.mockResolvedValue({
    output: { video: { url: "https://fal.media/out.mp4" } },
    requestId: "req-1",
  })
  mockExtractFalUrl.mockReturnValue("https://fal.media/out.mp4")
})

describe("FAL_LIP_SYNC_CONFIGS", () => {
  it("maps sync-lipsync-v3 to the fal endpoint + param names", () => {
    expect(FAL_LIP_SYNC_CONFIGS["sync-lipsync-v3"]).toEqual({
      endpoint: "fal-ai/sync-lipsync/v3",
      videoParam: "video_url",
      audioParam: "audio_url",
    })
  })
})

describe("falLipSync", () => {
  it("builds the input with video_url + audio_url + sync_mode and calls runFalRequest", async () => {
    const reconcileOpts = { onTaskCreated: vi.fn() } as never
    await falLipSync(
      "sync-lipsync-v3",
      "https://x/v.mp4",
      "https://x/a.mp3",
      { syncMode: "loop", audioDurationSec: 12 },
      reconcileOpts,
    )

    expect(mockRunFalRequest).toHaveBeenCalledTimes(1)
    const arg = mockRunFalRequest.mock.calls[0][0]
    expect(arg.endpoint).toBe("fal-ai/sync-lipsync/v3")
    expect(arg.input).toEqual({
      video_url: "https://x/v.mp4",
      audio_url: "https://x/a.mp3",
      sync_mode: "loop",
    })
    expect(arg.reconcileOpts).toBe(reconcileOpts)
  })

  it("omits sync_mode when not provided", async () => {
    await falLipSync("sync-lipsync-v3", "https://x/v.mp4", "https://x/a.mp3", {})
    const arg = mockRunFalRequest.mock.calls[0][0]
    expect(arg.input).toEqual({
      video_url: "https://x/v.mp4",
      audio_url: "https://x/a.mp3",
    })
    expect(arg.input).not.toHaveProperty("sync_mode")
  })

  it("returns the extracted url from the fal output", async () => {
    mockExtractFalUrl.mockReturnValue("https://fal.media/result.mp4")
    const out = await falLipSync("sync-lipsync-v3", "https://x/v.mp4", "https://x/a.mp3", {
      audioDurationSec: 30,
    })
    expect(mockExtractFalUrl).toHaveBeenCalledWith({ video: { url: "https://fal.media/out.mp4" } })
    expect(out.videoUrl).toBe("https://fal.media/result.mp4")
  })

  it("computes cost from the supplied audio duration ($0.13333/s)", async () => {
    const out = await falLipSync("sync-lipsync-v3", "https://x/v.mp4", "https://x/a.mp3", {
      audioDurationSec: 60,
    })
    // 0.13333 × 60 ≈ 8.0
    expect(out.cost).toBeCloseTo(8.0, 2)
  })

  it("missing duration falls back to the 300s ceiling cost (NOT 0)", async () => {
    const out = await falLipSync("sync-lipsync-v3", "https://x/v.mp4", "https://x/a.mp3", {})
    // 0.13333 × 300 ≈ 39.999 — must NOT be 0 (so provider_cost isn't written $0).
    expect(out.cost).not.toBe(0)
    expect(out.cost).toBeCloseTo(0.13333 * 300, 5)
  })

  it("audioDurationSec <= 0 also falls back to the 300s ceiling cost", async () => {
    const out = await falLipSync("sync-lipsync-v3", "https://x/v.mp4", "https://x/a.mp3", {
      audioDurationSec: 0,
    })
    expect(out.cost).toBeCloseTo(0.13333 * 300, 5)
  })

  it("throws for an unknown provider", async () => {
    await expect(
      falLipSync("not-a-fal-model", "https://x/v.mp4", "https://x/a.mp3", {}),
    ).rejects.toThrow(/Unsupported fal lip-sync provider/)
    expect(mockRunFalRequest).not.toHaveBeenCalled()
  })
})
