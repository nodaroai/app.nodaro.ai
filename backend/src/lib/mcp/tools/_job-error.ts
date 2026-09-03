/**
 * Classify a failed job's free-text `error_message` so MCP poll tools
 * (`get_asset`) can tell the model whether retrying the SAME request is
 * pointless — otherwise a permanent failure (e.g. a content-policy block)
 * reads as transient and the model burns credits re-running it.
 *
 * NON-retryable = the same input will fail the same way:
 *  - content-policy / safety / moderation blocks. KIE sanitizes these to
 *    "Content policy violation: The output was blocked by the provider's
 *    safety filter. Try modifying your prompt or input image."
 *    (see providers/kie/client.ts), but other providers reach this layer
 *    with their own wording, so we match on keywords, provider-agnostic.
 *  - input-shape limits (file too large / too long / over a duration cap).
 *
 * Everything else — provider timeout, 5xx, rate limit, "please try again",
 * or no recorded reason — is treated as retryable. The bias is deliberate:
 * only mark non-retryable on high-confidence permanent signals so we never
 * discourage re-running a genuinely transient failure.
 */
// Content-policy / moderation (permanent for the given prompt/image). Split
// out so the app-report rejection sweep can classify EXACTLY this subset —
// input-shape limits are non-retryable too, but they aren't rejections.
const CONTENT_REJECTION_PATTERNS = [
  "content policy",
  "safety filter",
  "safety policy",
  "moderation",
  "nsfw",
  "prohibited",
  "inappropriate",
  "violat", // violation / violates
  // NOT the bare word "filtered": ffmpeg's own diagnostics contain it ("No
  // filtered frames for output stream"), which mislabeled plain ffmpeg
  // failures as content rejections in the app-report sweep (2026-07-20
  // extract-frame reports). Match provider-style phrasings only.
  "content filtered",
  "was filtered",
  "filtered by",
  "filtered due",
  // W0 (2026-09-01): the KIE copyright / likeness messages
  // (providers/kie/client.ts CONTENT_POLICY_MESSAGES + the sanitizer's
  // "Blocked for copyright") were filed as plain job failures. Match the
  // short discriminating fragments, never the full sentences.
  "declined this generation",
  "blocked for copyright",
  "real person's likeness",
]

// Input-shape limits (permanent until the caller changes the input).
const INPUT_LIMIT_PATTERNS = [
  "exceeds",
  "too large",
  "too long",
  "file size",
  "duration limit",
]

const NON_RETRYABLE_PATTERNS = [...CONTENT_REJECTION_PATTERNS, ...INPUT_LIMIT_PATTERNS]

/**
 * True when the error reads as a provider content-policy / moderation block —
 * the safety-filter subset of the non-retryable vocabulary. Used by the
 * app-report rejection sweep; absent/unknown reasons are NOT rejections.
 */
/**
 * Local tool output, never a provider verdict: `runFfmpeg` prefixes every
 * shell failure with "ffmpeg failed:" and appends the raw stderr dump, which
 * can contain ANY keyword (filter-graph diagnostics, codec banners). Keyword
 * matching over that blob is meaningless — bail out before it.
 */
function isLocalFfmpegError(lower: string): boolean {
  return lower.startsWith("ffmpeg failed")
}

export function isContentRejection(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false
  const lower = errorMessage.toLowerCase()
  if (isLocalFfmpegError(lower)) return false
  return CONTENT_REJECTION_PATTERNS.some((p) => lower.includes(p))
}

export type RejectionClass = "copyright" | "likeness" | "safety"

/** Which kind of content block a rejection message describes. Copyright is
 *  tested first (its messages also say "violation"), then likeness, then any
 *  other rejection is safety/moderation. Null when not a rejection at all. */
export function rejectionClassOf(errorMessage: string | null | undefined): RejectionClass | null {
  if (!isContentRejection(errorMessage)) return null
  const lower = errorMessage!.toLowerCase()
  if (lower.includes("copyright") || lower.includes("intellectual property") || lower.includes("trademark")) return "copyright"
  if (lower.includes("likeness") || lower.includes("public figure") || lower.includes("celebrit")) return "likeness"
  return "safety"
}

/**
 * True when re-running the same request could plausibly succeed. Defaults to
 * `true` (transient) for an unknown or absent reason; returns `false` only on
 * a high-confidence permanent-failure signal.
 */
export function isRetryableFailure(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return true
  const lower = errorMessage.toLowerCase()
  // ffmpeg stderr keywords are not high-confidence permanence signals —
  // default to retryable, per the bias documented above.
  if (isLocalFfmpegError(lower)) return true
  return !NON_RETRYABLE_PATTERNS.some((p) => lower.includes(p))
}

/**
 * PR9 (2026-09-03) — `jobs.error_hint` (migration 376) carries the worker's
 * OWN safety-block verdict, which is strictly more useful to an MCP client
 * than re-deriving one from `error_message` keywords: it names the exact
 * class, whether the worker already spent its one bonus attempt, and — when
 * the catalog declares a fallback for the model that failed — a REAL model id
 * the same prompt/references can be retried on.
 *
 * `retryable` stays exactly `isRetryableFailure(error_message)` — a
 * safety-block is never retryable as the SAME request, and every
 * `safetyBlockMessage()` / KIE content-policy string already reads as
 * non-retryable via the keyword classifier above, so there is nothing to
 * override. `error_hint` only changes `guidance` (and adds `suggestedProvider`
 * when the hint offers one) — it is additive, not a second source of truth
 * for `retryable`.
 */
export function failureGuidance(job: {
  error_message?: string | null
  error_hint?: unknown
}): { retryable: boolean; suggestedProvider?: string; guidance: string } {
  const retryable = isRetryableFailure(job.error_message)
  const hint = job.error_hint as
    | { kind?: unknown; suggestedProvider?: unknown }
    | null
    | undefined

  if (hint && hint.kind === "safety-block") {
    const suggestedProvider =
      typeof hint.suggestedProvider === "string" ? hint.suggestedProvider : undefined
    return suggestedProvider
      ? {
          retryable,
          suggestedProvider,
          guidance:
            `The provider's safety filter blocked this output twice; retry the SAME ` +
            `prompt and references with provider "${suggestedProvider}".`,
        }
      : {
          retryable,
          guidance: "The provider's safety filter blocked this output; change the prompt or the input image.",
        }
  }

  return {
    retryable,
    guidance: retryable
      ? "This may be transient — retrying the same request is reasonable."
      : "This is a permanent failure for this input: do NOT retry the same " +
        "request unchanged. Change the prompt/input, or report the reason to the user.",
  }
}
