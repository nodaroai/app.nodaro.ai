/**
 * trimVideo CRF option tests.
 *
 * trim-video.ts hardcodes "-crf 23" for the libx264 re-encode of the trimmed
 * clip. edit-video-pro cuts kept footage at a tighter CRF (18) to minimize
 * generation loss before the splice re-encode in combineVideos, so trimVideo
 * gains an optional `crf` (default 23 — additive, existing callers see no
 * change).
 *
 * Mirrors the mocking harness of combine-videos.test.ts, scoped to the
 * ffmpeg-utils surface trim-video.ts actually touches.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const downloadFile = vi.fn().mockResolvedValue(undefined)
  const runFfmpeg = vi.fn().mockResolvedValue("")
  const runFfprobe = vi.fn().mockResolvedValue("")
  const createWorkDir = vi.fn().mockResolvedValue("/tmp/work")
  const cleanupWorkDir = vi.fn().mockResolvedValue(undefined)
  return { downloadFile, runFfmpeg, runFfprobe, createWorkDir, cleanupWorkDir }
})

vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  runFfprobe: mocks.runFfprobe,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { trimVideo } from "../trim-video.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWorkDir.mockResolvedValue("/tmp/work")
  mocks.cleanupWorkDir.mockResolvedValue(undefined)
  mocks.downloadFile.mockResolvedValue(undefined)
  mocks.runFfmpeg.mockResolvedValue("")
  mocks.runFfprobe.mockResolvedValue("")
})

/** Get the args of the Nth runFfmpeg call. */
function ffargs(index = 0): string[] {
  return mocks.runFfmpeg.mock.calls[index][0] as string[]
}

// ===========================================================================
// crf option
// ===========================================================================

describe("trimVideo — crf option", () => {
  it("default stays crf 23 when crf is not provided", async () => {
    await trimVideo({ videoUrl: "https://r2/a.mp4", startTime: 0, endTime: 5 })

    const args = ffargs()
    const crfIdx = args.indexOf("-crf")
    expect(crfIdx).toBeGreaterThan(-1)
    expect(args[crfIdx + 1]).toBe("23")
  })

  it("crf option overrides the default (18)", async () => {
    await trimVideo({ videoUrl: "https://r2/a.mp4", startTime: 0, endTime: 5, crf: 18 })

    const args = ffargs()
    const crfIdx = args.indexOf("-crf")
    expect(crfIdx).toBeGreaterThan(-1)
    expect(args[crfIdx + 1]).toBe("18")
  })
})
