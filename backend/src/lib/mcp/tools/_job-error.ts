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
