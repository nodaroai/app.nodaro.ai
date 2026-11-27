/**
 * The files a job deleted for good leaves in storage (decided 2026-11-23).
 *
 * A job's server-only record (`jobs.server_output.stored`, migration 695)
 * holds each file a video store kept beside its playable copy: a kept
 * original (`videos/<jobId>-master.<ext>`), a watermarked Extend's raw clip.
 * Deleting the job destroys that record, and with it the only thing that
 * could ever find those files again. So the delete functions answer, from
 * the rows they delete and in the same transaction, the keys each deleted
 * job's record held and the urls its own output names
 * (`recordedFilesByJob`, migration 736), and the permanent-delete funnel
 * (lib/workflow-delete.ts) hands that answer here once the delete really
 * happened. A delete the database refused answers nothing, so it removes
 * nothing.
 *
 * WHAT IS REMOVED: a recorded file of a deleted job, in that job's own key
 * family, that its output does not name as a result (an original the job
 * completed on IS its result), and that nothing else still uses. Kept:
 *   - a file a Library row names (any user's row);
 *   - a kept original of a job whose preview, or any other file, a Library
 *     row names: the original goes with that item, when the item is deleted
 *     (lib/asset-delete.ts), never before. Only an original: nothing in the
 *     Library reads a raw clip or another server-only intermediate, so those
 *     are not kept for a Library item;
 *   - every recorded file of a deleted job a job still in flight names in its
 *     input (by its id, which each of its keys and urls carries: the file
 *     itself, its result, or the job as a source whose raw clip a later
 *     Extend reads);
 *   - a file another job's output names, at any depth, any owner (the index
 *     on the urls a job output holds, migration 495), under the public host
 *     or the fallback host. Asked after the in-flight inputs: a job's
 *     completion writes its status and its output in one update, so a job
 *     that completes between the two questions is seen by the second;
 *   - a file held as evidence of a complaint;
 *   - a file our relay target made;
 *   - everything, on a deployment that deletes nothing (STORAGE_DELETES=skip).
 * A lookup that fails keeps every file it was asked about. A delete storage
 * does not confirm goes to the storage-delete retry pass ("job-delete"),
 * which asks less than this first try: a Library row naming the key itself,
 * and a job made since the failure linking its public url.
 *
 * WHAT STAYS BY RULE: the files a job's output names (its preview, its
 * images, thumbnails, audio, a set's pictures). The editor copies a result's
 * address into its workflow, and a duplicated or copied workflow, a published
 * app's snapshot, a run's node states, a character's or location's picture
 * and another job's input all hold such an address with no index to find it
 * by, so nothing here can tell they are unused. A kept original or a raw clip
 * is read from none of those: the editor never reads `originalVideoUrl`, and
 * the server reads it, and a raw clip, only off the job that stored it (a
 * run's node states may still hold a copy of the output, which nothing reads
 * the original from).
 *
 * BYTES: removing a file gives nothing back. Its bytes are what the delete
 * function already answered (`storedBytesByOwner`, migration 708), which the
 * funnel gives back once.
 *
 * Never throws, and never blocks or fails the delete that called it.
 */
import { supabase } from "./supabase.js"
import { config } from "./config.js"
import { isOwnedObjectKey } from "./job-key-family.js"
import { keysHeldByOtherLibraryRows, storageUrlPath } from "./key-ownership.js"
import { heldAmong } from "./legal-hold.js"
import { relayOwnedKeysStrict } from "./asset-delete.js"
import { urlsLinkedByJobsSince } from "./job-output-references.js"
import { deleteKeysRecordingFailures, isRetryableDeleteKey, keyFailures, publicUrlOfKey, recordFailedDeletes } from "./storage-delete.js"
import { storageDeletesSkipped } from "./storage-deletes-setting.js"
import { isKeptOriginalKey, previewKeyOfKeptOriginal } from "./video-original-keys.js"

/** The delete functions' answer field (migration 736). */
export const RECORDED_FILES_FIELD = "recordedFilesByJob"
/** Migration 736: which needles an in-flight job's input names (its statuses are `IN_FLIGHT_JOB_STATUSES`, written out). */
export const IN_FLIGHT_INPUTS_FN = "in_flight_job_inputs_naming"
const NEEDLES_PER_CALL = 100

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Logger {
  warn(fields: Record<string, unknown>, message: string): void
}

/** One deleted job's files, as its delete answered them. */
export interface DeletedJobFiles {
  readonly jobId: string
  /** The keys its server-only record held, in its own key family. */
  readonly recorded: readonly string[]
  /** The urls its own output names that carry its id (its result among them). */
  readonly namedUrls: readonly string[]
  /** The keys of `namedUrls` that are this job's own files. */
  readonly namedKeys: readonly string[]
}

/** Why a file stayed. */
export type KeptBecause =
  | "delivered"
  | "storage-deletes-off"
  | "not-deletable"
  | "library"
  | "held"
  | "relay"
  | "job-output"
  | "in-flight-input"
  | "unchecked"

export interface RemovalOutcome {
  /** Keys storage confirmed gone (or never had). */
  readonly removed: readonly string[]
  /** Keys left in storage, each with why. */
  readonly kept: ReadonlyMap<string, KeptBecause>
  /** Keys storage did not confirm gone: recorded for the retry pass. */
  readonly failed: readonly string[]
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : []
}

/**
 * The answer's `recordedFilesByJob`, parsed: undefined when the delete
 * function does not answer it (migration 736 not applied), empty when it
 * answers anything but an object of jobs.
 */
export function recordedFilesOf(answer: unknown): DeletedJobFiles[] | undefined {
  const field = (answer as Record<string, unknown> | null)?.[RECORDED_FILES_FIELD]
  if (field === undefined) return undefined
  if (typeof field !== "object" || field === null || Array.isArray(field)) return []
  const out: DeletedJobFiles[] = []
  for (const [jobId, files] of Object.entries(field as Record<string, unknown>)) {
    if (!UUID_RE.test(jobId) || typeof files !== "object" || files === null) continue
    const f = files as Record<string, unknown>
    const namedUrls = stringsOf(f.named)
    const namedKeys = namedUrls.flatMap((url) => {
      const at = storageUrlPath(url)
      return at.kind === "ours" && isOwnedObjectKey(jobId, at.path) ? [at.path] : []
    })
    out.push({
      jobId,
      recorded: stringsOf(f.recorded).filter((key) => isOwnedObjectKey(jobId, key)),
      namedUrls,
      namedKeys,
    })
  }
  return out
}

/**
 * The recorded files of `job` its output does not name: what its delete may
 * remove. One its output names (an original the job completed on, delivered
 * as its result) is the result, and stays like every result.
 */
export function removableRecordedKeys(job: DeletedJobFiles): string[] {
  const named = new Set(job.namedKeys)
  return job.recorded.filter((key) => !named.has(key) && !job.namedUrls.some((url) => url.includes(key)))
}

/**
 * The keys a Library item of a job's video may name, which keep its kept
 * originals: the files its output names, its originals, and the preview each
 * original was stored beside. Its raw clips are not among them.
 */
function libraryKeysOf(job: DeletedJobFiles): string[] {
  const originals = job.recorded.filter(isKeptOriginalKey)
  return [...job.namedKeys, ...originals, ...originals.flatMap((key) => previewKeyOfKeptOriginal(key) ?? [])]
}

/** Every address a key is served at: the public url, and the fallback host's. */
function urlSpellingsOf(key: string): string[] {
  const out = new Set<string>()
  const pub = publicUrlOfKey(key)
  if (pub) out.add(pub)
  const fallback = (config.R2_PUBLIC_FALLBACK_DOMAIN ?? "").trim()
  if (fallback) out.add(`https://${fallback}/${key}`)
  return [...out]
}

/** The keys among `keys` another job's output names, at any address. Throws when it cannot be asked. */
async function keysNamedByJobOutputs(keys: readonly string[]): Promise<Set<string>> {
  const keyOfUrl = new Map<string, string>()
  for (const key of keys) for (const url of urlSpellingsOf(key)) keyOfUrl.set(url, key)
  if (keyOfUrl.size === 0) return new Set(keys)
  // The deleted jobs' rows are gone: any job that still names a url is another.
  const linked = await urlsLinkedByJobsSince([...keyOfUrl.keys()].map((url) => ({ url, since: new Date(0) })))
  const named = new Set<string>()
  for (const url of linked) {
    const key = keyOfUrl.get(url)
    if (key) named.add(key)
  }
  return named
}

/** The ids among `jobIds` a job still in flight names in its input. Throws when it cannot be asked. */
async function jobsNamedByInFlightInputs(jobIds: readonly string[]): Promise<Set<string>> {
  const named = new Set<string>()
  for (let i = 0; i < jobIds.length; i += NEEDLES_PER_CALL) {
    const { data, error } = await supabase.rpc(IN_FLIGHT_INPUTS_FN, { p_needles: jobIds.slice(i, i + NEEDLES_PER_CALL) })
    if (error) throw new Error(`${IN_FLIGHT_INPUTS_FN} failed: ${error.message ?? "unknown error"}`)
    for (const id of (data ?? []) as unknown[]) if (typeof id === "string") named.add(id)
  }
  return named
}

/** Whether an answer without the field was already reported (once per process). */
let fieldMissingReported = false

/** For tests: report a missing field again. */
export function _resetRecordedFilesReportForTests(): void {
  fieldMissingReported = false
}

function warn(logger: Logger | undefined, fields: Record<string, unknown>, message: string): void {
  if (logger) logger.warn(fields, message)
  else console.warn(`[deleted-job-files] ${message}`, fields)
}

/**
 * Remove the recorded files the jobs a delete for good took leave unused
 * (see the note at the top). `answer` is the delete function's answer for a
 * delete that happened (`deleted` true). Never throws.
 */
export async function removeDeletedJobsRecordedFiles(
  answer: unknown,
  opts: { readonly logger?: Logger; readonly scope?: Record<string, unknown> } = {},
): Promise<RemovalOutcome> {
  const kept = new Map<string, KeptBecause>()
  const removed: string[] = []
  const failed: string[] = []
  const outcome = (): RemovalOutcome => ({ removed, kept, failed })
  const keep = (keys: Iterable<string>, why: KeptBecause): void => {
    for (const key of keys) if (!kept.has(key)) kept.set(key, why)
  }

  const jobs = recordedFilesOf(answer)
  if (jobs === undefined) {
    if (!fieldMissingReported) {
      fieldMissingReported = true
      warn(opts.logger, opts.scope ?? {}, "the delete answered no recorded files (migration 736 not applied): the deleted jobs' files stay in storage")
    }
    return outcome()
  }

  const jobOfKey = new Map<string, string>()
  for (const job of jobs) {
    const removable = new Set(removableRecordedKeys(job))
    keep(job.recorded.filter((key) => !removable.has(key)), "delivered")
    for (const key of removable) jobOfKey.set(key, job.jobId)
  }
  let pending = [...jobOfKey.keys()]
  if (pending.length === 0) return outcome()
  const drop = (keys: Iterable<string>, why: KeptBecause): void => {
    const gone = new Set(keys)
    if (gone.size === 0) return
    keep(gone, why)
    pending = pending.filter((key) => !gone.has(key))
  }

  if (storageDeletesSkipped()) {
    drop(pending, "storage-deletes-off")
    return outcome()
  }
  // A key storage would refuse outright fails a whole batch: never sent.
  drop(pending.filter((key) => !isRetryableDeleteKey(key)), "not-deletable")

  try {
    // A Library row naming a file keeps it; one naming any file of a job's
    // video keeps that job's kept originals, which go with the item
    // (lib/asset-delete.ts). Raw clips and other intermediates are not kept for it.
    if (pending.length > 0) {
      const inLibrary = await keysHeldByOtherLibraryRows([...pending, ...jobs.flatMap(libraryKeysOf)], () => false)
      const libraryJobs = new Set(jobs.filter((job) => libraryKeysOf(job).some((key) => inLibrary.has(key))).map((job) => job.jobId))
      drop(pending.filter((key) => inLibrary.has(key) || (isKeptOriginalKey(key) && libraryJobs.has(jobOfKey.get(key) ?? ""))), "library")
    }
    if (pending.length > 0) drop(await heldAmong(pending), "held")
    if (pending.length > 0) drop(await relayOwnedKeysStrict(pending), "relay")
    // In-flight inputs first, then outputs: a completion writes its status and
    // its output in one update, so a job that completes between the two
    // questions names the file in the second.
    if (pending.length > 0) {
      const inFlight = await jobsNamedByInFlightInputs([...new Set(pending.map((key) => jobOfKey.get(key) ?? ""))].filter(Boolean))
      drop(pending.filter((key) => inFlight.has(jobOfKey.get(key) ?? "")), "in-flight-input")
    }
    if (pending.length > 0) drop(await keysNamedByJobOutputs(pending), "job-output")
  } catch (err) {
    warn(opts.logger, { ...opts.scope, kept: pending.length, err: err instanceof Error ? err.message : String(err) }, "a deleted job's recorded files could not be checked: they stay in storage")
    drop(pending, "unchecked")
    return outcome()
  }
  if (pending.length === 0) return outcome()

  const recordOpts = { jobIdOf: (key: string) => jobOfKey.get(key) ?? null }
  const attemptedAt = new Date()
  try {
    // Holds, kept prefixes and the deployment setting are asked again inside;
    // a key storage does not confirm gone is recorded for the retry pass.
    const result = await deleteKeysRecordingFailures(pending, "job-delete", recordOpts)
    const notDeleted = new Set(result.notDeleted ?? [])
    const notConfirmed = new Set(result.failed)
    for (const key of pending) {
      if (notConfirmed.has(key)) failed.push(key)
      else if (notDeleted.has(key)) keep([key], "held")
      else removed.push(key)
    }
  } catch (err) {
    // The delete threw before saying what it did (its funnel records nothing
    // then): every file goes to the retry pass, which deletes what is still there.
    failed.push(...pending)
    warn(opts.logger, { ...opts.scope, keys: pending.length, err: err instanceof Error ? err.message : String(err) }, "removing a deleted job's recorded files failed; they are left to the storage-delete retry pass")
    try {
      await recordFailedDeletes(keyFailures(pending, "job-delete", recordOpts, attemptedAt))
    } catch (recordErr) {
      console.error(`[deleted-job-files] ${pending.length} file(s) of deleted jobs could not be recorded for retry: ${pending.join(", ")}`, recordErr)
    }
    return outcome()
  }
  if (failed.length > 0) {
    warn(opts.logger, { ...opts.scope, attempted: pending.length, failed: failed.length }, "some of a deleted job's recorded files were not removed; they are left to the storage-delete retry pass")
  }
  return outcome()
}
