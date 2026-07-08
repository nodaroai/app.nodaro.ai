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
const NON_RETRYABLE_PATTERNS = [
  // Content-policy / moderation (permanent for the given prompt/image).
  "content policy",
  "safety filter",
  "safety policy",
  "moderation",
  "nsfw",
  "prohibited",
  "inappropriate",
  "violat", // violation / violates
  "filtered",
  // Input-shape limits (permanent until the caller changes the input).
  "exceeds",
  "too large",
  "too long",
  "file size",
  "duration limit",
]

/**
 * True when re-running the same request could plausibly succeed. Defaults to
 * `true` (transient) for an unknown or absent reason; returns `false` only on
 * a high-confidence permanent-failure signal.
 */
export function isRetryableFailure(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return true
  const lower = errorMessage.toLowerCase()
  return !NON_RETRYABLE_PATTERNS.some((p) => lower.includes(p))
}
