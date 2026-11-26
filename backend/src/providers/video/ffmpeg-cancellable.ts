import { FfmpegDiagnostics } from "./ffmpeg-failure-detail.js"
import { spawnFfmpeg } from "./ffmpeg-process.js"
import { withFfmpegSlot, type FfmpegLaunchOptions } from "./ffmpeg-utils.js"
import { retryOnShortage, spawnShowsShortage, stderrShowsShortage } from "./ffmpeg-shortage-retry.js"

/** Release the shared CPU slot only after the child process has actually closed. */
export function runFfmpegCancellable(
  args: readonly string[],
  signal: AbortSignal,
  timeoutMs = 10 * 60 * 1000,
  launch?: FfmpegLaunchOptions,
): Promise<void> {
  // A launch that failed for the box's passing shortage runs again, its slot released while it waits.
  return retryOnShortage((tryTimeoutMs) => withFfmpegSlot(() => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const child = spawnFfmpeg(args, { stdio: ["ignore", "ignore", "pipe"] })
    let failure: Error | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = (reason: Error) => {
      if (failure) return
      failure = reason
      child.kill("SIGTERM")
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000)
    }
    const abort = () => stop(signal.reason instanceof Error ? signal.reason : new Error("FFmpeg cancelled"))
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; stop(new Error("FFmpeg timed out")) }, tryTimeoutMs)
    const diagnostics = FfmpegDiagnostics.capture(child.stderr)
    let shortage = false
    child.stderr.on("data", (chunk: Buffer) => {
      if (!shortage && stderrShowsShortage(chunk.toString())) shortage = true
    })
    child.once("error", (error) => {
      failure ??= Object.assign(error, spawnShowsShortage(error as NodeJS.ErrnoException) ? { resourceShortage: true as const } : {})
    })
    child.once("close", (code, exitSignal) => {
      clearTimeout(timeout)
      clearTimeout(killTimer)
      signal.removeEventListener("abort", abort)
      if (signal.aborted) return reject(failure)
      if (!failure && code === 0) return resolve()
      const detail = diagnostics.fields({
        code, signal: exitSignal, signalledByUs: timedOut, stoppedBecause: timedOut ? "its time limit" : undefined,
        processError: (failure as NodeJS.ErrnoException | undefined)?.code,
      })
      const error = failure ?? Object.assign(new Error("FFmpeg failed"), shortage ? { resourceShortage: true as const } : {})
      reject(Object.assign(error, detail))
    })
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
    // Its own watchdog SIGKILLs the child; the slot releases itself shortly
    // after `timeoutMs` regardless (`FFMPEG_SLOT_BACKSTOP_MS`).
  }), { timeoutMs: tryTimeoutMs, signal, label: "ffmpeg", peakMemoryMiB: launch?.peakMemoryMiB }), { limitMs: timeoutMs, label: "ffmpeg", signal })
}
