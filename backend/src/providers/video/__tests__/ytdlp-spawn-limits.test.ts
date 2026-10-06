/**
 * The yt-dlp spawns the hardened social-post lane relies on: a minimal child
 * environment, one wall-clock limit, and the caller's abort — each kills the
 * process and rejects, so a hung fetch never holds a worker. A halt (aborted,
 * out of time, refused by the filter) is never retried on another client or
 * proxy, and nothing is spawned once one has happened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"

type FakeProc = EventEmitter & { kill: ReturnType<typeof vi.fn>; stdout: EventEmitter; stderr: EventEmitter; pid?: number }
const spawned = vi.hoisted(() => ({ calls: [] as Array<{ args: string[]; options: Record<string, unknown> }>, procs: [] as FakeProc[], pid: undefined as number | undefined }))
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn((_bin: string, args: string[], options: Record<string, unknown>) => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
      pid: spawned.pid,
    })
    spawned.calls.push({ args, options })
    spawned.procs.push(proc)
    return proc
  }),
}))

const chain = vi.hoisted(() => ({ attempts: [null] as Array<string | null> }))
vi.mock("../yt-proxy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../yt-proxy.js")>()),
  resolveAttemptChain: () => chain.attempts,
}))

import { downloadYouTubeVideo, probeStreams, reencodeToH264, runYtDlpCapture, spawnYtDlpDownload } from "../youtube-video.js"
import { FetchDeadline, YTDLP_REFUSED_MESSAGE, YtDlpHaltError, killYtDlpProcess, remainingLimits } from "../ytdlp-process.js"
import { withFfmpegSlot } from "../ffmpeg-utils.js"

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  spawned.calls = []
  spawned.procs = []
  spawned.pid = undefined
  chain.attempts = [null]
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("spawnYtDlpDownload", () => {
  it("runs with the environment it is given, and the default one otherwise", async () => {
    const minimal = { PATH: "/usr/bin", HOME: "/home/app" }
    const run = spawnYtDlpDownload(["x"], undefined, { env: minimal })
    expect(spawned.calls[0].options.env).toEqual(minimal)
    spawned.procs[0].emit("close", 0)
    await run
    const plain = spawnYtDlpDownload(["x"])
    expect(spawned.calls[1].options.env).toBeUndefined()
    spawned.procs[1].emit("close", 0)
    await plain
  })

  it("kills and halts past its wall-clock limit, even while output keeps coming", async () => {
    const run = spawnYtDlpDownload(["x"], undefined, { totalTimeoutMs: 1_000 })
    const outcome = run.catch((err: Error) => err)
    for (let i = 0; i < 5; i++) {
      spawned.procs[0].stdout.emit("data", Buffer.from("download: 10%\n"))
      vi.advanceTimersByTime(300)
    }
    const err = await outcome
    expect(err).toBeInstanceOf(YtDlpHaltError)
    expect((err as Error).message).toMatch(/took longer than 1000ms/)
    expect(spawned.procs[0].kill).toHaveBeenCalledWith("SIGKILL")
  })

  it("kills and halts on the caller's abort", async () => {
    const controller = new AbortController()
    const run = spawnYtDlpDownload(["x"], undefined, { signal: controller.signal })
    controller.abort()
    await expect(run).rejects.toBeInstanceOf(YtDlpHaltError)
    expect(spawned.procs[0].kill).toHaveBeenCalledWith("SIGKILL")
  })

  it("spawns nothing when the caller has already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(spawnYtDlpDownload(["x"], undefined, { signal: controller.signal })).rejects.toThrow(/aborted/)
    expect(spawned.calls).toHaveLength(0)
  })

  it("a video the length or live filter refused is a halt, in words of its own (yt-dlp prints the filter line to stdout)", async () => {
    const run = spawnYtDlpDownload(["x"])
    spawned.procs[0].stdout.emit("data", Buffer.from("[download] Some reel does not pass filter (!is_live & duration <=? 600), stopping\n"))
    spawned.procs[0].stderr.emit("data", Buffer.from("WARNING: [Instagram] unrelated warning\n"))
    spawned.procs[0].emit("close", 101)
    await expect(run).rejects.toMatchObject({ name: "YtDlpHaltError", reason: "refused", message: YTDLP_REFUSED_MESSAGE })
  })

  it("keeps the shape plugins match a halt on: its name and its reason", () => {
    const halt = new YtDlpHaltError("x", "refused")
    expect(halt).toBeInstanceOf(Error)
    expect(halt.name).toBe("YtDlpHaltError")
    expect((halt as unknown as { reason: unknown }).reason).toBe("refused")
  })

  it("a stall is an ordinary failure, and output after the end arms no timer", async () => {
    const run = spawnYtDlpDownload(["x"], undefined, { idleTimeoutMs: 5_000 })
    const outcome = run.catch((err: Error) => err)
    vi.advanceTimersByTime(5_001)
    const err = await outcome
    expect(err).not.toBeInstanceOf(YtDlpHaltError)
    expect((err as Error).message).toMatch(/stalled/)
    spawned.procs[0].stdout.emit("data", Buffer.from("download: 99%\n"))
    expect(vi.getTimerCount()).toBe(0)
  })

  it.runIf(process.platform !== "win32")("on Linux, leads its own process group and stops the whole group", () => {
    spawned.pid = 4242
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true)
    void spawnYtDlpDownload(["x"]).catch(() => {})
    expect(spawned.calls[0].options.detached).toBe(true)
    killYtDlpProcess(spawned.procs[0] as never)
    expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM")
    vi.advanceTimersByTime(2_000)
    expect(kill).toHaveBeenCalledWith(-4242, "SIGKILL")
  })

  it.runIf(process.platform !== "win32")("on Linux, a group it cannot signal is stopped at the process itself", () => {
    spawned.pid = 4242
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" })
    })
    void spawnYtDlpDownload(["x"]).catch(() => {})
    killYtDlpProcess(spawned.procs[0] as never)
    expect(spawned.procs[0].kill).toHaveBeenCalledWith("SIGKILL")
  })
})

describe("the ffmpeg stages after a download, held to the fetch's deadline and abort", () => {
  it("the re-encode halts when the deadline passes, and when the caller aborts", async () => {
    const late = reencodeToH264("/tmp/in.mp4", "/tmp/out.mp4", true, { deadline: new FetchDeadline(1_000) }).catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(0) // admitted: the ffmpeg starts once the queue lets it
    vi.advanceTimersByTime(1_001)
    spawned.procs[0].emit("close", null)
    expect(await late).toMatchObject({ name: "YtDlpHaltError", reason: "out_of_time" })
    expect(spawned.procs[0].kill).toHaveBeenCalledWith("SIGKILL")

    const controller = new AbortController()
    const aborted = reencodeToH264("/tmp/in.mp4", "/tmp/out.mp4", true, { deadline: new FetchDeadline(60_000), signal: controller.signal }).catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    spawned.procs[1].emit("close", null)
    expect(await aborted).toMatchObject({ name: "YtDlpHaltError", reason: "aborted" })
  })

  it("the stream probe stops at the deadline and answers unknown", async () => {
    const run = probeStreams("/tmp/in.mp4", { timeoutMs: 1_000 })
    vi.advanceTimersByTime(1_001)
    expect(spawned.procs[0].kill).toHaveBeenCalledWith("SIGKILL")
    spawned.procs[0].emit("close", null)
    expect(await run).toEqual({ videoCodec: null, hasAudio: null, width: null, height: null })
  })
})

describe("runYtDlpCapture", () => {
  it("passes the environment, and halts on the caller's abort", async () => {
    const controller = new AbortController()
    const run = runYtDlpCapture(["--dump-json"], { timeoutMs: 15_000, env: { PATH: "/usr/bin" }, signal: controller.signal })
    expect(spawned.calls[0].options.env).toEqual({ PATH: "/usr/bin" })
    controller.abort()
    await expect(run).rejects.toBeInstanceOf(YtDlpHaltError)
    expect(spawned.procs[0].kill).toHaveBeenCalledWith("SIGKILL")
  })

  it("its own timeout is an ordinary failure (the next client may answer); the caller's deadline is a halt", async () => {
    const timedOut = runYtDlpCapture(["x"], { timeoutMs: 1_000 }).catch((err: Error) => err)
    vi.advanceTimersByTime(1_001)
    expect(await timedOut).not.toBeInstanceOf(YtDlpHaltError)
    const late = runYtDlpCapture(["x"], { timeoutMs: 15_000, totalTimeoutMs: 1_000 }).catch((err: Error) => err)
    vi.advanceTimersByTime(1_001)
    expect(await late).toBeInstanceOf(YtDlpHaltError)
  })

  it("halts when the output runs past its cap", async () => {
    const run = runYtDlpCapture(["x"], { timeoutMs: 15_000, maxBytes: 10 })
    spawned.procs[0].stdout.emit("data", Buffer.from("x".repeat(11)))
    await expect(run).rejects.toMatchObject({ reason: "too_much_output" })
    expect(spawned.procs[0].kill).toHaveBeenCalledWith("SIGKILL")
  })
})

describe("downloadYouTubeVideo — a halt is never retried", () => {
  const hardening = { extraArgs: [], env: { PATH: "/usr/bin" }, totalTimeoutMs: 60_000 }
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

  it("an ordinary failure walks the YouTube client ladder", async () => {
    const run = downloadYouTubeVideo({ url, outPath: "/tmp/x.mp4", hardening }).catch((err: Error) => err)
    for (let i = 0; i < 3; i++) {
      await flush()
      spawned.procs[i]?.emit("close", 1)
    }
    await run
    expect(spawned.calls).toHaveLength(3)
  })

  it("a refusal by the filter stops at the first client", async () => {
    const run = downloadYouTubeVideo({ url, outPath: "/tmp/x.mp4", hardening }).catch((err: Error) => err)
    await flush()
    spawned.procs[0].emit("close", 101)
    expect(await run).toBeInstanceOf(YtDlpHaltError)
    await flush()
    expect(spawned.calls).toHaveLength(1)
  })

  it("a refusal by the filter is not tried through another proxy either", async () => {
    chain.attempts = ["http://proxy-a.example:8080", "http://proxy-b.example:8080"]
    const run = downloadYouTubeVideo({ url, outPath: "/tmp/x.mp4", hardening }).catch((err: Error) => err)
    await flush()
    spawned.procs[0].emit("close", 101)
    expect(await run).toBeInstanceOf(YtDlpHaltError)
    await flush()
    expect(spawned.calls).toHaveLength(1)
  })

  it("past the fetch's deadline, no other client is spawned", async () => {
    const run = downloadYouTubeVideo({ url, outPath: "/tmp/x.mp4", hardening: { ...hardening, totalTimeoutMs: 1_000 } }).catch((err: Error) => err)
    await flush()
    vi.setSystemTime(Date.now() + 2_000)
    spawned.procs[0].emit("close", 1)
    expect(await run).toBeInstanceOf(YtDlpHaltError)
    expect(spawned.calls).toHaveLength(1)
  })
})

// ONE RULE for every deadline-bounded caller of the ffmpeg admission (round 3 of
// #1860, decided 2026-10-05): the time a launch spends WAITING for its slot or
// its memory is not the fetch's. The admission excuses what a launch waited from
// the deadline it was handed — the same philosophy as the slot-wait ledger that
// pauses the heartbeat — so a busy box never fails an import as out_of_time, while
// everything after admission is still held to the deadline.
describe("the fetch deadline does not run while a launch waits for admission", () => {
  /** Hold the whole memory budget: an oversized launch runs alone, so every other launch queues behind it. */
  async function holdTheBox(): Promise<() => void> {
    let release!: () => void
    const held = withFfmpegSlot(() => new Promise<void>((resolve) => { release = resolve }), {
      timeoutMs: 24 * 60 * 60_000, peakMemoryMiB: 1_000_000_000, label: "the box",
    })
    held.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    return () => release()
  }

  it("FetchDeadline: remaining time shrinks with the clock and grows by what is excused", () => {
    let t = 1_000
    const deadline = new FetchDeadline(10_000, () => t)
    expect(deadline.remainingMs()).toBe(10_000)
    t += 4_000
    expect(deadline.remainingMs()).toBe(6_000)
    deadline.excuse(3_500)
    expect(deadline.remainingMs()).toBe(9_500)
    deadline.excuse(-5)
    deadline.excuse(Number.NaN)
    expect(deadline.remainingMs()).toBe(9_500)
  })

  it("remainingLimits reads the deadline: out_of_time once nothing is left, an abort first", () => {
    let t = 0
    const deadline = new FetchDeadline(1_000, () => t)
    expect(remainingLimits(deadline, { env: { A: "1" } })).toEqual({ env: { A: "1" }, totalTimeoutMs: 1_000 })
    t = 1_500
    expect(() => remainingLimits(deadline, {})).toThrow(expect.objectContaining({ reason: "out_of_time" }))
    deadline.excuse(1_000)
    expect(remainingLimits(deadline, {}).totalTimeoutMs).toBe(500)
    const controller = new AbortController()
    controller.abort()
    expect(() => remainingLimits(deadline, { signal: controller.signal })).toThrow(expect.objectContaining({ reason: "aborted" }))
  })

  it("a re-encode that waits far longer than its slice for memory is NOT failed out_of_time", async () => {
    const release = await holdTheBox()
    const run = reencodeToH264("/tmp/in.mp4", "/tmp/out.mp4", true, { deadline: new FetchDeadline(1_000) }).catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(30_000) // 30 s queued behind a 1 s slice
    expect(spawned.calls).toHaveLength(0)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(spawned.calls).toHaveLength(1) // admitted and started
    spawned.procs[0].emit("close", 0)
    expect(await run).toBeUndefined() // the import succeeded
    expect(spawned.procs[0].kill).not.toHaveBeenCalled()
  })

  it("a slow re-encode AFTER admission still hits its deadline — the wait bought no extra run time", async () => {
    const release = await holdTheBox()
    const deadline = new FetchDeadline(1_000)
    const run = reencodeToH264("/tmp/in.mp4", "/tmp/out.mp4", true, { deadline }).catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(30_000)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(spawned.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(900) // inside the slice
    expect(spawned.procs[0].kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200) // past it
    spawned.procs[0].emit("close", null)
    expect(await run).toMatchObject({ name: "YtDlpHaltError", reason: "out_of_time" })
    expect(spawned.procs[0].kill).toHaveBeenCalledWith("SIGKILL")
  })

  it("a deadline already spent before the launch queues is out_of_time at once, not after a wait", async () => {
    const deadline = new FetchDeadline(1_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(reencodeToH264("/tmp/in.mp4", "/tmp/out.mp4", true, { deadline })).rejects.toMatchObject({ reason: "out_of_time" })
    expect(spawned.calls).toHaveLength(0)
  })

  it("the abort still ends the wait", async () => {
    const release = await holdTheBox()
    const controller = new AbortController()
    const run = reencodeToH264("/tmp/in.mp4", "/tmp/out.mp4", true, { deadline: new FetchDeadline(60_000), signal: controller.signal }).catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(5_000)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(await run).toMatchObject({ name: "YtDlpHaltError", reason: "aborted" })
    expect(spawned.calls).toHaveLength(0)
    release()
  })

  it("the rule is the launcher's, for every caller: withFfmpegSlot excuses the deadline it is handed by what it waited", async () => {
    const release = await holdTheBox()
    const deadline = new FetchDeadline(1_000)
    const ran = vi.fn(async () => deadline.remainingMs())
    const run = withFfmpegSlot(ran, { timeoutMs: 60_000, deadline })
    await vi.advanceTimersByTimeAsync(7_000)
    expect(ran).not.toHaveBeenCalled()
    release()
    await vi.advanceTimersByTimeAsync(0)
    // What is left once the work starts is the whole slice again.
    expect(await run).toBe(1_000)
  })
})
