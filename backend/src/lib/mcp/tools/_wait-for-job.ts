/**
 * Block until a Nodaro job reaches a terminal state, then return its
 * output URL.
 *
 * Who calls this: `wait_for_job` (the MCP tool an agent calls when it would
 * rather block than poll `get_job`; each call waits at most
 * `WAIT_FOR_JOB_CALL_CEILING_S`, see jobs.ts) and the video director's
 * orchestrator (`ee/video-director/orchestrate.ts`, in-worker).
 * The generation verbs themselves stay fire-and-poll: a tool call that
 * blocks for a video render ties up a Fastify worker for minutes, and hosts
 * with tool cards already render live progress.
 *
 * Loop (audit 2026-09-06 fix #2, A-9 / D-7): reads back off from 1.5 s
 * towards 5 s with ±20 % jitter (so a fleet of waiting agents does not hit
 * the DB in lockstep), never sleep past the deadline, stop at once on the
 * caller's `signal` (`aborted`), and forgive ONE transient DB error before
 * answering `failed`. A held job (`pending_review`) returns immediately —
 * see below.
 *
 * Queue-aware waits (`queueAware`, the in-worker callers: the video director
 * and the plugin toolkit's `tk.jobs.waitForJob`): the time the awaited job is
 * seen `queued` — waiting for a concurrency slot — does not count against the
 * timeout, up to the queue timeout's bound (`QueuedPollClock`), so the wait
 * counts from the job's start (decided 2026-10-30: nothing fails for
 * waiting). That time is also the caller's own in-handler wait, credited to
 * the job it runs for (`creditCoordinatorWait`), so the caller's clocks leave
 * it out too. Only for a caller running as a job (`waitsAsJob`): a request
 * waiting inline — a plugin route — keeps its plain timeout. A job never
 * seen `queued` waits exactly as before. The MCP
 * `wait_for_job` tool keeps the plain wait: it has its own per-call ceiling
 * and answers a still-queued job with its place in line (`withQueue`: a
 * timeout of a job last seen `queued` reads its queue once, onto `lastSeen`).
 */
import { supabase } from "../../supabase.js"
import { redactPrivateJobOutput } from "../../public-job-data.js"
import { isParkedJobStatus, TERMINAL_JOB_STATUSES } from "../../job-status.js"
import { resolveOutputUrl } from "./_job-view.js"
import type { ErrorHint } from "../../safety-block.js"
import { QueuedPollClock } from "../../concurrency-lanes/queued-clock.js"
import { creditCoordinatorWait, waitsAsJob } from "../../concurrency-lanes/coordinator-wait.js"
import { queueInfoFor, waitingRowsOf, type QueueInfo } from "../../concurrency-lanes/queue-info.js"
import { readWithLaneStamp } from "../../concurrency-lanes/columns.js"

/**
 * The most one `wait_for_job` call waits, in seconds. Below the 60 s default
 * request timeout of the reference MCP client SDK, with room for the
 * ownership read, the final row read and the network on either side.
 */
export const WAIT_FOR_JOB_CALL_CEILING_S = 45

/** The seconds one call actually waits: the request's `timeout_s`, at most the ceiling. */
export function waitForJobCallSeconds(timeoutS: number | undefined): number {
  return Math.min(timeoutS ?? WAIT_FOR_JOB_CALL_CEILING_S, WAIT_FOR_JOB_CALL_CEILING_S)
}

export const WAIT_POLL_INITIAL_MS = 1500
export const WAIT_POLL_MAX_MS = 5000
const WAIT_POLL_GROWTH = 1.5
const WAIT_POLL_JITTER = 0.2

interface WaitForJobOpts {
  jobId: string
  /** Maximum wall-clock to wait (default 120 s). */
  timeoutMs?: number
  /** Stop waiting (status `aborted`) when this fires — the MCP request's own signal. */
  signal?: AbortSignal
  /** Leave the time the job is seen `queued` out of `timeoutMs`, and credit it to the caller's job, when the caller runs as a job (see the module comment). Default false. */
  queueAware?: boolean
  /**
   * On a timeout of a job last seen `queued`, read where it stands in its line
   * (one gate read, bounded at 1 s, none on a gate error) onto
   * `lastSeen.queue`. Default false: no gate read at all.
   */
  withQueue?: boolean
}

interface WaitForJobResult {
  /** `pending_review` is NOT a failure and NOT a timeout — the job generated a
   *  result whose release is waiting on a human. See the early return below.
   *  `aborted` = the caller's signal fired; `timeout` = the deadline passed. */
  status: "completed" | "failed" | "cancelled" | "pending_review" | "timeout" | "aborted"
  outputUrl: string | null
  /** Full output_data payload — useful when callers need video/audio URLs alongside thumbnail. */
  outputData: Record<string, unknown> | null
  error: string | null
  jobType: string | null
  /** A `failed` job's structured failure verdict (`jobs.error_hint`, e.g. an
   *  input-video refusal) so a caller can decide a retry without parsing
   *  `error`; null in every other case. */
  errorHint: ErrorHint | null
  /** On `timeout`: what the last read saw — the job's own status
   *  (pending / processing) and its 0-100 progress — so a caller can say how
   *  far along a still-running job is instead of only "not yet". */
  lastSeen?: {
    status: string
    progress: number | null
    createdAt: string | null
    startedAt: string | null
    /** A job last seen `queued`: its place in line, when the caller asked (`withQueue`) and the gate answered. */
    queue?: QueueInfo
  }
}

/** Correctly terminal-ONLY: `pending_review` is handled by its own early
 *  return below, and must never be swept in here (it has no output to read). */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>(TERMINAL_JOB_STATUSES)

/** The jsonb column as written, else null. Shape-checked on `kind` only: a
 *  non-array object with a string `kind` is passed on as an `ErrorHint` (the
 *  platform is its only writer, `markJobFailed`), and the arm's other fields
 *  are not checked; anything else (an array, a missing or non-string `kind`)
 *  is null. */
function errorHintOf(raw: unknown): ErrorHint | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  return typeof (raw as { kind?: unknown }).kind === "string" ? (raw as ErrorHint) : null
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done() {
      signal?.removeEventListener("abort", done)
      clearTimeout(t)
      resolve()
    }
    signal?.addEventListener("abort", done, { once: true })
  })
}

/**
 * Where a job last seen `queued` stands in its line: its row read again with
 * the lane stamp (tolerantly), so it counts as waiting only once a lane
 * stamped it and its wait counts from that stamp, as on every job read.
 * Undefined when it no longer waits, the read fails, or the gate does not answer.
 */
async function queueOfJob(jobId: string): Promise<QueueInfo | undefined> {
  const { data } = await readWithLaneStamp("job", (stamp) => supabase
    // trash-read: the job the caller is already waiting on, read once more for its place in line.
    .from("jobs")
    .select(`id, status${stamp}`)
    .eq("id", jobId)
    .maybeSingle())
  const waiting = data ? waitingRowsOf("job", [data]) : []
  return waiting.length > 0 ? (await queueInfoFor(waiting)).get(jobId) : undefined
}

export async function waitForJob(opts: WaitForJobOpts): Promise<WaitForJobResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const deadline = Date.now() + timeoutMs
  const queued = opts.queueAware && waitsAsJob() ? new QueuedPollClock(creditCoordinatorWait) : null
  let interval = WAIT_POLL_INITIAL_MS
  let dbErrors = 0
  let lastSeen: WaitForJobResult["lastSeen"]
  let lastJobType: string | null = null
  const nothing = { outputUrl: null, outputData: null, errorHint: null } as const

  while (true) {
    if (opts.signal?.aborted) return { status: "aborted", ...nothing, error: `Wait for job ${opts.jobId} was aborted`, jobType: null }

    const { data, error } = await supabase
      // trash-read: the shared wait loop reads by id after its callers' own checks (MCP wait_for_job's leaves the Trash out); server-side waits follow their own runs.
      .from("jobs")
      .select("status, output_data, job_type, error_message, error_hint, progress, created_at, started_at")
      .eq("id", opts.jobId)
      .maybeSingle()

    if (error) {
      // One transient hiccup is forgiven (the row is not gone, the read was);
      // a second in a row is answered honestly.
      dbErrors += 1
      if (dbErrors > 1) {
        return { status: "failed", ...nothing, error: `DB error while polling: ${error.message}`, jobType: null }
      }
    } else {
      dbErrors = 0
      if (!data) {
        return { status: "failed", ...nothing, error: `Job ${opts.jobId} not found`, jobType: null }
      }

      const status = (data.status as string) ?? "pending"
      queued?.observe(status)
      const jobType = (data.job_type as string | null) ?? null
      lastJobType = jobType
      lastSeen = {
        status,
        progress: typeof data.progress === "number" ? data.progress : null,
        createdAt: (data.created_at as string | null) ?? null,
        startedAt: (data.started_at as string | null) ?? null,
      }

      // A held job is parked on a HUMAN for an unbounded time (spec
      // 2026-09-03-job-policy-hook-design §6.4). Burning the caller's whole
      // wall clock only to answer `"timeout"` would be a lie AND would make
      // every MCP client re-run a request that is already sitting in a
      // review queue — where the duplicate would be held too. Hand control
      // back now, with the truthful status.
      if (isParkedJobStatus(status)) {
        // `output_data` is NULL on a held row by contract (D6): the withheld
        // media lives in the non-public `held_*` columns until a reviewer
        // releases it. Returning nulls is the honest read, not a precaution.
        return { status: "pending_review", ...nothing, error: null, jobType }
      }

      if (TERMINAL_STATUSES.has(status)) {
        const out = redactPrivateJobOutput((data.output_data ?? {}) as Record<string, unknown>)
        return {
          status: status as "completed" | "failed" | "cancelled",
          outputUrl: resolveOutputUrl(out),
          outputData: out,
          error: (data.error_message as string | null) ?? null,
          jobType,
          errorHint: status === "failed" ? errorHintOf(data.error_hint) : null,
        }
      }
    }

    const remaining = deadline + (queued?.queuedMs ?? 0) - Date.now()
    if (remaining <= 0) break
    const jitter = 1 + (Math.random() * 2 - 1) * WAIT_POLL_JITTER
    await sleep(Math.min(remaining, Math.round(interval * jitter)), opts.signal)
    interval = Math.min(WAIT_POLL_MAX_MS, interval * WAIT_POLL_GROWTH)
  }

  if (opts.withQueue && lastSeen?.status === "queued") {
    const queue = await queueOfJob(opts.jobId)
    if (queue) lastSeen = { ...lastSeen, queue }
  }

  return {
    status: "timeout",
    ...nothing,
    error: `Job ${opts.jobId} did not complete within ${timeoutMs}ms`,
    jobType: lastJobType,
    ...(lastSeen ? { lastSeen } : {}),
  }
}
