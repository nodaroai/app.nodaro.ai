import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock all FFmpeg utility I/O. We're testing the algorithm decisions, not
// real ffmpeg invocations.
vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
  runFfmpeg: vi.fn().mockResolvedValue(undefined),
  runFfprobe: vi.fn(),
  createWorkDir: vi.fn().mockResolvedValue("/tmp/slc"),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("sharp", () => ({
  default: vi.fn(() => ({
    raw: () => ({
      toBuffer: () => Promise.resolve({
        data: Buffer.alloc(100, 0),
        info: { width: 10, height: 10, channels: 3 },
      }),
    }),
  })),
}))

import { runFfprobe, runFfmpeg } from "../ffmpeg-utils.js"
import { smartLoopCut } from "../smart-loop-cut.js"

const mockedRunFfprobe = vi.mocked(runFfprobe)
const mockedRunFfmpeg = vi.mocked(runFfmpeg)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("smartLoopCut — quality: 'lossless'", () => {
  it("probes keyframe packet timestamps when quality=lossless", async () => {
    // First probe: fps + frame count (existing behavior, JSON output)
    mockedRunFfprobe.mockResolvedValueOnce(
      '{"streams":[{"r_frame_rate":"24/1","nb_read_frames":"200","duration":"8.333"}]}',
    )
    // Second probe: keyframe packet timestamps (CSV)
    mockedRunFfprobe.mockResolvedValueOnce(
      "0.000000,K_____\n4.000000,K_____\n8.000000,K_____\n",
    )

    await smartLoopCut({
      videoUrl: "https://x.mp4",
      quality: "lossless",
      lookbackFrames: 16,
    }).catch(() => {})

    // Second call uses -show_packets + flags
    const secondCall = mockedRunFfprobe.mock.calls[1]?.[0] as string[]
    expect(secondCall).toContain("-show_packets")
    const showEntriesIdx = secondCall.indexOf("-show_entries")
    expect(showEntriesIdx).toBeGreaterThanOrEqual(0)
    expect(secondCall[showEntriesIdx + 1]).toContain("packet=pts_time,flags")
  })

  it("falls back to precise mode when no keyframes within lookback window", async () => {
    // 200 frames @ 24fps = 8.33s. Lookback 16 frames = 0.67s window.
    // Only keyframe is at 0s — outside the window.
    mockedRunFfprobe.mockResolvedValueOnce(
      '{"streams":[{"r_frame_rate":"24/1","nb_read_frames":"200","duration":"8.333"}]}',
    )
    mockedRunFfprobe.mockResolvedValueOnce("0.000000,K_____\n")

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    await smartLoopCut({
      videoUrl: "https://x.mp4",
      quality: "lossless",
      lookbackFrames: 16,
    }).catch(() => {})

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("falling back to precise"),
    )
    consoleSpy.mockRestore()
  })

  it("uses stream-copy with -t <pts> -c copy when lossless cut succeeds", async () => {
    mockedRunFfprobe.mockResolvedValueOnce(
      '{"streams":[{"r_frame_rate":"24/1","nb_read_frames":"200","duration":"8.333"}]}',
    )
    // keyframes at 0, 7.5, 8 — within 16-frame lookback (0.67s) only 8.0 qualifies
    mockedRunFfprobe.mockResolvedValueOnce(
      "0.000000,K_____\n7.500000,K_____\n8.000000,K_____\n",
    )

    await smartLoopCut({
      videoUrl: "https://x.mp4",
      quality: "lossless",
      lookbackFrames: 16,
    }).catch(() => {})

    // Find a runFfmpeg call that uses -c copy (the final stream-copy cut)
    const cutCall = mockedRunFfmpeg.mock.calls.find((call) => {
      const args = call[0] as string[]
      const cIdx = args.indexOf("-c:v")
      return cIdx >= 0 && args[cIdx + 1] === "copy"
    })
    expect(cutCall).toBeDefined()
    const args = cutCall![0] as string[]
    const tIdx = args.indexOf("-t")
    expect(tIdx).toBeGreaterThanOrEqual(0)
    // Chosen keyframe must be one within the lookback window (only 8.0s qualifies here)
    expect(["7.5", "7.500000", "8", "8.000000"]).toContain(args[tIdx + 1])
  })
})
