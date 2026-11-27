/**
 * Server-only keys in a job's `output_data` and `input_data`.
 *
 * THE CONVENTION: a TOP-LEVEL `output_data` key whose name starts with `__`
 * (double underscore) is server-only. Plugins keep resume checkpoints there
 * (`tk.jobs.updateJobCheckpoint` / `readJobCheckpoint`, which read and write
 * the raw column and so keep seeing them); no job read that answers a user,
 * an SDK consumer, an MCP client or a webhook ever returns one. The strip
 * happens on read, never on write — the stored row keeps the checkpoint.
 *
 * The same rule covers `input_data`'s own top-level keys: a job keeps hidden
 * inputs there (a trend run's source clip URL and prompt parts), which
 * workers read from the raw column and no job read returns. Only those two
 * objects' own keys are covered: a `__` key nested deeper in either is not
 * this convention's business.
 *
 * Applied for every caller, admins included (as `unscoredUrl` is): the
 * checkpoint is internal state, not a cost or provider internal an admin
 * reads. Wired in through `redactPrivateJobData` (lib/public-job-data.ts),
 * which every job read surface already runs.
 */

/** The prefix of a server-only top-level key of `input_data` or `output_data`. */
const SERVER_ONLY_OUTPUT_KEY_PREFIX = "__"

/**
 * Video Remake's reference audio keys, server-only like the `__` keys (decided
 * 2026-11-27): the admin's per-engine-size choice of what audio the clip sent
 * to the video model carries, which the platform puts in a direct run's
 * request (`input_data.prismReferenceAudio` / `pulseReferenceAudio`,
 * middleware/nodaro-motion-prism-reference-audio.ts and its Pulse twin) and a
 * trend run's composition sends, and what the engine records it did with it
 * (`output_data.prismReferenceAudioSemitones`, `…Resolution`, `…Fallback`,
 * `…FallbackReason`, `pulseReferenceAudioResolution`, and any later key of the
 * same family). It is admin configuration, never a caller's: no job read
 * returns it, an admin's included, for rows stored before this rule too. Only
 * a top-level key of `input_data` / `output_data` that starts with one of
 * these is covered; the engine and the admin's own reads use the raw columns.
 */
const SERVER_ONLY_KEY_FAMILIES = ["prismReferenceAudio", "pulseReferenceAudio"] as const

/**
 * Whether a top-level `input_data` or `output_data` key is server-only (see
 * the convention above, and the reference audio keys).
 */
export function isServerOnlyOutputKey(key: string): boolean {
  return key.startsWith(SERVER_ONLY_OUTPUT_KEY_PREFIX) || SERVER_ONLY_KEY_FAMILIES.some((family) => key.startsWith(family))
}

/**
 * `output` without its server-only top-level keys. Never mutates the input;
 * returns it as is when it is not a plain object (null, an array, a scalar)
 * or has nothing to drop.
 */
export function withoutServerOnlyKeys<T>(output: T): T {
  if (output === null || typeof output !== "object" || Array.isArray(output)) return output
  const entries = Object.entries(output as Record<string, unknown>)
  if (!entries.some(([key]) => isServerOnlyOutputKey(key))) return output
  const copy: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    if (isServerOnlyOutputKey(key)) continue
    Object.defineProperty(copy, key, { value, enumerable: true, configurable: true, writable: true })
  }
  return copy as T
}
