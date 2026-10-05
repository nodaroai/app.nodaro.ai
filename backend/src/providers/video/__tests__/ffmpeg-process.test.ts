// The launcher every ffmpeg goes through places the box's thread counts into
// the argv it is given (decided 2026-10-05: every ffmpeg, not only Apply EDL).
// These drive each shared runner — and the spawns that used to start ffmpeg
// on their own — against a mocked child_process, on a box with a quota and on
// one without: with one, every input, filter graph and output is told the
// count; without, the argv reaches ffmpeg exactly as the caller built it.
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FfmpegThreads } from "../ffmpeg-threads.js"

const mocks = vi.hoisted(() => ({
  threads: undefined as FfmpegThreads | undefined,
  execFile: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock("node:child_process", () => ({ execFile: mocks.execFile, spawn: mocks.spawn }))
vi.mock("../ffmpeg-threads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-threads.js")>()),
  ffmpegThreads: () => mocks.threads,
}))

import { execFileFfmpeg, spawnFfmpeg } from "../ffmpeg-process.js"
import { logFfmpegVersion, runFfmpeg, runFfmpegCapture, runFfmpegWithProgress } from "../ffmpeg-utils.js"
import { runFfmpegCancellable } from "../ffmpeg-cancellable.js"
import { reencodeToH264 } from "../video-file-stages.js"

/** A child that exits 0 on the next tick. */
function exitingChild() {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), exitCode: 0, signalCode: null,
  })
  setImmediate(() => proc.emit("close", 0, null))
  return proc
}

beforeEach(() => {
  mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: null, out: string, err: string) => void) => {
    setImmediate(() => cb(null, "", ""))
    return { exitCode: 0, signalCode: null, kill: vi.fn() }
  })
  mocks.spawn.mockImplementation(() => exitingChild())
})
afterEach(() => {
  mocks.threads = undefined
  vi.clearAllMocks()
})

const RENDER = ["-y", "-i", "in.mp4", "-c:v", "libx264", "out.mp4"]
const THREADED = [
  "-filter_complex_threads", "2", "-filter_threads", "2",
  "-y", "-threads", "2", "-i", "in.mp4", "-c:v", "libx264", "-threads", "2", "out.mp4",
]
const lastArgv = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![1] as string[]
const lastCmd = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0] as string

describe("ffmpeg launcher — every runner places the box's counts", () => {
  const QUOTA: FfmpegThreads = { decode: 2, filter: 2, encode: 2 }

  it("spawnFfmpeg and execFileFfmpeg", () => {
    mocks.threads = QUOTA
    spawnFfmpeg(RENDER, { stdio: ["ignore", "pipe", "pipe"] })
    expect(lastCmd(mocks.spawn)).toBe("ffmpeg")
    expect(lastArgv(mocks.spawn)).toEqual(THREADED)
    execFileFfmpeg(RENDER, {}, () => {})
    expect(lastCmd(mocks.execFile)).toBe("ffmpeg")
    expect(lastArgv(mocks.execFile)).toEqual(THREADED)
  })

  it("runFfmpeg and runFfmpegCapture", async () => {
    mocks.threads = QUOTA
    await runFfmpeg(RENDER)
    expect(lastArgv(mocks.execFile)).toEqual(THREADED)
    await runFfmpegCapture(RENDER)
    expect(lastArgv(mocks.execFile)).toEqual(THREADED)
  })

  it("runFfmpegWithProgress — its -progress prefix is read as options", async () => {
    mocks.threads = QUOTA
    await runFfmpegWithProgress(RENDER)
    expect(lastArgv(mocks.spawn)).toEqual([
      "-filter_complex_threads", "2", "-filter_threads", "2",
      "-progress", "pipe:1", "-nostats", "-y", "-threads", "2", "-i", "in.mp4", "-c:v", "libx264", "-threads", "2", "out.mp4",
    ])
  })

  it("runFfmpegCancellable", async () => {
    mocks.threads = QUOTA
    await runFfmpegCancellable(RENDER, new AbortController().signal)
    expect(lastArgv(mocks.spawn)).toEqual(THREADED)
  })

  it("the yt-dlp import's H.264 re-encode", async () => {
    mocks.threads = QUOTA
    await reencodeToH264("in.webm", "out.mp4", true)
    const argv = lastArgv(mocks.spawn)
    expect(argv.slice(0, 4)).toEqual(["-filter_complex_threads", "2", "-filter_threads", "2"])
    expect(argv.slice(4, 8)).toEqual(["-threads", "2", "-i", "in.webm"])
    expect(argv.slice(-3)).toEqual(["-threads", "2", "out.mp4"])
  })

  it("leaves -version alone — its first line keys render caches", () => {
    mocks.threads = QUOTA
    logFfmpegVersion("test")
    expect(lastArgv(mocks.execFile)).toEqual(["-version"])
  })
})

describe("ffmpeg launcher — no quota: the argv exactly as the caller built it", () => {
  it("every runner", async () => {
    mocks.threads = undefined
    await runFfmpeg(RENDER)
    expect(lastArgv(mocks.execFile)).toEqual(RENDER)
    await runFfmpegCapture(RENDER)
    expect(lastArgv(mocks.execFile)).toEqual(RENDER)
    await runFfmpegWithProgress(RENDER)
    expect(lastArgv(mocks.spawn)).toEqual(["-progress", "pipe:1", "-nostats", ...RENDER])
    await runFfmpegCancellable(RENDER, new AbortController().signal)
    expect(lastArgv(mocks.spawn)).toEqual(RENDER)
  })
})
