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
import { config } from "../../lib/config.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import type { ReconcileOpts } from "../provider.interface.js"

/** Default poll cadence (ms). fal's own SDK defaults to 500ms; 3s keeps our
 *  queue-status load light for the long-running media jobs we use fal for. */
const DEFAULT_POLL_INTERVAL_MS = 3000

/** Safety cap on poll iterations (~600 × 3s = 30min, matching NODE_TIMEOUT_MS). */
const MAX_POLLS = 600

/** Lazy one-shot credential config (fal.config rebuilds the singleton each call). */
let configured = false
function ensureConfigured(): void {
  if (configured) return
  fal.config({ credentials: config.FAL_KEY })
  configured = true
}

/** Test-only: reset the one-shot config guard between specs. */
export function __resetFalConfiguredForTests(): void {
  configured = false
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Normalize a fal queue error payload into a single reason string. The REST
 * queue's `error` field is sometimes a plain string and sometimes a structured
 * object; fall back to the terminal `status` when it's absent. Shared by both
 * the live poll loop and the reconcile status check so the two stay in lockstep.
 */
function falFailureReason(error: unknown, status: string): string {
  return typeof error === "string" ? error : JSON.stringify(error ?? status)
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
}): Promise<{ output: unknown; requestId: string }> {
  ensureConfigured()

  const submitted = await fal.queue.submit(opts.endpoint, { input: opts.input })
  const requestId = (submitted as { request_id: string }).request_id

  await fireOnTaskCreated(opts.reconcileOpts, requestId, opts.label)

  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  for (let i = 0; i < MAX_POLLS; i++) {
    const statusResp = (await fal.queue.status(opts.endpoint, { requestId })) as {
      status: string
      error?: unknown
    }
    const status = statusResp.status

    if (status === "COMPLETED") {
      try {
        const result = (await fal.queue.result(opts.endpoint, { requestId })) as {
          data: unknown
        }
        return { output: result.data, requestId }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(`fal request failed (${requestId}): ${reason}`)
      }
    }

    // Defensive: the published types only cover IN_QUEUE/IN_PROGRESS/COMPLETED,
    // but the REST queue can surface a terminal error status. Treat anything
    // that isn't a known in-flight status as a failure.
    if (status === "ERROR" || status === "FAILED") {
      throw new Error(
        `fal request failed (${requestId}): ${falFailureReason(statusResp.error, status)}`,
      )
    }

    await sleep(interval)
  }

  throw new Error(
    `fal request failed (${requestId}): timed out after ${MAX_POLLS} polls`,
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
      return { status: "ERROR", error: err instanceof Error ? err.message : String(err) }
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
