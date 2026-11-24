/**
 * fal.ai API Client — shared queue-API wrapper, mirroring the Replicate
 * `runReplicatePrediction` envelope so every fal provider module shares one
 * dispatch + crash-recovery path.
 *
 * fal uses an async QUEUE API (`@fal-ai/client` v1.x):
 *   `fal.queue.submit(endpoint, { input })`  → `{ request_id }`
 *   `fal.queue.status(endpoint, { requestId })` → `{ status, ... }`
 *   `fal.queue.result(endpoint, { requestId })` → `{ data, requestId }`
 *
 * NOTE on the package shape (verified against @fal-ai/client@1.10.1 types):
 *  - It's a CJS package with a NAMED `fal` singleton export. `import { fal }`
 *    resolves at runtime under `esModuleInterop`.
 *  - `fal.config()` REBUILDS the singleton on every call, so we guard with a
 *    one-shot `configured` flag (lazy "config once").
 *  - The published `QueueStatus.status` union is only
 *    `"IN_QUEUE" | "IN_PROGRESS" | "COMPLETED"` — there is NO `"ERROR"` member.
 *    Real failures surface either as a non-typed terminal status from the REST
 *    queue OR as a thrown `ApiError` from `result()`. We defend against BOTH:
 *    a defensive `status === "ERROR"/"FAILED"` check (forward-proof) AND a
 *    try/catch around `result()` that re-throws with the request id, so callers
 *    always get a `fal request failed (<id>): <reason>` shape.
 */

import { fal } from "@fal-ai/client"
import { requireProviderKey, type ProviderKeyCoverage } from "../provider-keys.js"
import { config } from "../../lib/config.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { egressSdkFetch } from "../egress.js"

/** Default poll cadence (ms). fal's own SDK defaults to 500ms; 3s keeps our
 *  queue-status load light for the long-running media jobs we use fal for. */
const DEFAULT_POLL_INTERVAL_MS = 3000

/** Safety cap on poll iterations (~600 × 3s = 30min, matching NODE_TIMEOUT_MS). */
const MAX_POLLS = 600

/** The hosts a fal run is submitted to (the queue, and the synchronous run endpoint). */
const FAL_RUN_HOSTS: ReadonlySet<string> = new Set(["queue.fal.run", "fal.run"])

/**
 * Whether a call of fal's transport submits a run (a POST to a model on the
 * queue or the run endpoint): those take a concurrency slot at the egress.
 * Status and result reads, cancels and storage uploads do not.
 */
export function createsFalRun(method: string, url: string): boolean {
  if (method !== "POST") return false
  try {
    const u = new URL(url)
    return FAL_RUN_HOSTS.has(u.hostname) && !u.pathname.includes("/requests/")
  } catch {
    return false
  }
}

/**
 * The endpoints whose submit is sent ONCE (`submitOnce`, decided 2026-11-17).
 * The SDK's queue client re-sends a submit by itself on a 429 / 502 / 503 /
 * 504 answer and on a network failure (its retry settings for the queue are
 * fixed in the SDK; no per-call or client option reaches them). After a 502 /
 * 503 / 504 or a lost connection the first POST may already have created a
 * request, and the caller would learn only the second one's id: two billed
 * runs, one of them unknown. For these endpoints the transport answers such
 * a submit with {@link FalSubmitAmbiguousError}, which the SDK does not
 * retry. A 429 is passed through (nothing was created; the SDK may retry it).
 */
const SUBMIT_ONCE_ENDPOINTS = new Set<string>()

/** HTTP answers to a submit after which fal may or may not have created the request. */
const AMBIGUOUS_SUBMIT_STATUSES: ReadonlySet<number> = new Set([502, 503, 504])

/**
 * A submit whose outcome is not known: fal may or may not have created a
 * request. Deliberately carries no `cause`, no network `code` and is no
 * `TypeError`: the SDK's retry reads those (down the cause chain) to decide
 * to send the request again.
 */
export class FalSubmitAmbiguousError extends Error {
  readonly status?: number
  constructor(reason: string, status?: number) {
    super(`fal submit outcome unknown: ${reason}`)
    this.name = "FalSubmitAmbiguousError"
    if (status !== undefined) this.status = status
  }
}

/** Marks `endpoint` as one whose submit is sent once ({@link SUBMIT_ONCE_ENDPOINTS}). */
export function markSubmitOnce(endpoint: string): void {
  SUBMIT_ONCE_ENDPOINTS.add(endpoint.replace(/^\/+|\/+$/g, ""))
}

/** Whether a transport call is the submit of a send-once endpoint. */
function isSubmitOnceCall(method: string, url: string): boolean {
  if (SUBMIT_ONCE_ENDPOINTS.size === 0 || !createsFalRun(method, url)) return false
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "")
    return SUBMIT_ONCE_ENDPOINTS.has(path)
  } catch {
    return false
  }
}

/**
 * Wraps fal's transport so the submit of a send-once endpoint is never
 * re-sent by the SDK after an ambiguous outcome. Every other call (another
 * endpoint's submit, any status or result read) goes through untouched.
 */
export function submitOnceFetch(inner: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase()
    if (!isSubmitOnceCall(method, url)) return inner(input, init)
    let response: Response
    try {
      response = await inner(input, init)
    } catch (err) {
      throw new FalSubmitAmbiguousError(err instanceof Error ? err.message : String(err))
    }
    if (AMBIGUOUS_SUBMIT_STATUSES.has(response.status)) throw new FalSubmitAmbiguousError(`HTTP ${response.status}`, response.status)
    return response
  }) as typeof fetch
}

/** Lazy one-shot credential config (fal.config rebuilds the singleton each call). */
let configured = false
function ensureConfigured(coverage?: ProviderKeyCoverage): void {
  if (configured) return
  requireProviderKey(config.FAL_KEY, "FAL_KEY", undefined, coverage)
  // Inject the egress-decorated fetch so fal's queue transport (submit/status/
  // result) flows through the seam like every other provider call, and each
  // submit takes its concurrency slot there (createsWork).
  fal.config({ credentials: config.FAL_KEY, fetch: submitOnceFetch(egressSdkFetch("fal", { createsWork: createsFalRun })) })
  configured = true
}

/** Test-only: reset the one-shot config guard between specs. */
export function __resetFalConfiguredForTests(): void {
  configured = false
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Normalize ANY fal failure signal into a single non-empty, informative reason
 * string. Handles all three shapes the failure can arrive as:
 *   - a plain string (`error` field on the REST queue payload),
 *   - a thrown `ApiError` from `result()` — fal frequently throws these with an
 *     EMPTY `.message` and the real cause carried only in `.status` + `.body`
 *     (usually `{ detail }`), so reading `.message` alone yielded a useless
 *     "fal request failed (id): " with nothing after the colon (observed live),
 *   - a bare/absent value → falls back to the supplied terminal status.
 * Shared by the live poll loop and the reconcile status check so the two stay
 * in lockstep.
 */
function falFailureReason(error: unknown, fallback: string): string {
  if (typeof error === "string") return error.trim() || fallback

  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>
    const parts: string[] = []

    // HTTP status (ApiError.status) — e.g. 422, 500.
    if (typeof e.status === "number") parts.push(`HTTP ${e.status}`)

    // Structured detail: ApiError.body is usually { detail: string | object }.
    const body = e.body
    const detail =
      body && typeof body === "object" ? (body as Record<string, unknown>).detail : body
    if (detail !== undefined && detail !== null) {
      parts.push(typeof detail === "string" ? detail : JSON.stringify(detail))
    }

    // Error message last (often empty for fal ApiError, but include if present).
    if (typeof e.message === "string" && e.message.trim()) parts.push(e.message)

    if (parts.length) return parts.join(": ")

    // Object with no recognized fields — stringify rather than emit "{}".
    const json = JSON.stringify(error)
    if (json && json !== "{}") return json
  }

  return fallback
}

/**
 * A failed fal request: the message is `fal request failed (<id>): <reason>`
 * (unchanged), and the HTTP status and the provider's own `detail`, when the
 * failure carried them, ride on the error so a caller can classify a refusal
 * without parsing the flattened reason.
 */
export class FalRequestError extends Error {
  readonly requestId: string
  readonly status?: number
  readonly detail?: unknown
  /**
   * Whether fal itself answered that the request ended in failure (a failed
   * queue status, or an HTTP answer to the result fetch other than a gateway's
   * or a rate limit's) — as opposed to a result that could not be read, where
   * the request may have finished well and can be fetched again.
   */
  readonly ended: boolean
  constructor(requestId: string, reason: string, source: unknown, ended = false) {
    super(`fal request failed (${requestId}): ${reason}`)
    this.name = "FalRequestError"
    this.requestId = requestId
    this.ended = ended
    // A queue status can carry its failure as plain text: kept as the detail.
    if (typeof source === "string" && source.trim()) this.detail = source
    if (source && typeof source === "object") {
      const e = source as Record<string, unknown>
      if (typeof e.status === "number") this.status = e.status
      const body = e.body
      const detail = body && typeof body === "object" ? (body as Record<string, unknown>).detail : body
      if (detail !== undefined && detail !== null) this.detail = detail
    }
  }
}

/** HTTP statuses of a result fetch that say nothing of the request itself (a gateway or a rate limit in the way). */
const TRANSIENT_RESULT_STATUSES: ReadonlySet<number> = new Set([408, 429, 502, 503, 504])

/** Whether a failed result fetch is fal's own answer that the request ended in failure (an HTTP status that is not a transient one). */
function resultAnswerEndsRequest(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === "number" && !TRANSIENT_RESULT_STATUSES.has(status)
}

/**
 * Shared dispatch envelope for fal queue requests:
 * `submit` → `fireOnTaskCreated(request_id)` (BEFORE polling, so a worker crash
 * mid-poll still leaves the row recoverable by the reconcile cron) → poll
 * `status` until `COMPLETED` → `result`. Returns the RAW `result.data`
 * untouched so each caller keeps its own output-shape handling via
 * `extractFalUrl`.
 */
export async function runFalRequest(opts: {
  endpoint: string
  input: Record<string, unknown>
  label: string
  reconcileOpts?: ReconcileOpts
  /** Poll cadence override (ms). Defaults to 3000; pass 0 in tests. */
  pollIntervalMs?: number
  /** For a lane the nodaro.ai connection cannot run: the missing-key message must not offer it. */
  keyCoverage?: ProviderKeyCoverage
  /**
   * A request this run already submitted (a retry of the same job): it is
   * polled and its result fetched, and nothing is submitted again. Absent:
   * a new request is submitted (every caller but Gemini Omni Flash 1.2 Extend).
   */
  resumeRequestId?: string
  /** Told the request id right after a NEW submit, before any poll: where a caller persists it for a retry. */
  onSubmitted?: (requestId: string) => Promise<void>
  /**
   * How many status reads in a row may fail (a network blip, a 5xx) before
   * the poll gives up: each failed read waits one interval and is tried
   * again. Absent: 0 — the first failed read throws, as it always has.
   */
  statusErrorRetries?: number
  /**
   * Send this endpoint's submit once: an ambiguous outcome (502 / 503 / 504,
   * a network failure) is not re-sent by the SDK and throws
   * {@link FalSubmitAmbiguousError} ({@link SUBMIT_ONCE_ENDPOINTS}). Absent:
   * the SDK's own retry, as it always was.
   */
  submitOnce?: boolean
  /** The most status polls before the wait gives up. Absent: 600 (30 minutes at the default cadence). */
  maxPolls?: number
  /**
   * The longest the wait may run, wall clock, from the first poll: past it the
   * wait gives up as when the polls run out (a slow status read cannot stretch
   * it). Absent: bounded by `maxPolls` only, as it always was.
   */
  maxWaitMs?: number
}): Promise<{ output: unknown; requestId: string }> {
  ensureConfigured(opts.keyCoverage)
  if (opts.submitOnce) markSubmitOnce(opts.endpoint)

  let requestId: string
  if (opts.resumeRequestId) {
    requestId = opts.resumeRequestId
  } else {
    const submitted = await fal.queue.submit(opts.endpoint, { input: opts.input })
    requestId = (submitted as { request_id: string }).request_id
    if (opts.onSubmitted) await opts.onSubmitted(requestId)
    await fireOnTaskCreated(opts.reconcileOpts, requestId, opts.label)
  }

  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const statusErrorRetries = opts.statusErrorRetries ?? 0
  let statusErrors = 0

  const maxPolls = opts.maxPolls ?? MAX_POLLS
  const waitStarted = Date.now()
  const pastDeadline = (): boolean => opts.maxWaitMs !== undefined && Date.now() - waitStarted >= opts.maxWaitMs
  for (let i = 0; i < maxPolls && !pastDeadline(); i++) {
    let statusResp: { status: string; error?: unknown }
    try {
      statusResp = (await fal.queue.status(opts.endpoint, { requestId })) as {
        status: string
        error?: unknown
      }
    } catch (err) {
      if (++statusErrors > statusErrorRetries) throw err
      await sleep(interval)
      continue
    }
    statusErrors = 0
    const status = statusResp.status

    if (status === "COMPLETED") {
      try {
        const result = (await fal.queue.result(opts.endpoint, { requestId })) as {
          data: unknown
        }
        return { output: result.data, requestId }
      } catch (err) {
        throw new FalRequestError(requestId, falFailureReason(err, "result fetch failed"), err, resultAnswerEndsRequest(err))
      }
    }

    // Defensive: the published types only cover IN_QUEUE/IN_PROGRESS/COMPLETED,
    // but the REST queue can surface a terminal error status. Treat anything
    // that isn't a known in-flight status as a failure.
    if (status === "ERROR" || status === "FAILED") {
      throw new FalRequestError(requestId, falFailureReason(statusResp.error, status), statusResp.error, true)
    }

    await sleep(interval)
  }

  throw new Error(
    pastDeadline()
      ? `fal request failed (${requestId}): timed out after ${Math.round((opts.maxWaitMs ?? 0) / 1000)} s`
      : `fal request failed (${requestId}): timed out after ${maxPolls} polls`,
  )
}

/**
 * Single non-blocking status check for the RECONCILE path (NOT the live submit→
 * poll→result loop in `runFalRequest`). Given a persisted `requestId` + the fal
 * `endpoint`, checks the queue status once and normalizes the three terminal/
 * in-flight outcomes the reconcile handler dispatches on:
 *
 *   - `COMPLETED` → fetch `queue.result` and return `{ status: "COMPLETED", output }`.
 *     If `result()` itself throws, the job is done on fal's side but the output
 *     is unfetchable — that's TERMINAL (`{ status: "ERROR", error }`), not a
 *     transient retry, so reconcile fails+refunds rather than looping forever.
 *   - `ERROR`/`FAILED` (the REST queue can surface a terminal error status the
 *     published `QueueStatus` union doesn't type) → `{ status: "ERROR", error }`.
 *   - `IN_QUEUE`/`IN_PROGRESS`/anything else → `{ status: "pending" }` (still
 *     running; reconcile bumps attempts and re-checks next tick).
 *   - A thrown `status()` call (network blip, 5xx) → `{ status: "pending", error }`
 *     so reconcile BUMPS (transient) rather than refunding — mirrors how
 *     `reconcileReplicateJob` treats a failed status fetch (`fetch → null → bump`).
 */
export async function fetchFalRequestStatus(
  endpoint: string,
  requestId: string,
): Promise<{ status: "COMPLETED" | "ERROR" | "pending"; output?: unknown; error?: string }> {
  ensureConfigured()

  let statusResp: { status: string; error?: unknown }
  try {
    statusResp = (await fal.queue.status(endpoint, { requestId })) as {
      status: string
      error?: unknown
    }
  } catch (err) {
    // Transient (network/5xx) — leave the row in flight for the next tick.
    return { status: "pending", error: err instanceof Error ? err.message : String(err) }
  }

  const status = statusResp.status

  if (status === "COMPLETED") {
    try {
      const result = (await fal.queue.result(endpoint, { requestId })) as { data: unknown }
      return { status: "COMPLETED", output: result.data }
    } catch (err) {
      // Terminal: fal reported COMPLETED but the result is unfetchable. Treat
      // as a failure (fail+refund) rather than bumping toward exhaustion.
      return { status: "ERROR", error: falFailureReason(err, "result fetch failed") }
    }
  }

  if (status === "ERROR" || status === "FAILED") {
    return { status: "ERROR", error: falFailureReason(statusResp.error, status) }
  }

  // IN_QUEUE / IN_PROGRESS / any other in-flight status — still running.
  return { status: "pending" }
}

/**
 * Extract a media URL from fal's various output shapes. fal returns the URL
 * nested under a typed key depending on the endpoint:
 *   video → `{ video: { url } }`
 *   image (single) → `{ image: { url } }`
 *   image (batch)  → `{ images: [{ url }, ...] }` (first is the primary)
 *   audio → `{ audio: { url } }`
 * Throws on any unrecognized shape so a silent provider change is loud.
 */
export function extractFalUrl(output: unknown): string {
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>

    const single = (v: unknown): string | undefined => {
      if (v && typeof v === "object") {
        const url = (v as { url?: unknown }).url
        if (typeof url === "string") return url
      }
      return undefined
    }

    const fromVideo = single(obj.video)
    if (fromVideo) return fromVideo

    if (Array.isArray(obj.images) && obj.images.length > 0) {
      const fromImages = single(obj.images[0])
      if (fromImages) return fromImages
    }

    const fromImage = single(obj.image)
    if (fromImage) return fromImage

    const fromAudio = single(obj.audio)
    if (fromAudio) return fromAudio
  }

  throw new Error(
    `Unexpected fal output shape: ${JSON.stringify(output).slice(0, 200)}`,
  )
}
