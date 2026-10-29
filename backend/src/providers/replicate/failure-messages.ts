/**
 * Replicate failure → honest user-facing sentence.
 *
 * A Replicate model that dies inside its own forward pass reports a PyTorch
 * exception, not a verdict: the SDK throws `Prediction failed: <that text>` on
 * the worker lane, and `reconcile/replicate.ts` writes the generic
 * "Generation failed on the provider. Please try again." on the recovery lane.
 * Both readings are wrong when the model is telling us, in library vocabulary,
 * that the USER'S INPUT produced nothing to work on — retrying the identical
 * request then costs GPU time and a second wait for the same outcome.
 *
 * This module is the ONE place that translates those signatures, so the two
 * lanes cannot disagree about what a given failure means.
 *
 * Deliberately job-type-scoped: a PyTorch reshape error is a generic string
 * that any model can emit for any reason, so it is only read as "nothing
 * matched" for the job type whose model is known to fail that exact way.
 */

import { PLATFORM_CAPACITY_MESSAGE } from "../../lib/llm-platform-exhaustion.js"
import { redactProviderDetail } from "../../lib/provider-error-detail.js"

/**
 * Grounded SAM (schananas/grounded_sam) with ZERO detections.
 *
 * Grounding DINO returns an empty box tensor, and the SAM stage then reshapes
 * it: `cannot reshape tensor of 0 elements into shape [0, -1, 256, 256]
 * because the unspecified dimension size -1 can be any value and is
 * ambiguous`. Production evidence: two generate-mask jobs, 2026-09-08, both
 * carrying long descriptive noun clauses as the mask prompt — the phrasing
 * Grounding DINO's text encoder is weakest on.
 *
 * Matched on the structural part (0 elements + a reshape), not the exact
 * shape tuple, so a different mask resolution still matches.
 */
const EMPTY_DETECTION_RE = /cannot reshape tensor of 0 elements/i

/**
 * What the user can actually DO about it.
 *
 * NOT "lower the threshold": the node's Threshold slider is a no-op on the
 * pinned model (`schananas/grounded_sam` exposes no box-threshold input — see
 * grounded-sam.ts and docs/nodes/ai-image/generate-mask.md), so naming it
 * would send the user to a lever that changes nothing. A shorter, plainer
 * subject phrase is the lever that exists.
 *
 * Reads as non-retryable to `lib/mcp/tools/_job-error.ts` via the "no region
 * matched" fragment, and matches none of the content-rejection vocabulary —
 * this is a no-match, not a policy block.
 */
export const MASK_NO_REGION_MESSAGE =
  "No region matched the mask prompt. Try a shorter, plainer subject phrase " +
  '(for example "the hat" rather than a long description) and run again.'

/**
 * The honest user-facing sentence for a failed Replicate prediction, or `null`
 * when this module has nothing better to say than the caller's own default.
 *
 * `rawError` is the provider's own text — `prediction.error` on the reconcile
 * lane, the thrown `Error.message` on the worker lane. Never returned to the
 * user as-is; only used to recognise a signature.
 */
export function replicateFailureMessage(
  jobType: string | null | undefined,
  rawError: string | null | undefined,
): string | null {
  if (typeof rawError !== "string" || rawError.length === 0) return null
  if (jobType === "generate-mask" && EMPTY_DETECTION_RE.test(rawError)) {
    return MASK_NO_REGION_MESSAGE
  }
  return null
}

/**
 * A Replicate failure whose user-facing sentence we chose, carrying the
 * provider's raw text for the operator.
 *
 * `internalDetails` is the duck-typed field `lib/provider-error-detail.ts ::
 * providerDetailOf` reads (the same shape `KieError` / `ApifyError` carry) —
 * without it the worker lane would write our friendly sentence and NO
 * `error_detail`, losing the only record of what the model actually said.
 */
export class ReplicateSanitizedError extends Error {
  public readonly internalDetails: string

  constructor(message: string, internalDetails: string) {
    super(message)
    this.name = "ReplicateSanitizedError"
    this.internalDetails = internalDetails
  }
}

/**
 * The HTTP status of a failed Replicate API call — the SDK throws `ApiError
 * { request, response }` whose message is `Request to https://api.replicate.com/…
 * failed with status <N> <text>: <body>`. Undefined for anything else (a
 * prediction that failed inside the model is a plain Error).
 */
export function replicateApiStatus(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } } | null | undefined)?.response?.status
  return typeof status === "number" ? status : undefined
}

/** A 429: the host is throttling the account — transient, retryable. */
export const REPLICATE_BUSY_MESSAGE = "The provider is busy right now. Try again in a minute."
/** A 400/422: the host refused the request body — deterministic, so the MCP
 *  reads it as not retryable (`INPUT_LIMIT_PATTERNS`, "rejected these settings"). */
export const REPLICATE_REJECTED_MESSAGE =
  "Generation failed: the provider rejected these settings for this model. " +
  "Retrying the same request will fail again — change the settings or the input media and try again."
/** Any other refusal (a 5xx, a 404/409 while polling): nothing the user chose — retryable. */
export const REPLICATE_PROVIDER_ERROR_MESSAGE = "Generation failed on the provider. Please try again."

/** One credit alert per minute while the account stays throttled, not one per request. */
const ALERT_EVERY_MS = 60_000
let lastCreditAlertAt = 0

/** Test hook: forget the last alert so the next credit 429 alerts again. */
export function __resetReplicateAlertForTests(): void {
  lastCreditAlertAt = 0
}

/**
 * A failed Replicate API CALL (not a failed prediction) as the user should
 * read it, or `null` when `err` is not the SDK's ApiError. The SDK's message
 * names the API address and echoes the response body — one reached a user
 * verbatim on 2026-10-28: "Request to https://api.replicate.com/v1/models/…
 * failed with status 429 Too Many Requests: {"detail":"… while you have less
 * than $5.0 in credit …"}" — so the status picks the sentence and the raw text
 * stays on `internalDetails` for the operator (`jobs.error_detail`).
 *
 * The 429 that names the account's credit is the platform's problem, not the
 * user's: it is logged as an [ALERT] line (like the KIE balance alert) so an
 * operator can act, and the user is told to try again shortly.
 */
export function replicateRequestFailure(err: unknown, label: string): ReplicateSanitizedError | null {
  const status = replicateApiStatus(err)
  if (status === undefined) return null
  const raw = err instanceof Error ? err.message : String(err)
  if (status === 429 && /credit/i.test(raw) && Date.now() - lastCreditAlertAt > ALERT_EVERY_MS) {
    lastCreditAlertAt = Date.now()
    // Operator-only, and redacted like every provider detail we record.
    console.error(
      `[ALERT] Replicate account credit is low — requests are being throttled (${label}): ${(redactProviderDetail(raw) ?? "").slice(0, 300)}`,
    )
  }
  // 401/402/403 is the platform's account, not the user's request: the same
  // sentence the other providers' account refusals carry, so the MCP's
  // retry guidance (`isPlatformCapacityOutage`) reads it the same way.
  // 400/422 is the request body — deterministic, so "rejected these
  // settings" (not retryable); any other 4xx (a 404/409 while polling) is
  // nothing the user chose and keeps the retryable provider-error sentence.
  const message =
    status === 429
      ? REPLICATE_BUSY_MESSAGE
      : status === 401 || status === 402 || status === 403
        ? PLATFORM_CAPACITY_MESSAGE
        : status === 400 || status === 422
          ? REPLICATE_REJECTED_MESSAGE
          : REPLICATE_PROVIDER_ERROR_MESSAGE
  return new ReplicateSanitizedError(message, raw)
}

/**
 * Run one Replicate SDK call under the sanitizer: an API refusal comes out as
 * the status-chosen sentence (raw text on `internalDetails`), anything else
 * untouched. For the call sites that use the SDK directly rather than through
 * `client.ts :: runReplicatePrediction`.
 */
export async function withReplicateRequestFailure<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw replicateRequestFailure(err, label) ?? err
  }
}

/**
 * The provider's own text for a failure, wherever it sits: a sanitized error's
 * `internalDetails`, else the message. For a retry predicate that matches on
 * the host's wording (a 502/503/504 gateway blip) — the sanitized sentence
 * alone no longer carries the status.
 */
export function replicateFailureText(err: unknown): string {
  const details = (err as { internalDetails?: unknown } | null | undefined)?.internalDetails
  const message = err instanceof Error ? err.message : String(err)
  return typeof details === "string" ? `${message} ${details}` : message
}
