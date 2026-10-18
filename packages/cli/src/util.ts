import { NodaroError } from "@nodaro/sdk/errors"
import type { ExecutionStatus } from "@nodaro/sdk/executions"
import type { JobStatus } from "@nodaro/sdk/jobs"
import { dim, emit, info, success, type OutputOpts } from "./output.js"

/**
 * Commander variadic-arity collector. Used as the second argument to
 * `.option("--flag <pairs...>", ..., collectVariadic)` so repeated occurrences
 * of the flag accumulate into a `string[]` instead of clobbering each other.
 */
export function collectVariadic(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value]
}

/**
 * Coerce the `--count` flag value into the 1 | 2 | 4 union the entity-generate
 * routes accept. Defaults to 1 on absent / unrecognized input; the SDK further
 * validates downstream.
 *
 * Shared across objects, locations, characters command groups.
 */
export function parseCount(raw: string | undefined): 1 | 2 | 4 {
  if (raw === "2") return 2
  if (raw === "4") return 4
  return 1
}

/** Statuses at which a job or execution stops moving — same set for both. */
const TERMINAL: ReadonlySet<ExecutionStatus | JobStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
])

interface PollableResult {
  data: { status: ExecutionStatus | JobStatus }
}

interface WatchOpts<T extends PollableResult> extends OutputOpts {
  /** Closure that fetches the current status. Called on every poll tick. */
  fetch: () => Promise<T>
  /** Display id (job id or execution id) — shown in the per-tick log line. */
  label: string
  /** Poll cadence in ms. Default 2000. */
  intervalMs?: number
}

/**
 * Poll a job or execution until it reaches a terminal status, logging
 * status transitions along the way.
 *
 * Used by both `workflows run --watch` / `executions get --watch` (which
 * poll executions) and `nodes run --watch` (which polls jobs). The
 * terminal-status set is the same for both — completed / failed / cancelled.
 *
 * Resilience: transient `fetch()` errors are caught and retried at the next
 * tick rather than crashing the loop. A user watching a long job through a
 * flaky network sees one warning per blip and keeps going.
 *
 * One NON-terminal status also ends the loop: `pending_review`, a job a policy
 * registered by the deployment held for a human reviewer. It is in-flight, so
 * it must never join TERMINAL above (that set is also the execution
 * vocabulary) — but nothing about it moves until a person acts, so "keep
 * polling" would mean polling until the CLI is killed. It gets its own exit
 * code so a script can tell "a human is deciding" apart from a failure.
 *
 * Exit codes:
 *   - 0  on completed
 *   - 2  on failed (exits via `process.exit`)
 *   - 3  on pending_review (exits via `process.exit`)
 *   - 130 on cancelled (exits via `process.exit`)
 *
 * `--json` reports the payload and returns instead of setting an exit code —
 * pre-existing behaviour of the failed/cancelled arms, matched here so one
 * status does not behave unlike the other three.
 *
 * Returns the terminal fetch result, so a caller can render op-specific
 * output (e.g. `voice analyze` prints the detected-speaker table) after the
 * generic status loop finishes.
 */
export async function watchUntilTerminal<T extends PollableResult>(opts: WatchOpts<T>): Promise<T> {
  const intervalMs = opts.intervalMs ?? 2000
  const start = Date.now()
  let lastStatus = ""

  for (;;) {
    let result: T
    try {
      result = await opts.fetch()
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      info(`[${elapsed(start)}s] poll failed (will retry): ${errMsg}`)
      await sleep(intervalMs)
      continue
    }

    const status = result.data.status
    if (status !== lastStatus) {
      info(`[${elapsed(start)}s] ${opts.label} → ${status}`)
      lastStatus = status
    }
    if (status === "pending_review") {
      if (opts.json) emit(result.data, opts)
      else {
        info("awaiting review (a human decision is pending; not a failure)")
        dim(`check later: nodaro jobs get ${opts.label}`)
        process.exit(3)
      }
      return result
    }
    if (TERMINAL.has(status)) {
      if (opts.json) emit(result.data, opts)
      else if (status === "completed") success(`completed in ${elapsed(start)}s`)
      else process.exit(status === "failed" ? 2 : 130)
      return result
    }
    await sleep(intervalMs)
  }
}

interface QueuedJobOpts extends OutputOpts {
  watch?: boolean
  pollInterval?: number
  /** Short parenthetical after the queued line, e.g. "video mode". */
  note?: string
}

/**
 * Standard tail for every command that queues an async job: in `--json` mode
 * without `--watch`, emit the raw `{ jobId }` and stop; otherwise print the
 * queued line (+ follow hint), and with `--watch` poll to a terminal status.
 * Returns the terminal fetch result when it watched, `undefined` otherwise.
 *
 * Shared across the voice / media / audio command groups.
 */
export async function reportQueuedJob<T extends PollableResult>(
  result: { jobId: string },
  fetchJob: () => Promise<T>,
  opts: QueuedJobOpts,
): Promise<T | undefined> {
  if (opts.json && !opts.watch) {
    emit(result, opts)
    return undefined
  }
  success(`job ${result.jobId} queued${opts.note ? ` (${opts.note})` : ""}`)
  if (!opts.watch) {
    dim(`follow: nodaro jobs get ${result.jobId}`)
    return undefined
  }
  return watchUntilTerminal({
    fetch: fetchJob,
    label: result.jobId,
    intervalMs: opts.pollInterval,
    json: opts.json,
  })
}

/** Character-training statuses that are still moving. */
const TRAINING_IN_FLIGHT: ReadonlySet<string> = new Set(["queued", "training"])

interface TrainingWatchOpts<T extends { status: string; error?: string | null }> extends OutputOpts {
  /** Closure that fetches the training record. Called on every poll tick. */
  fetch: () => Promise<T>
  /** Display id (the character id) — shown in the per-transition log line. */
  label: string
  /** Poll cadence in ms. Default 10000 — a training takes minutes. */
  intervalMs?: number
}

/**
 * Whether a failed poll is worth another tick: a network failure, a timeout,
 * a 5xx, a 429 or a 408. Any other 4xx is the server's definitive answer (the
 * character is not there, the token is not allowed to read it): polling again
 * would answer the same forever.
 */
function isTransientPollError(err: unknown): boolean {
  if (!(err instanceof NodaroError)) return true
  if (err.status === 408 || err.status === 429) return true
  return !(err.status >= 400 && err.status < 500)
}

/**
 * Poll a character's training until it stops moving: {@link watchUntilTerminal}
 * for the training vocabulary (`queued` → `training` → `succeeded` | `failed` |
 * `cancelled`), which is not a job's. A transient poll failure (network, 5xx,
 * 429) is retried at the next tick; a definitive 4xx is rethrown for the
 * caller's error handler. The exit codes are the ones a script already knows:
 *
 *   - 0 on succeeded
 *   - 2 on failed (the reason is printed first)
 *   - 130 on cancelled
 *
 * `untrained` means nothing is in flight. On the first poll there is nothing to
 * wait for, so it returns. After `training` it can only mean the trained model
 * was removed mid-training, which ends like a cancel (130). Straight after
 * `queued` it is the route releasing the slot of a training that could not be
 * started (refunded) — a failure (2).
 *
 * `--json` emits the final record and returns instead of setting an exit code,
 * as `watchUntilTerminal` does.
 */
export async function watchTraining<T extends { status: string; error?: string | null }>(opts: TrainingWatchOpts<T>): Promise<T> {
  const intervalMs = opts.intervalMs ?? 10_000
  const start = Date.now()
  let lastStatus = ""
  // The last in-flight status seen: what an `untrained` after it means.
  let lastInFlight: string | undefined

  for (;;) {
    let result: T
    try {
      result = await opts.fetch()
    } catch (err) {
      if (!isTransientPollError(err)) throw err
      const errMsg = err instanceof Error ? err.message : String(err)
      info(`[${elapsed(start)}s] poll failed (will retry): ${errMsg}`)
      await sleep(intervalMs)
      continue
    }

    const status = result.status
    if (status !== lastStatus) {
      info(`[${elapsed(start)}s] ${opts.label} → ${status}`)
      lastStatus = status
    }
    if (TRAINING_IN_FLIGHT.has(status)) {
      lastInFlight = status
      await sleep(intervalMs)
      continue
    }
    if (opts.json) {
      emit(result, opts)
      return result
    }
    if (status === "succeeded") {
      success("training succeeded")
      return result
    }
    if (status === "failed") {
      if (result.error) info(`reason: ${result.error}`)
      process.exit(2)
    }
    if (status === "cancelled") process.exit(130)
    if (status === "untrained") {
      if (lastInFlight === "training") {
        info("the training was removed before it finished")
        process.exit(130)
      }
      if (lastInFlight === "queued") {
        info("the training could not be started (nothing was charged), or was removed before it started")
        process.exit(2)
      }
      info("no training in flight")
    }
    // `untrained` with nothing in flight, or a status this CLI does not know
    // yet: it has stopped moving, so stop watching.
    return result
  }
}

/** One job's lean status, as `jobs.getStatus` answers it. */
interface JobStatusLike {
  id: string
  status: JobStatus
}

interface WatchJobsOpts extends OutputOpts {
  /** The jobs to follow — every job of a batch. */
  jobIds: readonly string[]
  /** Fetches one job's status. Called for each unsettled job on every tick. */
  fetchStatus: (jobId: string) => Promise<{ data: JobStatusLike }>
  /** Poll cadence in ms. Default 2000. */
  intervalMs?: number
}

/**
 * {@link watchUntilTerminal} for several jobs at once (a generate-image batch):
 * polls every job until each has settled — completed, failed, cancelled, or
 * held for review — logging each one's transitions, and only then reports.
 * One job's failure never stops the others being followed.
 *
 * Exit codes (as for one job, read across the batch): 0 when every job
 * completed; 2 when any failed or was cancelled; 3 when the rest completed and
 * some wait on a reviewer. `--json` emits every final status, in `jobIds`
 * order, and returns instead.
 */
export async function watchJobsUntilTerminal(opts: WatchJobsOpts): Promise<JobStatusLike[]> {
  const intervalMs = opts.intervalMs ?? 2000
  const start = Date.now()
  const lastStatus = new Map<string, string>()
  const settled = new Map<string, JobStatusLike>()
  for (;;) {
    for (const jobId of opts.jobIds) {
      if (settled.has(jobId)) continue
      try {
        const { data } = await opts.fetchStatus(jobId)
        if (data.status !== lastStatus.get(jobId)) {
          info(`[${elapsed(start)}s] ${jobId} → ${data.status}`)
          lastStatus.set(jobId, data.status)
        }
        if (TERMINAL.has(data.status) || data.status === "pending_review") settled.set(jobId, data)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        info(`[${elapsed(start)}s] ${jobId} poll failed (will retry): ${errMsg}`)
      }
    }
    if (settled.size === opts.jobIds.length) break
    await sleep(intervalMs)
  }
  const finals = opts.jobIds.map((jobId) => settled.get(jobId)!)
  if (opts.json) {
    emit(finals, opts)
    return finals
  }
  const completed = finals.filter((job) => job.status === "completed").length
  if (completed === finals.length) {
    success(`all ${finals.length} completed in ${elapsed(start)}s`)
    return finals
  }
  info(`${completed} of ${finals.length} completed`)
  process.exit(finals.some((job) => job.status === "failed" || job.status === "cancelled") ? 2 : 3)
}

function elapsed(startMs: number): string {
  return ((Date.now() - startMs) / 1000).toFixed(1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** `nodeId.field=value` pairs → nested inputOverrides. Values that parse as JSON are used as JSON. */
export function parseOverridePairs(pairs: string[] | undefined): Record<string, Record<string, unknown>> | undefined {
  if (!pairs?.length) return undefined
  const out: Record<string, Record<string, unknown>> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf("=")
    const dot = pair.indexOf(".")
    if (eq === -1 || dot === -1 || dot > eq) throw new Error(`--override expects nodeId.field=value, got "${pair}"`)
    const nodeId = pair.slice(0, dot)
    const field = pair.slice(dot + 1, eq)
    const raw = pair.slice(eq + 1)
    let value: unknown = raw
    try { value = JSON.parse(raw) } catch { /* plain string */ }
    out[nodeId] = { ...(out[nodeId] ?? {}), [field]: value }
  }
  return out
}
