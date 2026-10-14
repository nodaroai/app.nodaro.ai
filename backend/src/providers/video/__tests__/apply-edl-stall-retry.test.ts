// A stalled chunk is retried, not hung on (C4 bug fixes, decided 2026-10-10).
//
// Every slice of the EDL timeline — Apply EDL's and Speaker View's picture
// chunks and the PCM sound slices — launches through `runSlice`, which watches
// its ffmpeg for a stall (`ffmpeg-stall-watchdog.ts`) and relaunches a stalled
// one inside the chunk's own kill budget, a bounded number of times. This file
// runs `applyEdl` with only the ffmpeg spawns, fetches, probes and R2 faked:
// a stall on one launch costs one relaunch of THAT chunk; every attempt
// stalling fails the render with an honest message; a real failure is never
// retried; and the joins (concat, mux) are not watched (they are not chunks).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared/edl"

const fx = vi.hoisted(() => ({
  /** Every ffmpeg launch: its output path, kill budget and stall watch. */
  launches: [] as { out: string; timeoutMs?: number; watch?: unknown }[],
  /** Launch numbers (1-based) that stall, each reporting this many ms run. */
  stallOn: new Set<number>(),
  stallRanMs: 31_000,
  /** Launch number (1-based) that fails for real. */
  failOn: Number.POSITIVE_INFINITY,
  status: "processing",
  /** Flip the row to cancelled when a launch stalls. */
  cancelOnStall: false,
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  const { ffmpegStallError } = await import("../ffmpeg-stall-watchdog.js")
  return {
    ...actual,
    downloadFile: async () => {},
    runFfprobe: async () => "audio\n",
    probeStreamEnds: async () => ({ video: { state: "measured", endSec: 10_000 }, audio: { state: "measured", endSec: 10_000 } }),
    ffmpegVersionLine: async () => "ffmpeg version test",
    runFfmpeg: async (args: readonly string[], timeoutMs?: number, _launch?: unknown, watch?: unknown) => {
      fx.launches.push({ out: String(args[args.length - 1]), timeoutMs, watch })
      const n = fx.launches.length
      vi.setSystemTime(Date.now() + 60_000)
      if (fx.stallOn.has(n)) {
        if (fx.cancelOnStall) fx.status = "cancelled"
        throw ffmpegStallError(fx.stallRanMs)
      }
      if (n === fx.failOn) throw new Error("ffmpeg failed: Error while filtering")
      return ""
    },
  }
})
vi.mock("../../../lib/storage.js", () => ({
  getR2ObjectSize: async () => 0,
  downloadR2ObjectToFile: async () => {},
  uploadFileWithKeyToR2: async () => {},
  deleteFromR2: async () => {},
  batchDeleteFromR2: async (keys: string[]) => ({ deleted: keys.length, errors: 0, notDeleted: [], kept: [] }),
}))
vi.mock("../combine-videos.js", () => ({
  pickTargetResolution: async () => ({ width: 1280, height: 720 }),
  pickTargetFps: async () => 30,
}))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { status: fx.status, stop_requested_at: null }, error: null }),
        }),
      }),
    }),
  },
}))

import { applyEdl } from "../apply-edl.js"
import { JobCancelledError, runWithJobCancellation } from "../../../lib/job-cancellation.js"
import { SLICE_STALL_ATTEMPTS, isFfmpegStall } from "../ffmpeg-stall-watchdog.js"

function edl(n: number): Edl {
  const segments = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, inMs: i * 2000, outMs: (i + 1) * 2000, video: "A",
  })) as EdlSegment[]
  return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
}

const render = (output: "video" | "audio" = "video") =>
  applyEdl({
    edl: edl(8), output, quality: "final", jobId: "job-stall", checkpoint: false,
    // 8 segments → 4 chunks of 2.
    chunkThreshold: 1, maxSegmentsPerChunk: 2,
  })

const outs = () => fx.launches.map((l) => l.out.replace(/^.*\//, ""))

beforeEach(() => {
  fx.launches = []
  fx.stallOn = new Set()
  fx.stallRanMs = 31_000
  fx.failOn = Number.POSITIVE_INFINITY
  fx.status = "processing"
  fx.cancelOnStall = false
  vi.useFakeTimers({ toFake: ["Date"] })
})
afterEach(() => vi.useRealTimers())

describe("a stalled render chunk is relaunched inside its budget", () => {
  it("baseline: every slice launch carries the stall watch; the concat and the mux do not", async () => {
    await render()
    expect(outs()).toEqual([
      "chunk-0.mp4", "chunk-1.mp4", "chunk-2.mp4", "chunk-3.mp4",
      "audio-0.wav", "audio-1.wav", "audio-2.wav", "audio-3.wav",
      "video.mp4", "output.mp4",
    ])
    expect(fx.launches.slice(0, 8).every((l) => l.watch !== undefined)).toBe(true)
    expect(fx.launches.slice(8).every((l) => l.watch === undefined)).toBe(true)
  })

  it("a picture chunk that stalls once is relaunched once, with what is left of its budget", async () => {
    fx.stallOn = new Set([2]) // chunk-1's first attempt
    await render()
    expect(outs().slice(0, 5)).toEqual(["chunk-0.mp4", "chunk-1.mp4", "chunk-1.mp4", "chunk-2.mp4", "chunk-3.mp4"])
    const [first, retry] = [fx.launches[1]!, fx.launches[2]!]
    expect(retry.timeoutMs).toBe(first.timeoutMs! - fx.stallRanMs)
    expect(fx.launches).toHaveLength(11)
  })

  it("a sound slice is watched and relaunched the same way", async () => {
    fx.stallOn = new Set([5]) // audio-0's first attempt
    await render()
    expect(outs().slice(4, 6)).toEqual(["audio-0.wav", "audio-0.wav"])
  })

  it(`every attempt stalling fails the render honestly after ${SLICE_STALL_ATTEMPTS} launches of that chunk`, async () => {
    fx.stallOn = new Set(Array.from({ length: 20 }, (_, i) => i + 1))
    const err = (await render().catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/^ffmpeg failed: .*no progress/)
    expect(isFfmpegStall(err)).toBe(false)
    expect(outs()).toEqual(Array(SLICE_STALL_ATTEMPTS).fill("chunk-0.mp4"))
  })

  it("a real ffmpeg failure is never retried", async () => {
    fx.failOn = 2
    await expect(render()).rejects.toThrow(/Error while filtering/)
    expect(outs()).toEqual(["chunk-0.mp4", "chunk-1.mp4"])
  })

  it("a cancel between a stall and its relaunch ends the render — no relaunch", async () => {
    fx.stallOn = new Set([1])
    fx.cancelOnStall = true
    const err = await runWithJobCancellation("job-stall", "user-1", () => render()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobCancelledError)
    expect(outs()).toEqual(["chunk-0.mp4"])
  })
})
