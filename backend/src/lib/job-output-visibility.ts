/**
 * Server-only keys in a job's `output_data`.
 *
 * THE CONVENTION: a TOP-LEVEL `output_data` key whose name starts with `__`
 * (double underscore) is server-only. Plugins keep resume checkpoints there
 * (`tk.jobs.updateJobCheckpoint` / `readJobCheckpoint`, which read and write
 * the raw column and so keep seeing them); no job read that answers a user,
 * an SDK consumer, an MCP client or a webhook ever returns one. The strip
 * happens on read, never on write — the stored row keeps the checkpoint.
 *
 * Only `output_data`'s own keys are covered: a `__` key nested deeper in the
 * output, or anywhere in `input_data`, is not this convention's business.
 *
 * Applied for every caller, admins included (as `unscoredUrl` is): the
 * checkpoint is internal state, not a cost or provider internal an admin
 * reads. Wired in through `redactPrivateJobData` (lib/public-job-data.ts),
 * which every job read surface already runs.
 */

const SERVER_ONLY_OUTPUT_KEY_PREFIX = "__"

/** Whether an `output_data` key is server-only (see the convention above). */
export function isServerOnlyOutputKey(key: string): boolean {
  return key.startsWith(SERVER_ONLY_OUTPUT_KEY_PREFIX)
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
