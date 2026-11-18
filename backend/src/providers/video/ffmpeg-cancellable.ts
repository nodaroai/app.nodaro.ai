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
    const timeout = setTimeout(() => stop(new Error("FFmpeg timed out")), tryTimeoutMs)
    // Drain stderr without retaining potentially large logs or media URLs — only whether it
    // reported the box's passing shortage (a thread it could not create) is kept.
    let shortage = false
    child.stderr.on("data", (chunk: Buffer) => {
      if (!shortage && stderrShowsShortage(chunk.toString())) shortage = true
    })
    child.once("error", (error) => {
      failure ??= Object.assign(error, spawnShowsShortage(error as NodeJS.ErrnoException) ? { resourceShortage: true as const } : {})
    })
    child.once("close", (code) => {
      clearTimeout(timeout)
      clearTimeout(killTimer)
      signal.removeEventListener("abort", abort)
      if (failure || code !== 0) reject(failure ?? Object.assign(new Error("FFmpeg failed"), shortage ? { resourceShortage: true as const } : {}))
      else resolve()
    })
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
    // Its own watchdog SIGKILLs the child; the slot releases itself shortly
    // after `timeoutMs` regardless (`FFMPEG_SLOT_BACKSTOP_MS`).
  }), { timeoutMs: tryTimeoutMs, signal, label: "ffmpeg", peakMemoryMiB: launch?.peakMemoryMiB }), { limitMs: timeoutMs, label: "ffmpeg", signal })
}
