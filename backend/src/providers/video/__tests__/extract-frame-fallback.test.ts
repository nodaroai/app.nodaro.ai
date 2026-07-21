/**
 * extract-frame past-the-end fallback (2026-07-20 app reports).
 *
 * A seek computed from container metadata can land past the actual last
 * frame; ffmpeg then initializes the mjpeg encoder from the raw input stream
 * and dies with "Non full-range YUV is non-standard" — a wall of build-config
 * text. The provider now retries once with `-sseof -1 … -update 1` (last
 * decodable frame) and, if that also fails, throws a human-actionable error.
 */

import { join } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
  runFfmpeg: vi.fn().mockResolvedValue(""),
  runFfprobe: vi.fn().mockResolvedValue(""),
  createWorkDir: vi.fn().mockResolvedValue("/tmp/work"),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  runFfprobe: mocks.runFfprobe,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))

import { extractFrame } from "../extract-frame.js"

const FFMPEG_WALL = new Error(
  "ffmpeg failed: ffmpeg version n8.1.2 Copyright (c) 2000-2026\n" +
    "[vf#0:0] No filtered frames for output stream, trying to initialize anyway.\n" +
    "[mjpeg] Non full-range YUV is non-standard, set strict_std_compliance to at most unofficial to use it.\n" +
    "Conversion failed!",
)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWorkDir.mockResolvedValue("/tmp/work")
  mocks.runFfmpeg.mockResolvedValue("")
  // fps + frame-count probes for the end-seeking modes.
  mocks.runFfprobe.mockImplementation(async (args: string[]) => {
    if (args.includes("stream=r_frame_rate")) return "24/1"
    if (args.includes("stream=nb_frames")) return "72"
    if (args.includes("stream=duration")) return "3.0"
    return ""
  })
})

const ffmpegCall = (n: number): string[] => (mocks.runFfmpeg.mock.calls[n]?.[0] as string[]) ?? []

describe("extractFrame fallback", () => {
  // path.join is platform-dependent — build the expectation the same way the
  // provider does, so the test passes on Windows checkouts too.
  const FRAME_PATH = join("/tmp/work", "frame.jpg")

  it("happy path stays a single primary call (no fallback side effects)", async () => {
    const result = await extractFrame({ videoUrl: "https://x/v.mp4", mode: "last" })
    expect(result.imagePath).toBe(FRAME_PATH)
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1)
    expect(ffmpegCall(0)).toContain("-vframes")
  })

  it("falls back to the last decodable frame when the primary seek fails", async () => {
    mocks.runFfmpeg.mockRejectedValueOnce(FFMPEG_WALL)

    const result = await extractFrame({ videoUrl: "https://x/v.mp4", mode: "last" })

    expect(result.imagePath).toBe(FRAME_PATH)
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
    const fallback = ffmpegCall(1)
    expect(fallback).toContain("-sseof")
    expect(fallback).toContain("-update")
    expect(fallback).not.toContain("-vframes")
  })

  it("covers timestamp mode too (past-the-end timestamps resolve to a real frame)", async () => {
    mocks.runFfmpeg.mockRejectedValueOnce(FFMPEG_WALL)
    await extractFrame({ videoUrl: "https://x/v.mp4", mode: "timestamp", timestamp: 99 })
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
  })

  it("does NOT fall back for mode=first — answering a broken input with the LAST frame is wrong", async () => {
    mocks.runFfmpeg.mockRejectedValueOnce(FFMPEG_WALL)
    await expect(extractFrame({ videoUrl: "https://x/v.mp4", mode: "first" })).rejects.toThrow(
      /ffmpeg failed/,
    )
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1)
  })

  it("both attempts down → clean actionable error, not the ffmpeg wall; work dir cleaned", async () => {
    mocks.runFfmpeg.mockRejectedValue(FFMPEG_WALL)

    const err = await extractFrame({ videoUrl: "https://x/v.mp4", mode: "frame-from-end", framesFromEnd: 0 })
      .then(() => null)
      .catch((e) => e)

    expect((err as Error).message).toMatch(/no decodable frame at the requested position/)
    expect((err as Error).message).not.toMatch(/ffmpeg version/)
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })
})
