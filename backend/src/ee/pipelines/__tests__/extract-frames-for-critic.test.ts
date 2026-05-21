import { describe, it, expect, vi, beforeEach } from "vitest"

// extractFramesForCritic delegates to pipelineExtractFrame under the hood
// (via extractFrameAtTimestamp). Mock the worker-job primitive so no actual
// ffmpeg / BullMQ work runs in tests.
vi.mock("../services/pipeline-extract-frame.js", () => ({
  pipelineExtractFrame: vi.fn(),
}))

import { extractFramesForCritic, extractFrameAtTimestamp } from "../continuity.js"
import { pipelineExtractFrame } from "../services/pipeline-extract-frame.js"

const extractFrameMock = pipelineExtractFrame as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  // Default mock: synthesize a unique asset+url per call, keyed on timestamp,
  // so tests can assert per-frame ordering.
  let calls = 0
  extractFrameMock.mockImplementation(async (args: { timestamp?: number }) => {
    calls += 1
    return {
      jobId: `job-${calls}`,
      assetId: `asset-${calls}`,
      assetUrl: `https://r2/frame-t${args.timestamp}.png`,
      creditsSpent: 0,
    }
  })
})

const baseArgs = {
  supabase: {} as never,
  pipelineId: "p1",
  pipelineEntityId: "scene-1",
  userId: "u1",
  videoUrl: "https://r2/clip.mp4",
  firstFrameUrl: "https://r2/input-keyframe.png",
}

describe("extractFramesForCritic", () => {
  it("first_last mode: returns 2 URLs — firstFrameUrl + last frame at duration-0.1s", async () => {
    const result = await extractFramesForCritic({
      ...baseArgs,
      durationSeconds: 5,
      mode: "first_last",
    })

    expect(result.frameUrls).toHaveLength(2)
    // t=0 must be the caller-supplied first-frame URL — never re-extracted.
    expect(result.frameUrls[0]).toBe("https://r2/input-keyframe.png")
    // The last frame must come from a fresh extraction at duration - 0.1s.
    expect(result.frameUrls[1]).toBe("https://r2/frame-t4.9.png")

    // Exactly ONE extraction call (the t=0 frame is the caller's input).
    expect(extractFrameMock).toHaveBeenCalledTimes(1)
    expect(extractFrameMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "timestamp",
        timestamp: 4.9,
        videoUrl: "https://r2/clip.mp4",
        pipelineId: "p1",
        pipelineEntityId: "scene-1",
        userId: "u1",
      }),
    )
  })

  it("first_middle_last mode: returns 3 URLs — first + middle + last in chronological order", async () => {
    const result = await extractFramesForCritic({
      ...baseArgs,
      durationSeconds: 10,
      mode: "first_middle_last",
    })

    expect(result.frameUrls).toHaveLength(3)
    expect(result.frameUrls[0]).toBe("https://r2/input-keyframe.png")
    // Middle = duration * 0.5 = 5.0s
    expect(result.frameUrls[1]).toBe("https://r2/frame-t5.png")
    // Last = duration - 0.1 = 9.9s
    expect(result.frameUrls[2]).toBe("https://r2/frame-t9.9.png")

    // TWO extractions: middle + last (t=0 was reused).
    expect(extractFrameMock).toHaveBeenCalledTimes(2)
    const calls = extractFrameMock.mock.calls.map((c) => c[0].timestamp)
    expect(calls).toEqual([5, 9.9])
  })

  it("five_evenly mode: returns 5 URLs at [0, 25%, 50%, 75%, last] timestamps", async () => {
    const result = await extractFramesForCritic({
      ...baseArgs,
      durationSeconds: 8,
      mode: "five_evenly",
    })

    expect(result.frameUrls).toHaveLength(5)
    expect(result.frameUrls[0]).toBe("https://r2/input-keyframe.png")
    expect(result.frameUrls[1]).toBe("https://r2/frame-t2.png") // 25%
    expect(result.frameUrls[2]).toBe("https://r2/frame-t4.png") // 50%
    expect(result.frameUrls[3]).toBe("https://r2/frame-t6.png") // 75%
    expect(result.frameUrls[4]).toBe("https://r2/frame-t7.9.png") // duration - 0.1s

    // FOUR extractions: 25%, 50%, 75%, last.
    expect(extractFrameMock).toHaveBeenCalledTimes(4)
    const calls = extractFrameMock.mock.calls.map((c) => c[0].timestamp)
    expect(calls).toEqual([2, 4, 6, 7.9])
  })

  it("propagates errors when an underlying extraction fails", async () => {
    extractFrameMock.mockReset()
    extractFrameMock.mockResolvedValueOnce({
      jobId: "j-ok",
      assetId: "a-1",
      assetUrl: "https://r2/frame-t5.png",
      creditsSpent: 0,
    })
    extractFrameMock.mockResolvedValueOnce({
      jobId: "j-fail",
      assetId: null,
      // Empty URL — the canonical "extract job returned nothing" failure.
      assetUrl: "",
      creditsSpent: 0,
    })

    await expect(
      extractFramesForCritic({
        ...baseArgs,
        durationSeconds: 10,
        mode: "first_middle_last",
      }),
    ).rejects.toThrow(/extract-frame job completed without output URL/)
  })

  it("clamps the last-frame timestamp to >= 0 for short clips (duration < 0.1s)", async () => {
    extractFrameMock.mockReset()
    extractFrameMock.mockResolvedValueOnce({
      jobId: "j",
      assetId: "a",
      assetUrl: "https://r2/frame-t0.png",
      creditsSpent: 0,
    })

    const result = await extractFramesForCritic({
      ...baseArgs,
      durationSeconds: 0.05,
      mode: "first_last",
    })

    expect(result.frameUrls).toHaveLength(2)
    expect(extractFrameMock).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: 0 }),
    )
  })

  // /simplify pass-2 — caller reuses the helper-returned last-frame asset id
  // as the continuity anchor for the next shot.
  it("returns lastFrameAssetId from the final extracted frame (the t=duration-0.1s sample)", async () => {
    const result = await extractFramesForCritic({
      ...baseArgs,
      durationSeconds: 10,
      mode: "first_middle_last",
    })

    // The default mock numbers assets in call order. Two extractions fire:
    // middle (asset-1) then last (asset-2) — the last asset is the
    // `lastFrameAssetId` we expose.
    expect(result.lastFrameAssetId).toBe("asset-2")
  })

  it("returns lastFrameAssetId=null when the final extract had null assetId", async () => {
    extractFrameMock.mockReset()
    extractFrameMock.mockResolvedValueOnce({
      jobId: "j-1",
      assetId: null,
      assetUrl: "https://r2/frame.png",
      creditsSpent: 0,
    })

    const result = await extractFramesForCritic({
      ...baseArgs,
      durationSeconds: 5,
      mode: "first_last",
    })

    expect(result.frameUrls).toHaveLength(2)
    // null is preserved (the URL is still good — only the persistence write
    // loses; the chain anchor is best-effort, the URL is the authoritative
    // bit downstream tooling needs).
    expect(result.lastFrameAssetId).toBeNull()
  })
})

describe("extractFrameAtTimestamp", () => {
  it("returns {assetId, url} when pipelineExtractFrame succeeds", async () => {
    extractFrameMock.mockReset()
    extractFrameMock.mockResolvedValueOnce({
      jobId: "j",
      assetId: "a-42",
      assetUrl: "https://r2/frame.png",
      creditsSpent: 0,
    })

    const result = await extractFrameAtTimestamp({
      supabase: {} as never,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      videoUrl: "https://r2/clip.mp4",
      timestamp: 2.5,
    })

    expect(result).toEqual({ assetId: "a-42", url: "https://r2/frame.png" })
    expect(extractFrameMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "timestamp",
        timestamp: 2.5,
      }),
    )
  })

  it("throws when pipelineExtractFrame returns no URL", async () => {
    extractFrameMock.mockReset()
    extractFrameMock.mockResolvedValueOnce({
      jobId: "j",
      assetId: null,
      assetUrl: "",
      creditsSpent: 0,
    })

    await expect(
      extractFrameAtTimestamp({
        supabase: {} as never,
        pipelineId: "p1",
        userId: "u1",
        videoUrl: "https://r2/clip.mp4",
        timestamp: 1.0,
      }),
    ).rejects.toThrow(/extract-frame job completed without output URL/)
  })
})
