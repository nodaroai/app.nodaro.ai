import { spawn } from "node:child_process"
import { withFfmpegSlot } from "./ffmpeg-utils.js"

/** Release the shared CPU slot only after the child process has actually closed. */
export function runFfmpegCancellable(args: readonly string[], signal: AbortSignal, timeoutMs = 10 * 60 * 1000): Promise<void> {
  return withFfmpegSlot(() => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const child = spawn("ffmpeg", [...args], { stdio: ["ignore", "ignore", "pipe"] })
    let failure: Error | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = (reason: Error) => {
      if (failure) return
      failure = reason
      child.kill("SIGTERM")
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000)
    }
    const abort = () => stop(signal.reason instanceof Error ? signal.reason : new Error("FFmpeg cancelled"))
    const timeout = setTimeout(() => stop(new Error("FFmpeg timed out")), timeoutMs)
    // Drain stderr without retaining potentially large logs or media URLs.
    child.stderr.resume()
    child.once("error", (error) => { failure ??= error })
    child.once("close", (code) => {
      clearTimeout(timeout)
      clearTimeout(killTimer)
      signal.removeEventListener("abort", abort)
      if (failure || code !== 0) reject(failure ?? new Error("FFmpeg failed"))
      else resolve()
    })
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  }), signal)
}
