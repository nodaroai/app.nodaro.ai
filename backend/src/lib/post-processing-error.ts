/**
 * PostProcessingError — an explicit, type-based "the provider already
 * delivered" signal for the credit-refund decision.
 *
 * WHY THIS EXISTS (revenue correctness):
 * When a provider (KIE / Replicate / ElevenLabs) returns a result we are
 * billed for that work. If a step AFTER the provider call then fails — R2
 * upload, watermark, transcode, audio-merge, smart-loop-cut, strip-audio,
 * thumbnail — the job is marked `failed`. The OLD refund guard
 * (`refundJobCredits`) tried to detect this by substring-matching the error
 * message, but the real thrown strings ("ffmpeg failed: ...", "Failed to
 * download: <url>", raw AWS SDK errors) never matched, so the user was
 * refunded while Nodaro had already paid the provider — a revenue leak.
 *
 * THE SAFE DIRECTION (more important than the leak):
 * Wrongly SKIPPING a refund for a PRE-provider failure charges the user for a
 * job the provider never did. That is worse than the leak. So we use an
 * EXPLICIT signal that is only ever raised once we are PAST a successful
 * provider call, never on input download / createTask / moderation /
 * validation / timeout. Anything that is NOT a PostProcessingError refunds
 * (the safe default).
 *
 * WHY A MARKER PROPERTY (not just `instanceof`):
 * `instanceof` is the primary check, but a re-thrown / wrapped error, or a
 * copy that crossed a module/realm boundary, can lose its prototype while
 * keeping own-properties. The non-enumerable `postProcessing === true` marker
 * survives `Object.assign`, spreads, and structuredClone of own props, so the
 * signal is robust end-to-end. `isPostProcessingError` checks BOTH.
 *
 * This module has NO imports by design — every layer (storage, ffmpeg-utils,
 * workers/shared, job-finalize, handlers) can depend on it without cycles.
 */
export class PostProcessingError extends Error {
  /** Stable discriminator that survives prototype loss across boundaries. */
  readonly postProcessing = true as const

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "PostProcessingError"
    // Restore the prototype chain for transpiled `extends Error` (ES5 target
    // breaks `instanceof`); harmless under ES2022.
    Object.setPrototypeOf(this, PostProcessingError.prototype)
  }
}

/**
 * True iff `err` signals a post-provider (post-delivery) failure — i.e. the
 * provider already charged us, so a refund would be a giveaway. Checks the
 * class AND the marker property so a wrapped/re-thrown error still classifies.
 *
 * Everything else (plain Error, string, undefined) returns false → REFUND.
 * When in doubt, refund (favor the user).
 */
export function isPostProcessingError(err: unknown): boolean {
  if (err instanceof PostProcessingError) return true
  if (typeof err === "object" && err !== null) {
    return (err as { postProcessing?: unknown }).postProcessing === true
  }
  return false
}

/**
 * Run a post-provider step; if it throws, re-tag the failure as a
 * PostProcessingError so the refund guard skips the refund (we already paid
 * the provider for the delivered result). Preserves the original message +
 * attaches the original as `cause`. If the inner error is ALREADY a
 * PostProcessingError it is passed through unchanged (no double-wrap).
 *
 * Use this to wrap ONLY work that runs on a successfully-delivered provider
 * result (uploads, watermark, transcode, merge, strip-audio, loop-trim).
 * NEVER wrap input download / createTask / moderation / validation — those
 * must keep refunding.
 */
export async function runPostProcessing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isPostProcessingError(err)) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new PostProcessingError(message, { cause: err })
  }
}
