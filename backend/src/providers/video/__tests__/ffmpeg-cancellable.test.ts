import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), released: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }))
vi.mock("../ffmpeg-utils.js", () => ({ withFfmpegSlot: async (fn: () => Promise<void>, signal: AbortSignal) => {
  signal.throwIfAborted()
  try { await fn() } finally { mocks.released() }
} }))
import { runFfmpegCancellable } from "../ffmpeg-cancellable.js"
function child() {
  const process = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn() })
  mocks.spawn.mockReturnValue(process)
  return process
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
describe("cancellable FFmpeg process", () => {
  it("does not release its CPU slot until a cancelled process closes", async () => {
    const process = child(), controller = new AbortController()
    const running = runFfmpegCancellable(["-version"], controller.signal)
    const rejected = expect(running).rejects.toThrow("stop")
    controller.abort(new Error("stop"))
    expect(process.kill).toHaveBeenCalledWith("SIGTERM")
    expect(mocks.released).not.toHaveBeenCalled()
    process.emit("close", null)
    await rejected
    expect(mocks.released).toHaveBeenCalledOnce()
  })
  it("escalates to SIGKILL and still waits for close", async () => {
    vi.useFakeTimers()
    const process = child(), controller = new AbortController()
    const rejected = expect(runFfmpegCancellable([], controller.signal, 20)).rejects.toThrow("timed out")
    await vi.advanceTimersByTimeAsync(1020)
    expect(process.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]])
    expect(mocks.released).not.toHaveBeenCalled()
    process.emit("close", null)
    await rejected
  })
  it("does not start work for an already cancelled signal", async () => {
    await expect(runFfmpegCancellable([], AbortSignal.abort())).rejects.toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
