/**
 * The runners run a launch again when it failed for the box's passing
 * shortage (ffmpeg-shortage-retry.ts): each try takes its own slot (the one
 * before is released while it waits), and any other failure is final.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fx = vi.hoisted(() => ({
  acquired: 0,
  released: 0,
  answers: [] as Array<{ error?: Error & { code?: string; syscall?: string; killed?: boolean }; stderr?: string; stdout?: string }>,
}))

vi.mock("../ffmpeg-admission-instance.js", async (orig) => ({
  ...(await orig<typeof import("../ffmpeg-admission-instance.js")>()),
  acquireFfmpegSlot: async () => {
    fx.acquired++
    return () => void fx.released++
  },
}))
vi.mock("../ffmpeg-process.js", async (orig) => ({
  ...(await orig<typeof import("../ffmpeg-process.js")>()),
  execFileFfmpeg: (_args: unknown, _opts: unknown, cb: (error: unknown, stdout: string, stderr: string) => void) => {
    const answer = fx.answers.shift() ?? {}
    queueMicrotask(() => cb(answer.error ?? null, answer.stdout ?? "", answer.stderr ?? ""))
    return { pid: 1, exitCode: 0, signalCode: null, kill: () => true, on: () => undefined, once: () => undefined }
  },
}))

const { runFfmpeg, runFfmpegCapture } = await import("../ffmpeg-utils.js")

const failed = (stderr: string) => ({ error: Object.assign(new Error("Command failed: ffmpeg"), { code: "1" }), stderr })

beforeEach(() => {
  Object.assign(fx, { acquired: 0, released: 0, answers: [] })
  vi.spyOn(Math, "random").mockReturnValue(0)
})
afterEach(() => vi.restoreAllMocks())

describe("runFfmpeg on the box's passing shortage", () => {
  it("runs again after a wait, on a slot of its own each try, and its answer stands", async () => {
    fx.answers = [failed("[swscaler @ 0x1] Failed to create thread: Resource temporarily unavailable\nError reinitializing filters!"), { stdout: "ok" }]
    expect(await runFfmpeg(["-i", "a.mp4", "out.mp4"], 600_000)).toBe("ok")
    expect(fx.acquired).toBe(2)
    expect(fx.released).toBe(2)
  }, 20_000)

  it("a spawn refused for want of a process runs again too", async () => {
    fx.answers = [{ error: Object.assign(new Error("spawn ffmpeg EAGAIN"), { code: "EAGAIN", syscall: "spawn ffmpeg" }) }, { stdout: "ok" }]
    expect(await runFfmpeg(["-version"], 600_000)).toBe("ok")
    expect(fx.acquired).toBe(2)
  }, 20_000)

  it("any other failure is final, after one try", async () => {
    fx.answers = [failed("Invalid data found when processing input")]
    await expect(runFfmpeg(["-i", "a.mp4", "out.mp4"], 600_000)).rejects.toThrow(/Invalid data/)
    expect(fx.acquired).toBe(1)
  })

  it("a stopped launch is never run again", async () => {
    fx.answers = [{ error: Object.assign(new Error("killed"), { code: "1", killed: true }), stderr: "Resource temporarily unavailable" }]
    await expect(runFfmpeg(["-i", "a.mp4", "out.mp4"], 600_000)).rejects.toBeTruthy()
    expect(fx.acquired).toBe(1)
  })
})

describe("runFfmpegCapture on the box's passing shortage", () => {
  it("runs again, and answers its stdout and stderr", async () => {
    fx.answers = [failed("pthread_create() failed: Resource temporarily unavailable"), { stdout: "", stderr: "silence_start: 1.5" }]
    expect(await runFfmpegCapture(["-i", "a.wav", "-af", "silencedetect", "-f", "null", "-"], 600_000)).toEqual({ stdout: "", stderr: "silence_start: 1.5" })
    expect(fx.acquired).toBe(2)
  }, 20_000)
})
