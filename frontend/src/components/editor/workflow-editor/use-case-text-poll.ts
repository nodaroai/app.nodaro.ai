/**
 * Following a use-case run whose result is text (Chapters) to its end, on the
 * canvas — its own poller, so its outcomes speak for a use-case run, never for
 * a scrape (`pollJobOutputWithEnd`'s copy):
 *
 *  - completed → its output;
 *  - cancelled (from another tab, the jobs list, the API) → a cancelled
 *    outcome, never a failure;
 *  - failed → an error carrying the job's message (or "Unknown error" in the
 *    reader's language) and its classified hint;
 *  - a run that outlasts `longRunMs` is never given up on: `onLongRun` is told
 *    once, and the run is then followed less often until it ends;
 *  - Stop cancels the job (as the editor's Stop does everywhere) and ends in an
 *    AbortError; a workflow switch ends it in `WorkflowStaleError`. The poll is
 *    a tracked interval, so leaving the workflow stops it.
 *
 * Progress (`job.progress`) is handed to `onProgress` while it runs.
 *
 * Its collaborators from the editor's engine (the status read, the give-up
 * rule, the store) come in through `deps`, so this module stays out of the
 * engine's import cycle.
 */
import { cancelJob } from "@/lib/api"
import { tx } from "@/lib/i18n"
import type { ExecutionContext } from "./types"

/** How often a running text run is asked about. */
export const USE_CASE_TEXT_POLL_MS = 2_000
/** How often a run that outlasted its expected time is asked about. */
export const USE_CASE_TEXT_SLOW_POLL_MS = 30_000

export type UseCaseTextPollOutcome =
  | { readonly kind: "completed"; readonly output: Record<string, unknown> }
  | { readonly kind: "cancelled" }

/** What a status read answers (the lean job read). */
export interface UseCaseTextJobStatus {
  readonly status: string
  readonly output_data?: unknown
  readonly error_message?: string | null
  readonly error_hint?: unknown
  readonly progress?: number | null
}

/** The engine's collaborators. */
export interface UseCaseTextPollDeps {
  /** Read the job (the node-aware read: it keeps the review overlay in step). */
  readonly status: (jobId: string, nodeId: string) => Promise<UseCaseTextJobStatus>
  /** After a failed read: the message to end with when reading is given up, else null to keep trying. */
  readonly gaveUp: (err: unknown, consecutiveFailures: number) => string | null
  /** The error a workflow switch ends the poll with. */
  readonly stale: () => Error
  readonly onProgress: (progress: number) => void
}

export interface UseCaseTextPollOptions {
  /** After this long the run is "taking longer than usual": `onLongRun` once, then the slow cadence. */
  readonly longRunMs: number
  readonly onLongRun?: () => void
}

type PollCtx = Pick<ExecutionContext, "signal" | "isWorkflowStale" | "trackInterval" | "untrackInterval">

export function pollUseCaseTextJob(jobId: string, nodeId: string, ctx: PollCtx, deps: UseCaseTextPollDeps, opts: UseCaseTextPollOptions): Promise<UseCaseTextPollOutcome> {
  return new Promise<UseCaseTextPollOutcome>((resolve, reject) => {
    const startedAt = Date.now()
    let lastAsked = 0
    let failures = 0
    let busy = false
    let done = false
    let toldLong = false
    let lastProgress: number | undefined
    // eslint-disable-next-line prefer-const -- read by `finish`, assigned once the listeners are set
    let poll: ReturnType<typeof setInterval> | undefined

    const finish = (settle: () => void) => {
      if (done) return
      done = true
      if (poll !== undefined) ctx.untrackInterval(poll)
      ctx.signal?.removeEventListener("abort", onAbort)
      settle()
    }
    function onAbort() {
      finish(() => {
        void cancelJob(jobId).catch(() => {})
        reject(new DOMException("Aborted", "AbortError"))
      })
    }

    const tick = async () => {
      if (busy || done) return
      if (ctx.isWorkflowStale()) return finish(() => reject(deps.stale()))
      const now = Date.now()
      const long = now - startedAt >= opts.longRunMs
      if (long && !toldLong) {
        toldLong = true
        opts.onLongRun?.()
      }
      if (long && now - lastAsked < USE_CASE_TEXT_SLOW_POLL_MS) return
      busy = true
      lastAsked = now
      try {
        const job = await deps.status(jobId, nodeId)
        failures = 0
        if (done) return
        if (job.status === "completed") return finish(() => resolve({ kind: "completed", output: (job.output_data as Record<string, unknown> | null) ?? {} }))
        if (job.status === "cancelled") return finish(() => resolve({ kind: "cancelled" }))
        if (job.status === "failed") {
          const message = job.error_message || tx("run.unknownError")
          return finish(() => reject(Object.assign(new Error(message), job.error_hint ? { errorHint: job.error_hint } : {})))
        }
        if (typeof job.progress === "number" && job.progress !== lastProgress) {
          lastProgress = job.progress
          deps.onProgress(job.progress)
        }
      } catch (err) {
        failures += 1
        const message = deps.gaveUp(err, failures)
        if (message !== null) finish(() => reject(new Error(message)))
      } finally {
        busy = false
      }
    }

    if (ctx.signal?.aborted) return onAbort()
    ctx.signal?.addEventListener("abort", onAbort, { once: true })
    poll = ctx.trackInterval(setInterval(() => void tick(), USE_CASE_TEXT_POLL_MS))
  })
}
