/**
 * smart-cut tests — the PSNR boundary matcher for combine-videos.
 *
 * Mocks all I/O (ffmpeg extraction, sharp decode, fps/frame-count probe);
 * verifies the pair-selection algorithm, the trim index math, and the
 * window clamping. The pixel data returned per PNG path is controlled so a
 * specific (prev, next) pair is the unique best match.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const runFfmpeg = vi.fn().mockResolvedValue("")
  const createWorkDir = vi.fn().mockResolvedValue("/tmp/sc")
  const cleanupWorkDir = vi.fn().mockResolvedValue(undefined)
  const probeFpsAndFrameCount = vi.fn()
  /** path → fill byte for that frame's fake pixels. Frames with the same
   *  fill byte are "identical" (PSNR Infinity). */
  const pixelFillByPath = new Map<string, number>()
  return { runFfmpeg, createWorkDir, cleanupWorkDir, probeFpsAndFrameCount, pixelFillByPath }
})

vi.mock("../ffmpeg-utils.js", () => ({
  runFfmpeg: mocks.runFfmpeg,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))

vi.mock("../smart-loop-cut.js", () => ({
  probeFpsAndFrameCount: mocks.probeFpsAndFrameCount,
}))

vi.mock("sharp", () => ({
  default: vi.fn((path: string) => ({
    raw: () => ({
      toBuffer: () =>
        Promise.resolve({
          data: Buffer.alloc(48, mocks.pixelFillByPath.get(path) ?? 0),
          info: { width: 4, height: 4, channels: 3 },
        }),
    }),
  })),
}))

import { findSmartCutBoundary, boundaryTrimsFromMatch } from "../smart-cut.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runFfmpeg.mockResolvedValue("")
  mocks.createWorkDir.mockResolvedValue("/tmp/sc")
  mocks.pixelFillByPath.clear()
})

describe("boundaryTrimsFromMatch", () => {
  it("very last frame ↔ very first frame: keep prev intact, drop next's duplicate", () => {
    expect(boundaryTrimsFromMatch(0, 0)).toEqual({ trimEndFrames: 0, trimStartFrames: 1 })
  })

  it("match deeper in both windows: drop after the match on prev, through it on next", () => {
    expect(boundaryTrimsFromMatch(3, 2)).toEqual({ trimEndFrames: 3, trimStartFrames: 3 })
  })
})

describe("findSmartCutBoundary", () => {
  function stubProbes(prevFrames: number, nextFrames: number) {
    mocks.probeFpsAndFrameCount
      .mockResolvedValueOnce({ fps: 24, frameCount: prevFrames })
      .mockResolvedValueOnce({ fps: 24, frameCount: nextFrames })
  }

  /** Give every extracted frame a distinct fill byte, then make one
   *  (prev, next) pair identical. Window files are 1-based PNGs. */
  function paintFrames(windowPrev: number, windowNext: number, matchPrevFile: number, matchNextFile: number) {
    for (let i = 1; i <= windowPrev; i++) {
      mocks.pixelFillByPath.set(`/tmp/sc/prev_${String(i).padStart(4, "0")}.png`, 10 + i)
    }
    for (let j = 1; j <= windowNext; j++) {
      mocks.pixelFillByPath.set(`/tmp/sc/next_${String(j).padStart(4, "0")}.png`, 100 + j)
    }
    mocks.pixelFillByPath.set(`/tmp/sc/prev_${String(matchPrevFile).padStart(4, "0")}.png`, 200)
    mocks.pixelFillByPath.set(`/tmp/sc/next_${String(matchNextFile).padStart(4, "0")}.png`, 200)
  }

  it("picks the most similar pair and maps it to per-clip trims", async () => {
    stubProbes(120, 120)
    // Window 4/4. prev_0004 = last frame (offset 0); prev_0003 = offset 1.
    // Make prev_0003 ↔ next_0002 the identical pair → trimEnd=1, trimStart=2.
    paintFrames(4, 4, 3, 2)

    const cut = await findSmartCutBoundary("/prev.mp4", "/next.mp4", 4, 4)

    expect(cut.trimEndFrames).toBe(1)
    expect(cut.trimStartFrames).toBe(2)
    expect(cut.psnr).toBe(Infinity)
  })

  it("extracts the tail window of prev and the head window of next (downscaled)", async () => {
    stubProbes(120, 120)
    paintFrames(8, 8, 8, 1)

    await findSmartCutBoundary("/prev.mp4", "/next.mp4", 8, 8)

    const prevArgs = mocks.runFfmpeg.mock.calls[0][0] as string[]
    const prevVf = prevArgs[prevArgs.indexOf("-vf") + 1]
    // Last 8 of 120 frames → select n >= 112, downscaled for comparison.
    expect(prevVf).toContain("gte(n\\,112)")
    expect(prevVf).toContain("scale=192:-2")
    expect(prevArgs[prevArgs.indexOf("-frames:v") + 1]).toBe("8")

    const nextArgs = mocks.runFfmpeg.mock.calls[1][0] as string[]
    const nextVf = nextArgs[nextArgs.indexOf("-vf") + 1]
    expect(nextVf).toContain("lt(n\\,8)")
    expect(nextArgs[nextArgs.indexOf("-frames:v") + 1]).toBe("8")
  })

  it("clamps windows so short clips keep at least 2 frames", async () => {
    stubProbes(10, 6)
    paintFrames(8, 4, 8, 1)

    await findSmartCutBoundary("/prev.mp4", "/next.mp4", 24, 24)

    const prevArgs = mocks.runFfmpeg.mock.calls[0][0] as string[]
    // prev: window = 10 - 2 = 8 → select from frame 2
    expect(prevArgs[prevArgs.indexOf("-frames:v") + 1]).toBe("8")
    const nextArgs = mocks.runFfmpeg.mock.calls[1][0] as string[]
    // next: window = 6 - 2 = 4
    expect(nextArgs[nextArgs.indexOf("-frames:v") + 1]).toBe("4")
  })

  it("cleans up its work dir even on success", async () => {
    stubProbes(120, 120)
    paintFrames(2, 2, 2, 1)
    await findSmartCutBoundary("/prev.mp4", "/next.mp4", 2, 2)
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/sc")
  })
})
