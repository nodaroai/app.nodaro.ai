/**
 * The fields of a job's output that ONLY ITS OWNER reads.
 *
 * Every job read runs the same redaction (`redactPrivateJobData` / `redactPrivateJobOutput`, lib/public-job-data.ts),
 * which drops a job's server-only `__` keys and knows nothing of who is reading: the same function serves the owner's
 * own reads and reads of other people's public jobs (MCP `list_jobs` with `scope: "public"`, `get_asset` on someone
 * else's public result, share links, the gallery). A field that belongs to the owner alone therefore never comes from
 * the redaction. It is added here, AFTER it, from the raw row, by a read that names its reader — and only when that
 * reader is the job's owner (`ownerUserId`, the row's `user_id`: a job is read by its owner, an admin reading it is
 * not its owner). Anyone else gets the redacted output unchanged, the very same object.
 *
 * Today one field family: Video Remake's version before its upscale step (the Quality choice, 2026-11-27,
 * lib/video-remake-quality.ts). The engine keeps it server-only, as it keeps every fact of the step; a run whose
 * request named the choice and was made the Economy way states `quality: "economy"` in sight, and for such a run its
 * owner reads that version by the names the SDK types (`engineVideoUrl`, `engineWidth`, `engineHeight`,
 * `engineResolution`), each read from the server-only key beside it, never over a key the output already has.
 *
 * WHO MAY CALL THIS: a read whose reader is the signed-in user and whose rows are theirs (or an admin's read, where
 * the check below keeps the fields to the owner's own rows). `lib/__tests__/job-owner-output-sites.test.ts` holds the
 * callers to a list, and fails a read of other people's jobs that imports this module.
 */

/** Who is reading: the signed-in user. */
export interface JobReader {
  readonly userId: string | null | undefined
}

const VIDEO_REMAKE_BEFORE_UPSCALE: ReadonlyArray<readonly [publicKey: string, serverOnlyKey: string]> = [
  ["engineVideoUrl", "__castSwapEngineVideoUrl"],
  ["engineWidth", "__castSwapEngineWidth"],
  ["engineHeight", "__castSwapEngineHeight"],
  ["engineResolution", "__castSwapEngineResolution"],
]

/** The public names an owner-only field is answered under (what a non-owner read must never carry). */
export const OWNER_ONLY_OUTPUT_KEYS: readonly string[] = VIDEO_REMAKE_BEFORE_UPSCALE.map(([publicKey]) => publicKey)

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Whether `reader` owns a job whose `user_id` is `ownerUserId`: the same signed-in user, both known. */
export function readerOwnsJob(ownerUserId: unknown, reader: JobReader): boolean {
  return typeof ownerUserId === "string" && ownerUserId !== "" && typeof reader.userId === "string" && reader.userId === ownerUserId
}

/**
 * The owner-only fields of a job's RAW output (before redaction), for its owner alone: `{}` for anyone else, for an
 * output with none, or for anything that is not a plain object. A new object.
 */
export function ownerOnlyOutputFields(rawOutput: unknown, ownerUserId: unknown, reader: JobReader): Record<string, unknown> {
  if (!readerOwnsJob(ownerUserId, reader) || !isPlainObject(rawOutput)) return {}
  if (rawOutput.quality !== "economy" || typeof rawOutput.__castSwapEngineVideoUrl !== "string" || rawOutput.__castSwapEngineVideoUrl === "") return {}
  const out: Record<string, unknown> = {}
  for (const [publicKey, serverOnlyKey] of VIDEO_REMAKE_BEFORE_UPSCALE) {
    if (Object.hasOwn(rawOutput, publicKey) || !Object.hasOwn(rawOutput, serverOnlyKey)) continue
    const value = rawOutput[serverOnlyKey]
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) out[publicKey] = value
  }
  return out
}

/**
 * `redactedOutput` (a job's output as the redaction left it) with the owner-only fields of `rawOutput` added, for the
 * job's owner alone. The same object whenever there is nothing to add (anyone else, or no such field). Never mutates.
 */
export function withOwnerOnlyOutputFields<T>(redactedOutput: T, rawOutput: unknown, ownerUserId: unknown, reader: JobReader): T {
  const fields = ownerOnlyOutputFields(rawOutput, ownerUserId, reader)
  if (Object.keys(fields).length === 0 || !isPlainObject(redactedOutput)) return redactedOutput
  return { ...redactedOutput, ...fields } as T
}

/**
 * A job row as a read answers it (`answeredRow`, its `output_data` redacted) with the owner-only fields of the raw
 * row's output added to its `output_data`, for the job's owner alone (`rawRow.user_id`). The same object otherwise.
 */
export function withOwnerOnlyRowFields<T>(answeredRow: T, rawRow: { readonly user_id?: unknown; readonly output_data?: unknown }, reader: JobReader): T {
  if (!isPlainObject(answeredRow) || !Object.hasOwn(answeredRow, "output_data")) return answeredRow
  const output = withOwnerOnlyOutputFields(answeredRow.output_data, rawRow.output_data, rawRow.user_id, reader)
  return output === answeredRow.output_data ? answeredRow : ({ ...answeredRow, output_data: output } as T)
}
