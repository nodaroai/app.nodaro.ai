// Podcast Track 0.11 — a cancelled multi-chunk apply-edl render must STOP.
//
// Before, `applyEdl` rendered every chunk to the end once it started: a user
// cancel, or the orchestrator's `cancelJobAndThrow` on a timed-out/cancelled
// run, flipped the row to `cancelled` while the worker kept an ffmpeg slot busy
// for the rest of a multi-hour render. Now every boundary (each source, each
// picture chunk, each audio slice, and the join) asks `throwIfJobCancelled()`.
// The video worker runs EVERY handler inside `runWithJobCancellation(jobId, …)`
// (`workers/video-worker.ts`), and AsyncLocalStorage carries that context
// through `applyEdl`'s awaits — so the check is live on the real lane. This
// file runs `applyEdl` inside that same context with only the ffmpeg spawns,
// fetches, probes, the R2 checkpoint cache and the status read faked. A
// cancelled render also deletes the checkpoints it uploaded (a cancelled job is
// never resumed); any other failure keeps them for the same-jobId retry.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"

const fx = vi.hoisted(() => ({
  /** Every ffmpeg spawn's output path (its last argument), in order. */
  spawns: [] as string[],
  /** `jobs.status` the throttled cancellation check reads. */
  status: "processing",
  /** Flip the row to `cancelled` once this many spawns have run. */
  cancelAfterSpawns: Number.POSITIVE_INFINITY,
  /** Make this spawn (1-based) fail with a plain, non-cancel error. */
  failSpawn: Number.POSITIVE_INFINITY,
  /** Every source download, in order. */
  downloads: [] as string[],
  /** Flip the row to `cancelled` once this many downloads have run. */
  cancelAfterDownloads: Number.POSITIVE_INFINITY,
  statusReads: 0,
  /** R2 checkpoint keys uploaded / deleted (the storage module is faked). */
  uploads: [] as string[],
  deletes: [] as string[],
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async (url: string) => {
      fx.downloads.push(url)
      if (fx.downloads.length >= fx.cancelAfterDownloads) fx.status = "cancelled"
      // A real fetch takes time too — move past the check's 4-s throttle.
      vi.setSystemTime(Date.now() + 60_000)
    },
    runFfprobe: async () => "audio\n",
    probeStreamEnds: async () => ({ video: { state: "measured", endSec: 10_000 }, audio: { state: "measured", endSec: 10_000 } }),
    ffmpegVersionLine: async () => "ffmpeg version test",
    runFfmpeg: async (args: readonly string[]) => {
      fx.spawns.push(String(args[args.length - 1]))
      if (fx.spawns.length >= fx.failSpawn) throw new Error("ffmpeg exited with code 1")
      if (fx.spawns.length >= fx.cancelAfterSpawns) fx.status = "cancelled"
      // Each spawn takes real render time; the cancellation check is
      // throttled (one DB read per 4 s), so let the clock move past it.
      vi.setSystemTime(Date.now() + 60_000)
      return ""
    },
  }
})
// The R2 checkpoint cache: every lookup misses, uploads and deletes recorded.
vi.mock("../../../lib/storage.js", () => ({
  getR2ObjectSize: async () => 0,
  downloadR2ObjectToFile: async () => {},
  uploadFileWithKeyToR2: async (_path: string, key: string) => {
    fx.uploads.push(key)
  },
  deleteFromR2: async (key: string) => {
    fx.deletes.push(key)
  },
}))
vi.mock("../combine-videos.js", () => ({
  pickTargetResolution: async () => ({ width: 1280, height: 720 }),
  pickTargetFps: async () => 30,
}))
// `throwIfJobCancelled` lazy-imports the client inside an active context only.
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            fx.statusReads++
            return { data: { status: fx.status, stop_requested_at: null }, error: null }
          },
        }),
      }),
    }),
  },
}))

import { applyEdl } from "../apply-edl.js"
import { JobCancelledError, runWithJobCancellation } from "../../../lib/job-cancellation.js"

/** `n` two-second hard cuts on one source. */
function edl(n: number): Edl {
  const segments = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, inMs: i * 2000, outMs: (i + 1) * 2000, video: "A",
  })) as EdlSegment[]
  return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
}

/** `n` two-second hard cuts alternating between two camera sources A and B. */
function twoSourceEdl(n: number): Edl {
  const segments = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, inMs: i * 2000, outMs: (i + 1) * 2000, video: i % 2 === 0 ? "A" : "B",
  })) as EdlSegment[]
  return {
    version: 1,
    clock: "master",
    sources: [
      { id: "A", url: "https://f.test/a.mp4", kind: "video" },
      { id: "B", url: "https://f.test/b.mp4", kind: "video" },
    ],
    segments,
  } as unknown as Edl
}

const render = (output: "video" | "audio", opts: { checkpoint?: boolean; edl?: Edl } = {}) =>
  applyEdl({
    edl: opts.edl ?? edl(8), output, quality: "final", jobId: "job-cancel", checkpoint: opts.checkpoint ?? false,
    // Force the chunked path: 8 segments → 4 chunks of 2.
    chunkThreshold: 1, maxSegmentsPerChunk: 2,
  })

const chunkSpawns = () => fx.spawns.filter((p) => /\/chunk-\d+\./.test(p))
const audioSlices = () => fx.spawns.filter((p) => /\/audio-\d+\.wav$/.test(p))

beforeEach(() => {
  fx.spawns = []
  fx.status = "processing"
  fx.cancelAfterSpawns = Number.POSITIVE_INFINITY
  fx.failSpawn = Number.POSITIVE_INFINITY
  fx.downloads = []
  fx.cancelAfterDownloads = Number.POSITIVE_INFINITY
  fx.statusReads = 0
  fx.uploads = []
  fx.deletes = []
  vi.useFakeTimers({ toFake: ["Date"] })
})
afterEach(() => vi.useRealTimers())

describe("applyEdl stops at the next chunk boundary once its job is cancelled", () => {
  it("baseline: an uncancelled chunked video render spawns every chunk, the audio pass, the join and the mux", async () => {
    await runWithJobCancellation("job-cancel", "user-1", () => render("video"))
    expect(chunkSpawns()).toHaveLength(4)
    expect(audioSlices()).toHaveLength(4)
    expect(fx.spawns).toHaveLength(10) // + the concat and the mux
    expect(fx.statusReads).toBeGreaterThan(0) // the checks really ran against the row
  })

  it("a cancel during chunk 0 stops before chunk 1 — JobCancelledError, no further spawn", async () => {
    fx.cancelAfterSpawns = 1
    const err = await runWithJobCancellation("job-cancel", "user-1", () => render("video")).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobCancelledError)
    expect(fx.spawns).toHaveLength(1)
    expect(chunkSpawns()).toHaveLength(1)
  })

  it("a cancel during a later chunk stops at the next boundary, not at the end", async () => {
    fx.cancelAfterSpawns = 2
    const err = await runWithJobCancellation("job-cancel", "user-1", () => render("video")).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobCancelledError)
    expect(chunkSpawns()).toHaveLength(2)
    expect(audioSlices()).toHaveLength(0)
  })

  it("a cancel during the audio pass (a chunked video render's PCM slices) stops before the next slice", async () => {
    // 4 picture chunks, then the audio plan's 4 slices: cancel during slice 0.
    fx.cancelAfterSpawns = 5
    const err = await runWithJobCancellation("job-cancel", "user-1", () => render("video")).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobCancelledError)
    expect(chunkSpawns()).toHaveLength(4)
    expect(audioSlices()).toHaveLength(1)
    expect(fx.spawns).toHaveLength(5)
  })

  it("a cancel during the last slice stops before the join (no concat, no mux)", async () => {
    fx.cancelAfterSpawns = 8
    const err = await runWithJobCancellation("job-cancel", "user-1", () => render("video")).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobCancelledError)
    expect(audioSlices()).toHaveLength(4)
    expect(fx.spawns).toHaveLength(8)
  })

  it("an audio-only render's chunks stop the same way", async () => {
    fx.cancelAfterSpawns = 1
    const err = await runWithJobCancellation("job-cancel", "user-1", () => render("audio")).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobCancelledError)
    expect(fx.spawns).toHaveLength(1)
  })

  it("a cancel during source prep stops before the next source is fetched — no further download, no ffmpeg spawn", async () => {
    // Multicam prep is long before the first chunk (each source: fetch, audio
    // probe, packet scan), so each source is its own boundary.
    fx.cancelAfterDownloads = 1
    const err = await runWithJobCancellation("job-cancel", "user-1", () =>
      render("video", { edl: twoSourceEdl(8) }),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobCancelledError)
    expect(fx.downloads).toEqual(["https://f.test/a.mp4"])
    expect(fx.spawns).toHaveLength(0)
  })

  it("baseline: an uncancelled two-source render fetches both sources", async () => {
    await runWithJobCancellation("job-cancel", "user-1", () => render("video", { edl: twoSourceEdl(8) }))
    expect(fx.downloads).toEqual(["https://f.test/a.mp4", "https://f.test/b.mp4"])
    expect(chunkSpawns()).toHaveLength(4)
  })

  it("outside a worker's cancellation context (e.g. the characterization suite) the check is inert", async () => {
    fx.status = "cancelled"
    await render("video")
    expect(chunkSpawns()).toHaveLength(4)
    expect(fx.statusReads).toBe(0)
  })
})

describe("a cancelled render deletes its R2 checkpoints; any other failure keeps them for the retry", () => {
  it("cancel after two checkpointed chunks: both uploaded keys are deleted", async () => {
    fx.cancelAfterSpawns = 2
    const err = await runWithJobCancellation("job-cancel", "user-1", () =>
      render("video", { checkpoint: true }),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobCancelledError)
    expect(fx.uploads).toHaveLength(2)
    expect(fx.uploads.every((k) => k.startsWith("apply-edl-cache/job-cancel/chunk-"))).toBe(true)
    expect([...fx.deletes].sort()).toEqual([...fx.uploads].sort())
  })

  it("a plain ffmpeg failure keeps them — BullMQ retries under the same jobId and resumes the chunks", async () => {
    fx.failSpawn = 2
    const err = await runWithJobCancellation("job-cancel", "user-1", () =>
      render("video", { checkpoint: true }),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(JobCancelledError)
    expect(fx.uploads).toHaveLength(1)
    expect(fx.deletes).toHaveLength(0)
  })

  it("a completed render deletes them (the success path, unchanged)", async () => {
    await runWithJobCancellation("job-cancel", "user-1", () => render("video", { checkpoint: true }))
    expect(fx.uploads).toHaveLength(4)
    expect([...fx.deletes].sort()).toEqual([...fx.uploads].sort())
  })
})
