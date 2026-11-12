/**
 * An `AbortSignal` for one step of a workflow run that fetches before its job
 * is reserved (Nodaro Image Upscale's input copy, node-executor.ts): aborted
 * when this worker begins its deploy drain (`workerDrainSignal`, reason
 * `DrainAbortError`), or when the run is cancelled — `ctx.cancelled`, or the
 * same throttled read every long wait of the engine makes
 * (`executionCancelledNow`). So a stopped run stops fetching instead of
 * finishing a download nobody will use. `dispose()` stops the poll; call it in
 * `finally`.
 */
import { workerDrainSignal } from "../../lib/worker-drain.js"
import { executionCancelledNow } from "./execution-cancel-check.js"
import { JOB_POLL_INTERVAL_MS, type OrchestratorContext } from "./types.js"

/** The reason a cancelled run's signal carries. */
export function executionCancelledError(): Error {
  return new Error("Execution cancelled")
}

export function runStopSignal(
  ctx: OrchestratorContext,
  opts: { readonly pollMs?: number; readonly drain?: AbortSignal } = {},
): { readonly signal: AbortSignal; dispose(): void } {
  const cancel = new AbortController()
  const stop = () => {
    if (!cancel.signal.aborted) cancel.abort(executionCancelledError())
  }
  if (ctx.cancelled) stop()
  let cycle = 0
  const timer = setInterval(() => {
    if (ctx.cancelled) return stop()
    void executionCancelledNow(ctx, ++cycle).then((cancelled) => {
      if (cancelled) stop()
    }, () => undefined)
  }, opts.pollMs ?? JOB_POLL_INTERVAL_MS)
  timer.unref?.()
  const signal = AbortSignal.any([opts.drain ?? workerDrainSignal(), cancel.signal])
  return { signal, dispose: () => clearInterval(timer) }
}
