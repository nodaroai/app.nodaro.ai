/**
 * What a use-case run's input carries (its streams), read with ONE more try
 * when the first read failed for a reason that is not the file's own (decided
 * 2026-11-17). Under load the read itself can fail — the server short of
 * threads or memory, the link's host answering 5xx for a moment — and a run
 * used to tell the person their recording "could not be read" for it.
 *
 * - The first failure is logged, and read through the one classifier every
 *   measuring route shares (`probeLinkRefusal`, probe-guard.ts).
 * - A link the server will not read, or that is not a media file (a 400 of
 *   that classifier), is not tried again: it fails the same way.
 * - A read that already ran out of time (`probe_timeout`, after the probe's
 *   own two-minute watchdog) is not tried again either: the request would
 *   wait as long once more.
 * - Nor a link the host answered with a 4xx (not found, forbidden), or one
 *   the link guard refused for its own reason: those answer the same again.
 * - Anything else — a retryable failure, or one the classifier cannot name —
 *   is tried once more after a short pause.
 * - A retryable refusal names the input it is about ("Recording 2: …").
 * - What still fails is `transient` (a retryable refusal: the route answers
 *   503 with its code, run it again) or `failed` (the route's own "could not
 *   be read" 400, as before).
 */
import { probeMediaStreams, type MediaStreams } from "../../providers/video/ffmpeg-utils.js"
import { LINK_READ_TIMED_OUT, isRetryableProbeRefusal, probeLinkRefusal, type RetryableProbeRefusalCode } from "../../providers/video/probe-guard.js"

/** The pause before the second read: a thread or memory shortage, or a host's hiccup, passes in a moment. */
export const USE_CASE_PROBE_RETRY_DELAY_MS = 1_500

/** A retryable refusal: what the route answers (503) when the read still failed for a reason that is not the file's. */
export interface TransientProbeRefusal {
  readonly code: RetryableProbeRefusalCode
  readonly message: string
}

export type StreamsRead =
  | { readonly kind: "read"; readonly streams: MediaStreams }
  | { readonly kind: "transient"; readonly refusal: TransientProbeRefusal }
  | { readonly kind: "failed" }

const pause = (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve())

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** A failure that will answer the same again: the host's 4xx for the link, or the link guard's own refusal. */
const answersTheSame = (err: unknown): boolean =>
  /Server returned 4/.test(messageOf(err)) || (err as { reason?: unknown } | null)?.reason !== undefined

/** `what` names the input in the log line ("Recording 2", "The master audio"). */
export async function readUseCaseStreams(url: string, what: string, retryDelayMs: number = USE_CASE_PROBE_RETRY_DELAY_MS): Promise<StreamsRead> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { kind: "read", streams: await probeMediaStreams(url) }
    } catch (err) {
      const refusal = probeLinkRefusal(err)
      console.warn(`[use-case] reading ${what} failed (try ${attempt}${refusal ? `, ${refusal.code}` : ""}): ${messageOf(err)}`)
      const notTheFiles = refusal === undefined ? !answersTheSame(err) : isRetryableProbeRefusal(refusal)
      if (attempt === 1 && notTheFiles && refusal?.code !== LINK_READ_TIMED_OUT.code) {
        await pause(retryDelayMs)
        continue
      }
      return refusal && isRetryableProbeRefusal(refusal) ? { kind: "transient", refusal: { code: refusal.code, message: `${what}: ${refusal.message}` } } : { kind: "failed" }
    }
  }
}
