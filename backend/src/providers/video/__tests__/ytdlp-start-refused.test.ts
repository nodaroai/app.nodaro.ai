/**
 * A yt-dlp the system refused to START. On 2026-11-25 the container had no
 * process free for minutes: every proxy attempt of a download failed inside one
 * second as `spawn /usr/local/bin/yt-dlp EAGAIN`, each one reported as that
 * proxy's failure ("trying next"), and the person was shown the system's words.
 * A refused start is waited out and started again; when the waiting gives up
 * the run halts, so no other client or proxy is tried, and the message is the
 * server's, not the system's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "node:events"

type FakeProc = EventEmitter & { kill: ReturnType<typeof vi.fn>; stdout: EventEmitter; stderr: EventEmitter; pid?: number }
const spawned = vi.hoisted(() => ({ procs: [] as FakeProc[] }))
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(() => {
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), pid: undefined })
    spawned.procs.push(proc)
    return proc
  }),
}))

import { BOX_SHORTAGE_MESSAGE, isResourceShortage } from "../ffmpeg-shortage-retry.js"
import { YtDlpHaltError, runYtDlpCaptureWith, runYtDlpToEndWith, spawnYtDlpDownloadWith } from "../ytdlp-process.js"
import { runThroughClientLadder } from "../youtube-video.js"

const refused = () => Object.assign(new Error("spawn /usr/local/bin/yt-dlp EAGAIN"), { code: "EAGAIN", syscall: "spawn /usr/local/bin/yt-dlp" })
const missing = () => Object.assign(new Error("spawn /usr/local/bin/yt-dlp ENOENT"), { code: "ENOENT", syscall: "spawn /usr/local/bin/yt-dlp" })

/** Lets the pending promise callbacks run, then moves the clock. */
const pass = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  spawned.procs = []
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  // No jitter: the waits are 2 s, then 4 s.
  vi.spyOn(Math, "random").mockReturnValue(0)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("a download whose yt-dlp the system refused to start", () => {
  it("is started again after a wait, and its result stands", async () => {
    const run = spawnYtDlpDownloadWith("yt-dlp", ["x"], undefined, { idleTimeoutMs: 90_000 })
    expect(spawned.procs).toHaveLength(1)
    spawned.procs[0].emit("error", refused())
    await pass(1_999)
    expect(spawned.procs).toHaveLength(1)
    await pass(1)
    expect(spawned.procs).toHaveLength(2)
    spawned.procs[1].emit("close", 0)
    await expect(run).resolves.toBeUndefined()
  })

  it("halts when the waiting gives up, as the server being busy", async () => {
    const run = spawnYtDlpDownloadWith("yt-dlp", ["x"], undefined, { idleTimeoutMs: 90_000 })
    const outcome = run.catch((err: unknown) => err)
    for (let i = 0; i < 3; i++) {
      spawned.procs[i].emit("error", refused())
      await pass(4_000)
    }
    const err = await outcome
    expect(err).toBeInstanceOf(YtDlpHaltError)
    expect((err as YtDlpHaltError).reason).toBe("server_busy")
    expect((err as Error).message).toBe(BOX_SHORTAGE_MESSAGE)
    expect(isResourceShortage(err)).toBe(true)
    expect(spawned.procs).toHaveLength(3)
  })

  it("every try runs on what is left of the run's own wall-clock limit", async () => {
    const run = spawnYtDlpDownloadWith("yt-dlp", ["x"], undefined, { idleTimeoutMs: 90_000, totalTimeoutMs: 20_000 })
    const outcome = run.catch((err: unknown) => err)
    spawned.procs[0].emit("error", refused())
    await pass(2_000)
    expect(spawned.procs).toHaveLength(2)
    // 18 s are left of the 20: the second try is stopped then, not 20 s after it began.
    await pass(17_999)
    expect(spawned.procs[1].kill).not.toHaveBeenCalled()
    await pass(1)
    const err = await outcome
    expect(err).toBeInstanceOf(YtDlpHaltError)
    expect((err as YtDlpHaltError).reason).toBe("out_of_time")
  })

  it("a caller's abort during the wait is yt-dlp's own halt", async () => {
    const stop = new AbortController()
    const run = spawnYtDlpDownloadWith("yt-dlp", ["x"], undefined, { idleTimeoutMs: 90_000, signal: stop.signal })
    const outcome = run.catch((err: unknown) => err)
    spawned.procs[0].emit("error", refused())
    await pass(500)
    stop.abort()
    await pass(0)
    const err = await outcome
    expect(err).toBeInstanceOf(YtDlpHaltError)
    expect((err as YtDlpHaltError).reason).toBe("aborted")
    expect(spawned.procs).toHaveLength(1)
  })

  it("any other spawn failure is thrown at once, as it is", async () => {
    const run = spawnYtDlpDownloadWith("yt-dlp", ["x"], undefined, { idleTimeoutMs: 90_000 })
    const outcome = run.catch((err: unknown) => err)
    spawned.procs[0].emit("error", missing())
    await pass(0)
    const err = await outcome
    expect(err).not.toBeInstanceOf(YtDlpHaltError)
    expect((err as Error).message).toContain("ENOENT")
    expect(spawned.procs).toHaveLength(1)
  })

  it("a run that started and then failed is not started again", async () => {
    const run = spawnYtDlpDownloadWith("yt-dlp", ["x"], undefined, { idleTimeoutMs: 90_000 })
    const outcome = run.catch((err: unknown) => err)
    spawned.procs[0].stderr.emit("data", Buffer.from("ERROR: [youtube] abc: Sign in to confirm you are not a bot\n"))
    spawned.procs[0].emit("close", 1)
    await pass(10_000)
    expect((await outcome as Error).message).toContain("Sign in to confirm")
    expect(spawned.procs).toHaveLength(1)
  })
})

describe("the other yt-dlp runs", () => {
  it("a capture is started again too, and never outlasts its own time limit", async () => {
    const run = runYtDlpCaptureWith("yt-dlp", ["--dump-json", "x"], { timeoutMs: 15_000 })
    const outcome = run.catch((err: unknown) => err)
    spawned.procs[0].emit("error", refused())
    await pass(2_000)
    expect(spawned.procs).toHaveLength(2)
    // 13 s are left of the 15: the second try is stopped then.
    await pass(12_999)
    expect(spawned.procs[1].kill).not.toHaveBeenCalled()
    await pass(1)
    expect((await outcome as Error).message).toContain("timed out")
  })

  it("an extraction that writes a file is started again too", async () => {
    const run = runYtDlpToEndWith("yt-dlp", ["-x", "x"])
    spawned.procs[0].emit("error", refused())
    await pass(2_000)
    expect(spawned.procs).toHaveLength(2)
    spawned.procs[1].emit("close", 0)
    await expect(run).resolves.toBeUndefined()
  })
})

describe("a client ladder", () => {
  it("stops at a run the server could not start: the next client is not tried", async () => {
    let rungs = 0
    const outcome = runThroughClientLadder("https://www.youtube.com/watch?v=abc", () => {
      rungs += 1
      return spawnYtDlpDownloadWith("yt-dlp", ["x"], undefined, { idleTimeoutMs: 90_000 })
    }).catch((err: unknown) => err)
    for (let i = 0; i < 3; i++) {
      await pass(0)
      spawned.procs[i].emit("error", refused())
      await pass(4_000)
    }
    const err = await outcome
    expect(err).toBeInstanceOf(YtDlpHaltError)
    expect(rungs).toBe(1)
    expect(spawned.procs).toHaveLength(3)
  })
})
