import { JobCancelledError } from "../lib/job-cancellation.js"
import { DrainAbortError } from "../lib/worker-drain.js"

interface RenderCancellationOptions {
  jobId: string
  timeoutMs: number
  pollMs?: number
  isCancelled(): Promise<boolean>
  isDraining(): boolean
  /** Cancels Remotion and closes any browser used during metadata selection. */
  cancel(): void | Promise<void>
}

/** Stop the underlying work, then await its cleanup before releasing the job. */
export async function withRenderCancellation<T>(
  options: RenderCancellationOptions,
  work: () => Promise<T>,
): Promise<T> {
  let reason: Error | undefined
  let finished = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let polling: Promise<void> | undefined
  let cancelling: Promise<void> | undefined

  function abort(error: Error) {
    if (reason || finished) return
    reason = error
    // Attach a rejection handler immediately; the render promise is still
    // running and may take time to finish closing Chromium/ffmpeg.
    cancelling = Promise.resolve().then(options.cancel).catch(() => {})
  }
  function poll() {
    polling = (async () => {
      try {
        if (options.isDraining()) abort(new DrainAbortError())
        else if (await options.isCancelled()) abort(new JobCancelledError(options.jobId))
      } catch (error) {
        abort(error instanceof Error ? error : new Error("Failed to check render cancellation"))
      }
      if (!finished && !reason) pollTimer = setTimeout(poll, options.pollMs ?? 2000)
    })()
  }

  if (options.isDraining()) throw new DrainAbortError()
  if (await options.isCancelled()) throw new JobCancelledError(options.jobId)
  const timeout = setTimeout(() => abort(new Error("Render timed out")), options.timeoutMs)
  pollTimer = setTimeout(poll, options.pollMs ?? 2000)
  try {
    const output = await work()
    if (reason) throw reason
    return output
  } catch (error) {
    throw reason ?? error
  } finally {
    finished = true
    clearTimeout(timeout)
    clearTimeout(pollTimer)
    await polling
    await cancelling
  }
}
