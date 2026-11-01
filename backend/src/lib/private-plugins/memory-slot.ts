/**
 * `tk.media.withMemorySlot` — a plugin's own image work (decoding, compositing,
 * re-encoding pictures in its process) admitted by the box's ffmpeg admission
 * (decided 2026-11-01), so a fan-out of it cannot run the box out of memory
 * beside the renders, the face passes and the raster borrowers.
 *
 * `fn` runs inside ONE `withFfmpegSlot` hold: one of the process's
 * `FFMPEG_CONCURRENCY` slots, and a reservation of `peakMiB` from the
 * container's memory budget. It waits (never fails) until both are free; a
 * figure larger than the whole budget runs alone, as any launch's does.
 *
 *  - `peakMiB` is clamped to [{@link PLUGIN_MEMORY_SLOT_MIN_MIB},
 *    {@link PLUGIN_MEMORY_SLOT_MAX_MIB}]: below the floor a reservation guards
 *    nothing, and above the ceiling a plugin's figure would hold the box alone.
 *    A figure that is not a finite number is refused (a `TypeError`) before
 *    anything is reserved — the admission would otherwise reserve its default.
 *  - `fn`'s result and errors pass through unchanged. The one error of its own:
 *    a hold past `DEFAULT_FFMPEG_TIMEOUT_MS` (plus the slot's grace and
 *    backstop) is released and the call rejects, while `fn` is left to settle.
 *  - The slot is released when `fn` settles — success, error, or the host's
 *    `JobCancelledError` that a cancelled job's work throws. While still
 *    queued, the job's cancellation is checked (the worker's ambient check,
 *    `throwIfJobCancelled`): a cancel (or a graceful stop,
 *    `JobStopRequestedError`) leaves the queue with that error and reserves
 *    nothing. Outside a job's context there is nothing to cancel.
 *  - `fn` must not call an admitted host member (`runFfmpeg*`, the face
 *    detectors, the ffmpeg-backed media members, the EDL renderer): it would
 *    wait for a slot this hold keeps, and a few such jobs at once would hold
 *    every slot waiting on each other until the backstop fails them all.
 */
import { withFfmpegSlot } from "../../providers/video/ffmpeg-utils.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "../../providers/video/ffmpeg-timeouts.js"
import { throwIfJobCancelled } from "../job-cancellation.js"

/** The least a plugin's hold reserves, MiB. */
export const PLUGIN_MEMORY_SLOT_MIN_MIB = 64
/** The most a plugin's hold reserves, MiB. */
export const PLUGIN_MEMORY_SLOT_MAX_MIB = 4096
/** How often a queued hold checks its job's cancellation (the check itself reads the row at most every 4 s). */
export const PLUGIN_MEMORY_SLOT_CANCEL_POLL_MS = 1000

/** `peakMiB` as reserved: clamped to the range; a non-finite or non-number figure throws. */
export function pluginMemorySlotMiB(peakMiB: unknown): number {
  if (typeof peakMiB !== "number" || !Number.isFinite(peakMiB)) {
    throw new TypeError("tk.media.withMemorySlot: peakMiB must be a finite number of MiB")
  }
  return Math.min(PLUGIN_MEMORY_SLOT_MAX_MIB, Math.max(PLUGIN_MEMORY_SLOT_MIN_MIB, Math.ceil(peakMiB)))
}

/** Abort `controller` once the surrounding job is seen cancelled; returns the stop. */
function watchCancellation(controller: AbortController): () => void {
  const timer = setInterval(() => {
    throwIfJobCancelled().catch((err: unknown) => controller.abort(err))
  }, PLUGIN_MEMORY_SLOT_CANCEL_POLL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

export async function withPluginMemorySlot<T>(
  opts: { readonly peakMiB: number; readonly label: string },
  fn: () => Promise<T>,
): Promise<T> {
  const peakMemoryMiB = pluginMemorySlotMiB(opts?.peakMiB)
  const label = typeof opts?.label === "string" ? opts.label.trim() : ""
  if (!label) throw new TypeError("tk.media.withMemorySlot: label is required")
  if (typeof fn !== "function") throw new TypeError("tk.media.withMemorySlot: fn must be a function")
  // A job already cancelled never queues.
  await throwIfJobCancelled()
  const controller = new AbortController()
  const stopWatching = watchCancellation(controller)
  try {
    return await withFfmpegSlot(
      () => {
        stopWatching()
        return fn()
      },
      { timeoutMs: DEFAULT_FFMPEG_TIMEOUT_MS, signal: controller.signal, label: `plugin:${label}`, peakMemoryMiB },
    )
  } finally {
    stopWatching()
  }
}
