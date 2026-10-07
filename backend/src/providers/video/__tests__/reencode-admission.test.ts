// The two heavy ffmpeg launches that used to bypass the admission — the
// post-download x264 re-encode (`reencodeToH264`) and the HD section mux — now
// reserve memory like every other launch (decided 2026-10-05): a full re-encode
// of a 4K download is a 4K x264 render, and with the video worker at high
// concurrency several of them ran beside Apply EDL chunks the admission was
// already holding back.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { FfmpegThreads } from "../ffmpeg-threads.js"

const fx = vi.hoisted(() => ({
  slots: [] as Array<{ opts: { timeoutMs: number; signal?: AbortSignal; label?: string; peakMemoryMiB?: number; deadline?: { excuse(ms: number): void } } }>,
  spawns: 0,
  /** When set, the slot is not granted until this resolves (the wait for memory). */
  hold: undefined as Promise<void> | undefined,
  threads: { decode: 32, filter: 32, encode: 32 } as { decode: number; filter: number; encode: number },
}))

vi.mock("../ffmpeg-utils.js", () => ({
  COMBINE_DELIVERY_CRF: "18",
  withFfmpegSlot: async (fn: () => Promise<unknown>, opts: (typeof fx.slots)[number]["opts"]) => {
    fx.slots.push({ opts })
    const waitStarted = Date.now()
    if (fx.hold) {
      await Promise.race([
        fx.hold,
        new Promise((_, reject) => opts.signal?.addEventListener("abort", () => reject(opts.signal!.reason ?? new Error("FFmpeg wait cancelled")), { once: true })),
      ])
    }
    // What the real launcher does for a caller held to a deadline (`withFfmpegSlot`).
    opts.deadline?.excuse(Date.now() - waitStarted)
    return fn()
  },
}))
vi.mock("../ffmpeg-process.js", () => ({
  spawnFfmpeg: () => {
    fx.spawns++
    const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void }
    proc.stderr = new EventEmitter()
    proc.kill = () => undefined
    queueMicrotask(() => proc.emit("close", 0))
    return proc
  },
}))
vi.mock("../ffmpeg-threads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-threads.js")>()),
  ffmpegEffectiveThreads: () => fx.threads,
}))

import { canvasPeakMemoryMiB } from "../ffmpeg-memory-model.js"
import { REENCODE_ASSUMED_CANVAS, reencodePeakMemoryMiB, reencodeToH264 } from "../video-file-stages.js"
import { FetchDeadline, YtDlpHaltError } from "../ytdlp-process.js"

const UHD = { width: 3840, height: 2160 }
const same = (t: number): FfmpegThreads => ({ decode: t, filter: t, encode: t })

beforeEach(() => {
  fx.slots = []
  fx.spawns = 0
  fx.hold = undefined
  fx.threads = same(32)
})
afterEach(() => vi.useRealTimers())

describe("reencodeToH264 reserves memory before it starts", () => {
  it("reserves the canvas model for one segment at the threads it runs with", async () => {
    await reencodeToH264("/tmp/in.webm", "/tmp/out.mp4", true, undefined, { canvas: UHD })
    expect(fx.slots).toHaveLength(1)
    expect(fx.slots[0]!.opts.peakMemoryMiB).toBe(canvasPeakMemoryMiB(UHD, 1, same(32)))
    expect(fx.slots[0]!.opts.label).toBe("re-encode")
    expect(fx.spawns).toBe(1)
  })

  it("a smaller source reserves less, a bigger one more, at the same threads", () => {
    const hd = reencodePeakMemoryMiB({ width: 1920, height: 1080 })
    const uhd = reencodePeakMemoryMiB(UHD)
    const eightK = reencodePeakMemoryMiB({ width: 7680, height: 4320 })
    expect(hd).toBeLessThan(uhd)
    expect(uhd).toBeLessThan(eightK)
  })

  it("fewer threads reserve less (the model is thread-aware)", () => {
    fx.threads = same(2)
    const two = reencodePeakMemoryMiB(UHD)
    fx.threads = same(32)
    expect(reencodePeakMemoryMiB(UHD)).toBeGreaterThan(two)
  })

  it("an unprobed source is assumed to be 4K — never a free ride", () => {
    expect(REENCODE_ASSUMED_CANVAS).toEqual(UHD)
    expect(reencodePeakMemoryMiB(undefined)).toBe(reencodePeakMemoryMiB(UHD))
  })

  it("the fetch's abort ends the wait for memory as the same halt the re-encode raises — and nothing starts", async () => {
    let grant!: () => void
    fx.hold = new Promise<void>((resolve) => { grant = resolve })
    const controller = new AbortController()
    const run = reencodeToH264("/tmp/in.webm", "/tmp/out.mp4", true, { deadline: new FetchDeadline(60_000), signal: controller.signal }).catch((e: unknown) => e)
    await Promise.resolve()
    controller.abort()
    expect(await run).toBeInstanceOf(YtDlpHaltError)
    expect(await run).toMatchObject({ reason: "aborted" })
    expect(fx.spawns).toBe(0)
    grant()
  })

  it("an already-aborted fetch never queues", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(reencodeToH264("/tmp/in.webm", "/tmp/out.mp4", true, { deadline: new FetchDeadline(60_000), signal: controller.signal })).rejects.toMatchObject({ reason: "aborted" })
    expect(fx.slots).toHaveLength(0)
  })

  it("the wait does NOT count against the fetch's deadline: the launch hands the deadline to the admission, and what is left is read after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    let grant!: () => void
    fx.hold = new Promise<void>((resolve) => { grant = resolve })
    const deadline = new FetchDeadline(1_000)
    const run = reencodeToH264("/tmp/in.webm", "/tmp/out.mp4", true, { deadline }).catch((e: unknown) => e)
    await Promise.resolve()
    expect(fx.slots[0]!.opts.deadline).toBe(deadline)
    vi.setSystemTime(Date.now() + 1_500) // it waited 1.5 s for memory, on a 1 s slice
    grant()
    expect(await run).toBeUndefined()
    expect(fx.spawns).toBe(1)
  })

  it("a deadline already spent never queues", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const deadline = new FetchDeadline(1_000)
    vi.setSystemTime(Date.now() + 1_500)
    await expect(reencodeToH264("/tmp/in.webm", "/tmp/out.mp4", true, { deadline })).rejects.toMatchObject({ reason: "out_of_time" })
    expect(fx.slots).toHaveLength(0)
  })
})

describe("the section mux is admitted too", () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(join(HERE, "..", "youtube-video.ts"), "utf8")

  it("muxSectionStreams spawns inside withFfmpegSlot", () => {
    const start = source.indexOf("async function muxSectionStreams")
    expect(start).toBeGreaterThan(0)
    const body = source.slice(start, source.indexOf("/**\n * HD SECTION DOWNLOAD"))
    expect(body.indexOf("withFfmpegSlot(")).toBeGreaterThan(-1)
    expect(body.indexOf("spawnFfmpeg(")).toBeGreaterThan(body.indexOf("withFfmpegSlot("))
  })
})
