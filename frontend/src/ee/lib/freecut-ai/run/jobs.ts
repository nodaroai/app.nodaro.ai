/**
 * The paid work of a run, as platform jobs: started only when they will be
 * used, followed to their end, and cancelled when the run ends early. Also the
 * small waiting helpers every part of a run shares.
 */
import type { MessageKey } from "@/lib/i18n"
import { InsufficientCreditsError, cancelJob, getJobStatusLean } from "@/lib/api"
import { EditorLinkError } from "../editor-link"
import { RunFailed, RunStopped } from "./types"

export const JOB_POLL_MS = 1500

export function checkStop(signal: AbortSignal) {
  if (signal.aborted) throw new RunStopped()
}

export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new RunStopped())
    const onAbort = () => {
      clearTimeout(timer)
      reject(new RunStopped())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, Math.max(0, ms))
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

/** A promise that settles as given, or ends with RunStopped once the run is stopped. */
export function untilStopped<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new RunStopped())
    const onAbort = () => reject(new RunStopped())
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

export class JobTimedOut extends Error {}

/** A job that failed for good: its sentence, with the provider's words when it had any. */
export class JobFailed extends Error {
  constructor(
    message: string,
    readonly errorDetail?: string,
  ) {
    super(message)
    this.name = "JobFailed"
  }
}

/** A job whose status cannot be read (signed out): it may still run, so it stays open to be cancelled. */
export class JobUnreadable extends Error {
  constructor() {
    super("unreadable")
    this.name = "JobUnreadable"
  }
}

const statusOf = (error: unknown) => (error as { status?: unknown } | null)?.status

/** A job's output once it completes. Throws when it fails, is gone, or takes too long. */
export async function waitForJob(jobId: string, signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> {
  const end = Date.now() + timeoutMs
  for (;;) {
    checkStop(signal)
    try {
      const job = await getJobStatusLean(jobId)
      if (job.status === "completed") return (job.output_data ?? {}) as Record<string, unknown>
      if (job.status === "failed" || job.status === "cancelled") throw new JobFailed(job.error_message ?? "failed", job.error_detail ?? undefined)
    } catch (error) {
      if (error instanceof JobFailed) throw error
      const status = statusOf(error)
      // A job this person cannot see, or one that is gone, will not come back.
      if (status === 403 || status === 404 || status === 410) throw new JobFailed(String(status))
      // Signed out: the job may still be running, so it stays open to be cancelled.
      if (status === 401) throw new JobUnreadable()
      // Anything else (the API restarting, the network) is waited out, up to the job's own deadline.
    }
    if (Date.now() > end) throw new JobTimedOut()
    await pause(JOB_POLL_MS, signal)
  }
}

/** The provider's words a failed step carries, for the panel to show under its sentence. */
export const wordsOf = (error: unknown): string | undefined =>
  error instanceof JobFailed && error.errorDetail ? error.errorDetail : error instanceof RunFailed ? error.detail : undefined

/** What the panel says about an error from a route, a job or the editor. */
export function keyOf(error: unknown): MessageKey {
  if (error instanceof RunFailed) return error.key
  if (error instanceof InsufficientCreditsError) return "freecutAi.noCredits"
  if (error instanceof JobTimedOut) return "freecutAi.tooSlow"
  if (error instanceof JobFailed) return "freecutAi.jobFailed"
  if (error instanceof JobUnreadable) return "freecutAi.signedOut"
  if (error instanceof EditorLinkError) return "freecutAi.editorNoAnswer"
  return "freecutAi.unexpected"
}

/**
 * The jobs a run started that are still open: cancelled when the run ends
 * before they are used. A job whose id arrives after the end is cancelled at once.
 */
export class RunJobs {
  private readonly open = new Set<string>()
  private ended = false

  constructor(private readonly signal: AbortSignal) {}

  async start(begin: () => Promise<{ jobId: string }>): Promise<string> {
    const { jobId } = await begin()
    if (this.ended) {
      void cancelJob(jobId).catch(() => undefined)
      throw new RunStopped()
    }
    this.open.add(jobId)
    return jobId
  }

  /** A job that finished, or failed for good, is closed; one left by a stop or a timeout stays open to be cancelled. */
  async finish(jobId: string, timeoutMs: number): Promise<Record<string, unknown>> {
    try {
      const output = await waitForJob(jobId, this.signal, timeoutMs)
      this.open.delete(jobId)
      return output
    } catch (error) {
      if (error instanceof JobFailed) this.open.delete(jobId)
      throw error
    }
  }

  /** Start and follow one job to its output. */
  async run(begin: () => Promise<{ jobId: string }>, timeoutMs: number): Promise<Record<string, unknown>> {
    return this.finish(await this.start(begin), timeoutMs)
  }

  /**
   * A job the run stops following but does not give up on: it is not cancelled
   * when the run ends. For a paid render already with its provider, which
   * cannot be stopped and is charged when it finishes: its result is still wanted.
   */
  keep(jobId: string) {
    this.open.delete(jobId)
  }

  end() {
    this.ended = true
    for (const jobId of this.open) void cancelJob(jobId).catch(() => undefined)
    this.open.clear()
  }
}
