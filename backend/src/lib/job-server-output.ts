/**
 * `jobs.server_output` (migration 695, decided 2026-11-22): what a job stored
 * that its owner must not read. `output_data` is readable by the owner over
 * PostgREST and Realtime (migration 347's column grant), so nothing private can
 * live there; this column is granted to no browser role.
 *
 *   - `stored`: { <object key>: <bytes> } — each object a video store kept
 *     beside its playable copy (a kept original, an Extend's raw reference),
 *     with the bytes charged to the owner for it. Such an object exists ONLY
 *     if its record landed (`recordStoredObjectAndCharge`): a store whose
 *     record does not land deletes it again and keeps none. Every delete of
 *     one first CLAIMS it off the record (`claimStoredObjects`, under the row
 *     lock) and gives back only what the claim answered, so two deleters of
 *     one object give its bytes back once.
 *   - `rawExtensionUrl`: a watermarked Extend's raw clip (the chain reads it).
 */
import { supabase } from "./supabase.js"
import { hasCredits } from "./config.js"
import { updateStorageUsage } from "../utils/file-validation.js"

export { withServerOutput } from "./job-server-output-column.js"
import { withServerOutput } from "./job-server-output-column.js"
import { isOwnedObjectKey } from "./job-key-family.js"

const RECORD_FN = "record_job_stored_object"
const CLAIM_FN = "claim_job_stored_objects"
const DISCARD_FN = "discard_unrecorded_job_object"
const CLOCK_FN = "job_store_now"
const MARK_PRUNED_FN = "mark_job_pruned"
/** How many times a record call that errored is sent again (it is idempotent on its key). */
const RECORD_TRIES = 3

export interface ServerOutput {
  readonly stored?: Readonly<Record<string, number>>
  readonly rawExtensionUrl?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** The job a store id belongs to: its UUID head (`<jobId>`, `<jobId>-merged`…), else undefined. */
export function jobIdOfStoreId(storeId: string): string | undefined {
  return UUID_RE.exec(storeId)?.[0]
}

/** A row's `server_output` as a typed record (anything else is empty). */
export function serverOutputOf(value: unknown): ServerOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const v = value as Record<string, unknown>
  const stored: Record<string, number> = {}
  if (v.stored && typeof v.stored === "object" && !Array.isArray(v.stored)) {
    for (const [key, bytes] of Object.entries(v.stored as Record<string, unknown>)) {
      const n = Number(bytes)
      if (Number.isFinite(n) && n >= 0) stored[key] = n
    }
  }
  return {
    ...(Object.keys(stored).length > 0 ? { stored } : {}),
    ...(typeof v.rawExtensionUrl === "string" ? { rawExtensionUrl: v.rawExtensionUrl } : {}),
  }
}

/** The bytes recorded for each of `keys` that this server output names. */
export function recordedBytesOf(serverOutput: ServerOutput, keys: Iterable<string>): number {
  let sum = 0
  for (const key of keys) sum += serverOutput.stored?.[key] ?? 0
  return sum
}

/** What recording a stored object came to (`recordStoredObjectAndCharge`). */
export type StoreRecordOutcome =
  /** Recorded on its live job; `charged` is what this call charged (0 on a retry of a recorded key). */
  | { readonly outcome: "recorded"; readonly charged: number }
  /** The job was cancelled or failed meanwhile: nothing recorded; the caller discards the object (`discardJustStored(…, "ended")`). */
  | { readonly outcome: "ended" }
  /** The job already completed, or has no row: a second finalizer of a delivered job. The object at that key is the delivered one: never deleted. */
  | { readonly outcome: "delivered" }
  /**
   * Certainly not recorded (a read-back shows no record, or another store of
   * the job is discarding that key): the caller discards the object it uploaded
   * (`discardJustStored(…, "unrecorded")`, which never deletes one another
   * store recorded) and keeps no original.
   */
  | { readonly outcome: "unrecorded" }
  /** Could not be told (every call and the read-back failed): the caller keeps no original and leaves the object, which is found by its record if it has one. */
  | { readonly outcome: "unknown" }

/**
 * This database's clock (`job_store_now`), read when a store begins: what it
 * hands `recordStoredObjectAndCharge` as `begunAt`. Undefined when it cannot
 * be read (the store then keeps no original).
 */
export async function storeBeginTime(): Promise<string | undefined> {
  try {
    const { data, error } = await supabase.rpc(CLOCK_FN)
    return !error && typeof data === "string" && data ? data : undefined
  } catch {
    return undefined
  }
}

/**
 * Record `key` (`bytes` long) as stored by its LIVE job `jobId`, with `patch`
 * merged into the column, and charge the job's own owner what the key was not
 * already charged (`record_job_stored_object`, migration 695): once per key,
 * whatever the retries, and the key records only what was charged. `begunAt`
 * is when this store began (`storeBeginTime`): a key another store of the job
 * discarded after that is not recorded.
 *
 * An object exists only if its record landed (decided 2026-11-22). A call
 * that errors is sent again (idempotent: a call that committed before its
 * answer was lost charges nothing more the second time); when every call
 * errors, the record is read back to tell "recorded" from "unrecorded".
 */
export async function recordStoredObjectAndCharge(args: {
  jobId: string
  key: string
  bytes: number
  begunAt: string
  patch?: Record<string, unknown>
}): Promise<StoreRecordOutcome> {
  let lastError: { code?: string | null; message?: string | null } | null = null
  for (let attempt = 0; attempt < RECORD_TRIES; attempt++) {
    const { data, error } = await supabase.rpc(RECORD_FN, {
      p_job_id: args.jobId,
      p_key: args.key,
      p_bytes: args.bytes,
      p_charge: hasCredits(),
      p_patch: args.patch ?? {},
      p_begun_at: args.begunAt,
    }).then((r) => r, (err: unknown) => ({ data: null, error: { code: null, message: String(err) } }))
    if (!error) {
      const answer = (data ?? {}) as { live?: unknown; charged?: unknown; ended?: unknown; discarded?: unknown }
      if (answer.live === false) return answer.ended === true ? { outcome: "ended" } : { outcome: "delivered" }
      if (answer.discarded === true) return { outcome: "unrecorded" }
      noteRecordedHere(args.jobId)
      return { outcome: "recorded", charged: Number(answer.charged) || 0 }
    }
    lastError = error
  }
  console.warn(`[job-server-output] recording ${args.key} on job ${args.jobId} failed ${RECORD_TRIES} times; reading the record back:`, lastError?.message)
  try {
    const { data, error } = await withServerOutput("id", (cols) =>
      // trash-read: the store reading back its own record of the object it just stored — never answered to a user
      supabase.from("jobs").select(cols).eq("id", args.jobId).maybeSingle())
    if (error) {
      noteRecordedHere(args.jobId)
      return { outcome: "unknown" }
    }
    const row = data as { server_output?: unknown } | null
    if (row && args.key in (serverOutputOf(row.server_output).stored ?? {})) {
      noteRecordedHere(args.jobId)
      return { outcome: "recorded", charged: 0 }
    }
    return { outcome: "unrecorded" }
  } catch {
    return { outcome: "unknown" }
  }
}

/** What a claim came to: `ok` false when the claim did not run (the caller then deletes nothing). */
export interface StoredObjectsClaim {
  readonly ok: boolean
  readonly ownerId?: string
  readonly claimed: Readonly<Record<string, number>>
}

/**
 * Claim `keys` off job `jobId`'s record (`claim_job_stored_objects`, under the
 * row lock): each one still recorded is removed from it, and its recorded
 * (charged) bytes answered. A key another path claimed first is not answered.
 * `ok` is false when the claim did not run (a failed call): a caller then deletes NOTHING and leaves it for its next pass.
 * Never throws.
 */
export async function claimStoredObjects(jobId: string, keys: readonly string[]): Promise<StoredObjectsClaim> {
  if (keys.length === 0) return { ok: true, claimed: {} }
  try {
    const { data, error } = await supabase.rpc(CLAIM_FN, { p_job_id: jobId, p_keys: [...keys] })
    if (error) {
      console.warn(`[job-server-output] claiming ${keys.length} object(s) of job ${jobId} failed:`, error.message)
      return { ok: false, claimed: {} }
    }
    const answer = (data ?? {}) as { owner?: unknown; claimed?: unknown }
    const claimed: Record<string, number> = {}
    if (answer.claimed && typeof answer.claimed === "object" && !Array.isArray(answer.claimed)) {
      for (const [k, v] of Object.entries(answer.claimed as Record<string, unknown>)) {
        const n = Number(v)
        claimed[k] = Number.isFinite(n) && n > 0 ? n : 0
      }
    }
    return { ok: true, ...(typeof answer.owner === "string" ? { ownerId: answer.owner } : {}), claimed }
  } catch (err) {
    console.warn(`[job-server-output] claiming ${keys.length} object(s) of job ${jobId} failed:`, err)
    return { ok: false, claimed: {} }
  }
}

/** Give a claim's bytes back to its owner. Never throws. */
async function refundClaim(claim: StoredObjectsClaim): Promise<number> {
  const bytes = recordedBytesOf({ stored: claim.claimed }, Object.keys(claim.claimed))
  if (claim.ownerId && bytes > 0) {
    await updateStorageUsage(claim.ownerId, -bytes).catch((err) => console.error("[job-server-output] storage usage update failed:", err))
  }
  return bytes
}

/** What reaping recorded objects came to (`reapRecordedObjects`). */
export interface RecordedReap {
  /** Jobs whose claim did not run: nothing of theirs was claimed or deleted; leave them for the next pass. */
  readonly failedJobIds: ReadonlySet<string>
  /** Keys kept on purpose (held as evidence, or a deployment that deletes nothing): never claimed, refunded or dropped from the record. */
  readonly keptKeys: ReadonlySet<string>
  /** Keys storage confirmed gone. */
  readonly deletedKeys: ReadonlySet<string>
  readonly deleted: number
  readonly errors: number
  readonly refunded: number
}

/**
 * Claim each job's `keys` off its record, then delete what the claim took and
 * give back what it answered (decided 2026-11-23): the one way a recorded
 * object is deleted by a sweep, an expunge or a discard. Deleted only after
 * the claim RAN (a job whose claim failed keeps everything, for the next
 * pass), and only the keys this claim took: a key another path claimed first
 * is that path's to delete and refund — every path that claims also deletes.
 * `deleteUnclaimed` deletes the rest too (a store discarding the object it
 * just uploaded, which may never have been recorded). Keys outside a job's
 * own key family are never touched. Never throws.
 */
export async function reapRecordedObjects(
  entries: ReadonlyArray<{ readonly jobId: string; readonly key: string }>,
  source: "retention" | "admin-expunge" | "job-output" = "job-output",
  opts: { readonly deleteUnclaimed?: boolean } = {},
): Promise<RecordedReap> {
  const byJob = new Map<string, Set<string>>()
  for (const e of entries) {
    if (!isOwnedObjectKey(e.jobId, e.key)) continue
    byJob.set(e.jobId, (byJob.get(e.jobId) ?? new Set()).add(e.key))
  }
  const failedJobIds = new Set<string>()
  const keptKeys = new Set<string>()
  const deletedKeys = new Set<string>()
  let deleted = 0
  let errors = 0
  let refunded = 0
  if (byJob.size === 0) return { failedJobIds, keptKeys, deletedKeys, deleted, errors, refunded }
  // Kept on purpose, BEFORE any claim (decided 2026-11-23): a deployment that
  // deletes nothing keeps every object, and a key held as evidence is never
  // deleted — neither is claimed, refunded or dropped from its record.
  const allKeys = [...byJob.values()].flatMap((keys) => [...keys])
  const [{ storageDeletesSkipped }, { heldAmong }] = await Promise.all([import("./storage-deletes-setting.js"), import("./legal-hold.js")])
  let held: Set<string>
  try {
    held = storageDeletesSkipped() ? new Set(allKeys) : await heldAmong(allKeys)
  } catch (err) {
    // The hold cannot be read: nothing is claimed or deleted this pass.
    console.warn("[job-server-output] the legal hold could not be read; recorded objects left for the next pass:", err)
    return { failedJobIds: new Set(byJob.keys()), keptKeys, deletedKeys, deleted, errors, refunded }
  }
  for (const k of held) keptKeys.add(k)
  for (const [jobId, allJobKeys] of byJob) {
    const jobKeys = [...allJobKeys].filter((k) => !held.has(k))
    if (jobKeys.length === 0) continue
    const claim = await claimStoredObjects(jobId, jobKeys)
    if (!claim.ok) {
      failedJobIds.add(jobId)
      continue
    }
    // The claimed bytes are given back now: nothing can claim them again.
    refunded += await refundClaim(claim)
    const toDelete = opts.deleteUnclaimed ? jobKeys : jobKeys.filter((k) => k in claim.claimed)
    if (toDelete.length === 0) continue
    // Past the claim, a key is this path's to delete whatever happens: each
    // one storage does not confirm gone, and each a throwing delete leaves,
    // goes to the storage-delete retry pass — never back to "unclaimed".
    const result = await deleteClaimedKeys(jobId, toDelete, source)
    deleted += result.deleted
    errors += result.errors
    for (const k of result.gone) deletedKeys.add(k)
  }
  return { failedJobIds, keptKeys, deletedKeys, deleted, errors, refunded }
}

/** Delete keys a claim took: the batch delete, or (when it throws) one key at a time, each failure recorded for the retry pass. Never throws. */
async function deleteClaimedKeys(jobId: string, keys: readonly string[], source: "retention" | "admin-expunge" | "job-output"): Promise<{ gone: string[]; deleted: number; errors: number }> {
  const { deleteKeysRecordingFailures, deleteKeyRecordingFailure } = await import("./storage-delete.js")
  try {
    const result = await deleteKeysRecordingFailures(keys, source, { jobIdOf: () => jobId })
    const kept = new Set(result.notDeleted ?? [])
    return { gone: keys.filter((k) => !kept.has(k)), deleted: result.deleted, errors: result.errors }
  } catch (err) {
    console.warn(`[job-server-output] the batch delete of job ${jobId}'s claimed objects threw; deleting them one at a time:`, err)
    const gone: string[] = []
    let errors = 0
    for (const key of keys) {
      try {
        await deleteKeyRecordingFailure(key, source, { jobIdOf: () => jobId })
        gone.push(key)
      } catch {
        // Recorded for the retry pass by deleteKeyRecordingFailure itself.
        errors++
      }
    }
    return { gone, deleted: gone.length, errors }
  }
}

/** Claim `keys` off `jobId`'s record, delete them and give back what was claimed (`reapRecordedObjects`). Returns the bytes given back. Never throws. */
export async function claimDeleteAndRefund(jobId: string, keys: readonly string[]): Promise<number> {
  return (await reapRecordedObjects(keys.map((key) => ({ jobId, key })))).refunded
}

/**
 * Delete an object a store uploaded a moment before, under a key it built
 * itself in its job's own family, when it must not stay (decided 2026-11-23):
 *   - "ended": its job was cancelled or failed under it. Claimed (if it was
 *     recorded), deleted, and the claim given back (`reapRecordedObjects`).
 *   - "unrecorded": its record did not land. Deleted only if, under the row
 *     lock, the key is not recorded (`discard_unrecorded_job_object`): a key
 *     ANOTHER store of the job recorded is never deleted, and while this
 *     delete runs no store records it (one that began before the delete
 *     finished records nothing either: its upload may be what was deleted).
 * A key outside the job's own family is never touched. Never throws.
 */
export async function discardJustStored(jobId: string, key: string, why: "ended" | "unrecorded"): Promise<void> {
  if (!isOwnedObjectKey(jobId, key)) {
    console.warn(`[job-server-output] not discarding ${key}: not in job ${jobId}'s own key family`)
    return
  }
  try {
    if (why === "ended") {
      await reapRecordedObjects([{ jobId, key }], "job-output", { deleteUnclaimed: true })
      return
    }
    let begun: { data: unknown; error: { message?: string } | null } = { data: null, error: { message: "not asked" } }
    for (let attempt = 0; attempt < RECORD_TRIES && begun.error; attempt++) {
      begun = await supabase.rpc(DISCARD_FN, { p_job_id: jobId, p_key: key, p_phase: "begin" })
        .then((r) => r, (err: unknown) => ({ data: null, error: { message: String(err) } }))
    }
    const { data, error } = begun
    if (error) {
      // Whether another store recorded it cannot be told now: it goes to the
      // storage-delete retry pass (decided 2026-11-23), which deletes it later
      // unless storage holds a newer object at the key by then.
      console.warn(`[job-server-output] could not begin discarding ${key} of job ${jobId}; left to the delete retry pass:`, error.message)
      await leaveToDeleteRetry(jobId, key)
      return
    }
    if ((data as { discard?: unknown } | null)?.discard !== true) return
    const { deleteKeysRecordingFailures } = await import("./storage-delete.js")
    await deleteKeysRecordingFailures([key], "job-output", { jobIdOf: () => jobId })
    const done = await supabase.rpc(DISCARD_FN, { p_job_id: jobId, p_key: key, p_phase: "done" })
    if (done.error) console.warn(`[job-server-output] discard of ${key} on job ${jobId} done, but not marked so:`, done.error.message)
  } catch (err) {
    console.error(`[job-server-output] could not delete ${key} of job ${jobId}:`, err)
  }
}

/** A job's `server_output`, read with the service role (never throws: empty when it cannot be read). */
export async function readServerOutput(jobId: string): Promise<{ userId?: string; serverOutput: ServerOutput }> {
  try {
    const { data } = await withServerOutput("user_id", (cols) =>
      // trash-read: a server-side store record of the job's own objects, read by its deleters and the failure funnel — never answered to a user
      supabase.from("jobs").select(cols).eq("id", jobId).maybeSingle())
    const row = data as { user_id?: string | null; server_output?: unknown } | null
    return { ...(row?.user_id ? { userId: row.user_id } : {}), serverOutput: serverOutputOf(row?.server_output) }
  } catch {
    return { serverOutput: {} }
  }
}

/**
 * A job that FAILED after a video store kept objects beside its playable copy:
 * claim every recorded key, delete it, and give back what the claim answered
 * (`reapRecordedObjects`). Never throws.
 */
export async function discardStoredObjectsOfFailedJob(
  jobId: string,
  /** The failed row's `server_output`, as the failure CAS returned it (the keys to claim). */
  row: { server_output?: unknown },
): Promise<void> {
  const keys = Object.keys(serverOutputOf(row.server_output).stored ?? {})
  if (keys.length > 0) await reapRecordedObjects(keys.map((key) => ({ jobId, key })))
}

/**
 * A job whose completion did not land (its row was cancelled or failed while
 * a worker or finalizer stored its result): what its video stores recorded is
 * claimed, deleted and given back, as for a failed job. Live and completed
 * rows are left alone. Never throws.
 */
export async function discardStoredObjectsIfJobEnded(jobId: string): Promise<void> {
  try {
    const { data } = await withServerOutput("status", (cols) =>
      // trash-read: the job's own store record, read by the worker that stored it — never answered to a user
      supabase.from("jobs").select(cols).eq("id", jobId).maybeSingle())
    const row = data as { status?: unknown; server_output?: unknown } | null
    if (!row || (row.status !== "cancelled" && row.status !== "failed") || !row.server_output) return
    await discardStoredObjectsOfFailedJob(jobId, row)
  } catch (err) {
    console.error(`[job-server-output] discarding ended job ${jobId}'s stored objects failed:`, err)
  }
}

/**
 * After a completion landed (decided 2026-11-23): every object the job's
 * record holds that the completed output does not name — a master an earlier
 * attempt recorded when the attempt that completed kept none, an object whose
 * record landed although its store could not tell — is claimed, deleted and
 * given back. Done here, once the single completion has landed, never in a
 * store: a store cannot tell an earlier attempt's object from a concurrent
 * attempt's. The raw clip `rawExtensionUrl` names stays (the chain reads it).
 * Never throws.
 */
export async function pruneUnnamedStoredObjects(jobId: string): Promise<boolean> {
  try {
    const { data, error } = await withServerOutput("status, output_data", (cols) =>
      // trash-read: the completing worker's own job record — never answered to a user
      supabase.from("jobs").select(cols).eq("id", jobId).maybeSingle())
    if (error) return false
    const row = data as { status?: unknown; output_data?: unknown; server_output?: unknown } | null
    if (!row || row.status !== "completed") return false
    const serverOutput = serverOutputOf(row.server_output)
    const stored = Object.keys(serverOutput.stored ?? {})
    const named = JSON.stringify(row.output_data ?? null) + (serverOutput.rawExtensionUrl ?? "")
    const unnamed = stored.filter((key) => !named.includes(key))
    if (unnamed.length > 0) {
      const reap = await reapRecordedObjects(unnamed.map((key) => ({ jobId, key })))
      // A claim that did not run keeps the mark: the sweep tries again.
      if (reap.failedJobIds.size > 0) return false
      // A key kept only because it is held as evidence keeps the mark too
      // (decided 2026-11-24): a later sweep weighs the job again once the hold
      // lifts. (A deployment that deletes nothing keeps every key for good, so
      // there the job is marked as before.)
      if (reap.keptKeys.size > 0) {
        const { storageDeletesSkipped } = await import("./storage-deletes-setting.js")
        if (!storageDeletesSkipped()) return true
      }
    }
    // Nothing to mark: nothing was ever recorded on it.
    if ((row.server_output as { unpruned?: unknown } | null)?.unpruned !== true) return true
    // Weighed and done: the ended-jobs sweep stops retrying this row
    // (`mark_job_pruned`, migration 695).
    const { error: markError } = await supabase.rpc(MARK_PRUNED_FN, { p_job_id: jobId })
    if (markError) {
      console.warn(`[job-server-output] job ${jobId} pruned, but not marked so (the sweep will weigh it again):`, markError.message)
    }
    return !markError
  } catch (err) {
    console.error(`[job-server-output] pruning job ${jobId}'s unnamed stored objects failed (the sweep will try again):`, err)
    return false
  }
}

/**
 * Hand `key` to the storage-delete retry pass (`storage_delete_retries`,
 * lib/storage-delete-retries.ts): an object a store uploaded that no record
 * may ever name, and that this path could not delete itself. The pass deletes
 * it later, unless storage by then holds a NEWER object at the key (a later
 * attempt's), which it leaves. Never throws.
 */
async function leaveToDeleteRetry(jobId: string, key: string): Promise<void> {
  if (!isOwnedObjectKey(jobId, key)) return
  try {
    const { recordFailedDeletes, keyFailures } = await import("./storage-delete.js")
    await recordFailedDeletes(keyFailures([key], "job-output", { jobIdOf: () => jobId }, new Date()))
  } catch (err) {
    console.error(`[job-server-output] could not hand ${key} of job ${jobId} to the delete retry pass:`, err)
  }
}

/**
 * A store whose record could not be told (`unknown`): its object is discarded
 * the way an unrecorded one is (`discardJustStored`), which never deletes one
 * a record names and leaves it to the delete retry pass when the database
 * cannot be asked (decided 2026-11-23). Never throws.
 */
export async function discardIfNeverRecorded(jobId: string, key: string): Promise<void> {
  await discardJustStored(jobId, key, "unrecorded")
}

/** How many rows one page of a sweep lookup answers. */
const ENDED_SWEEP_LIMIT = 200
/** How many pages of each lookup one sweep run reads at most. */
const SWEEP_PAGES_PER_RUN = 5
const ENDED_LOOKUP_FN = "ended_jobs_with_stored_objects"
const UNPRUNED_LOOKUP_FN = "completed_jobs_left_unpruned"

/**
 * Where each lookup's next page starts, in this process (decided 2026-11-24):
 * the last id read. A run goes on from there, and a page that comes back
 * short (the end of the rows) sends the next one back to the start. So rows
 * the sweep cannot clear yet (a held key, a deployment that deletes nothing)
 * never keep it from the rows behind them.
 */
const sweepCursor: { ended?: string; unpruned?: string } = {}

/** For tests: start both lookups from the beginning again. */
export function _resetSweepCursorForTests(): void {
  delete sweepCursor.ended
  delete sweepCursor.unpruned
}

/**
 * One page of a sweep lookup (`ended_jobs_with_stored_objects` /
 * `completed_jobs_left_unpruned`, migration 695): each states its partial
 * index's condition literally and reads it in id order, so the planner reads
 * the index even from a cached plan. Moves the cursor; throws on a failed call.
 */
async function sweepPage<R extends { id: string }>(fn: string, cursor: "ended" | "unpruned", limit: number): Promise<R[]> {
  const { data, error } = await supabase.rpc(fn, { p_after_id: sweepCursor[cursor] ?? null, p_limit: limit })
  if (error) throw new Error(`${fn} failed: ${error.message ?? "unknown error"}`)
  const rows = ((data ?? []) as Array<Partial<R>>).filter((r): r is R => typeof r.id === "string")
  if (rows.length < limit) delete sweepCursor[cursor]
  else sweepCursor[cursor] = rows[rows.length - 1]!.id
  return rows
}

/**
 * The cleanup cron's sweep (decided 2026-11-23): cancelled or failed jobs whose
 * record still holds objects — a cancel that no worker was alive to act on (a
 * worker that died mid-encode), a discard that failed — are reaped
 * (`reapRecordedObjects`), and completed jobs whose prune did not finish are
 * weighed again. Each is read a page of `limit` at a time, at most
 * `SWEEP_PAGES_PER_RUN` pages a run, from where the last page stopped
 * (`sweepCursor`). Never throws.
 */
export async function sweepEndedJobsStoredObjects(limit = ENDED_SWEEP_LIMIT): Promise<{ jobs: number; refunded: number; failed: number }> {
  let jobs = 0
  let refunded = 0
  let failed = 0
  try {
    for (let page = 0; page < SWEEP_PAGES_PER_RUN; page++) {
      // trash-read: the platform's sweep of ended jobs' own store records — never answered to a user
      const rows = await sweepPage<{ id: string; stored?: unknown }>(ENDED_LOOKUP_FN, "ended", limit)
      const entries = rows.flatMap((r) => Object.keys(serverOutputOf({ stored: r.stored }).stored ?? {}).map((key) => ({ jobId: r.id, key })))
      if (entries.length > 0) {
        const reap = await reapRecordedObjects(entries, "retention")
        jobs += rows.length
        refunded += reap.refunded
        failed += reap.failedJobIds.size
      }
      if (sweepCursor.ended === undefined) break
    }
  } catch (err) {
    console.error("[job-server-output] the ended-jobs stored-objects sweep failed:", err)
    failed++
  }
  // Completed jobs whose completion's prune did not finish (decided
  // 2026-11-23): weighed again, so a paid user's unnamed original is never
  // kept and charged for good.
  try {
    for (let page = 0; page < SWEEP_PAGES_PER_RUN; page++) {
      // trash-read: the platform's sweep of completed jobs' own store records — never answered to a user
      const rows = await sweepPage<{ id: string }>(UNPRUNED_LOOKUP_FN, "unpruned", limit)
      for (const r of rows) {
        jobs++
        if (!(await pruneUnnamedStoredObjects(r.id))) failed++
      }
      if (sweepCursor.unpruned === undefined) break
    }
  } catch (err) {
    console.error("[job-server-output] the completed-jobs prune sweep failed:", err)
    failed++
  }
  return { jobs, refunded, failed }
}

/**
 * Claim each of `recorded` whose key is in `keys` off its job's record, delete
 * it and give back what the claim answered (`reapRecordedObjects`): a sweep
 * or an expunge about to delete those objects. Returns the jobs whose claim
 * did not run (nothing of theirs deleted) and the keys deleted.
 */
export async function refundClaimedRecordedObjects(
  recorded: ReadonlyArray<{ readonly key: string; readonly jobId: string }>,
  keys: ReadonlySet<string>,
  source: "retention" | "admin-expunge" = "retention",
): Promise<RecordedReap> {
  return reapRecordedObjects(recorded.filter((r) => keys.has(r.key)), source)
}

/**
 * Whether job `jobId`'s attempt now running is its last (decided 2026-11-22):
 * the worker's own answer where a job context carries it (`isFinalJobAttempt`
 * of the BullMQ attempt); elsewhere — a reconcile or webhook delivery, which
 * the reconcile sweep retries — when the job's next reconcile bump would
 * exhaust it (`reconcile_attempts + 1 >= MAX_ATTEMPTS`). A failed read is not
 * the last attempt.
 */
export async function isLastAttempt(jobId: string, fromContext: boolean | undefined): Promise<boolean> {
  if (fromContext !== undefined) return fromContext
  try {
    const [{ MAX_ATTEMPTS }, { data }] = await Promise.all([
      import("./reconcile/types.js"),
      // trash-read: the store asking how many tries its own job has left — never answered to a user
      supabase.from("jobs").select("reconcile_attempts").eq("id", jobId).maybeSingle(),
    ])
    const attempts = Number((data as { reconcile_attempts?: unknown } | null)?.reconcile_attempts ?? 0) || 0
    return attempts + 1 >= MAX_ATTEMPTS
  } catch {
    return false
  }
}

/**
 * Whether a completed job's output names `key` (decided 2026-11-23): what a
 * store answered "delivered" does with the object it just uploaded. "named":
 * the completed output (or the record) names that very key, so the object IS
 * the delivered one and stays. "unnamed": nothing names it (a job completed by
 * an attempt that kept no original, or a row that is gone), so it is deleted.
 * A row that cannot be read after a few tries reads as "named": the object
 * is left, since it may be the delivered one.
 */
export async function deliveredKeepsKey(jobId: string, key: string): Promise<"named" | "unnamed"> {
  // Asked a few times: a store that cannot tell keeps the object (it may be
  // the delivered original, overwritten in place, decided 2026-11-23).
  for (let attempt = 0; attempt < RECORD_TRIES; attempt++) {
    try {
      const { data, error } = await withServerOutput("status, output_data", (cols) =>
        // trash-read: the store asking whether the completed job it stored for names its object — never answered to a user
        supabase.from("jobs").select(cols).eq("id", jobId).maybeSingle())
      if (error) continue
      const row = data as { output_data?: unknown; server_output?: unknown } | null
      if (!row) return "unnamed"
      const serverOutput = serverOutputOf(row.server_output)
      if (key in (serverOutput.stored ?? {}) || (serverOutput.rawExtensionUrl ?? "").includes(key)) return "named"
      return JSON.stringify(row.output_data ?? null).includes(key) ? "named" : "unnamed"
    } catch {
      // Asked again.
    }
  }
  return "named"
}

/** Delete an object a store uploaded for a job that was already delivered without it (`deliveredKeepsKey` "unnamed"). Never recorded, so nothing to claim or give back. Never throws. */
export async function deleteUnnamedDeliveredObject(jobId: string, key: string): Promise<void> {
  if (!isOwnedObjectKey(jobId, key)) return
  try {
    const { deleteKeysRecordingFailures } = await import("./storage-delete.js")
    await deleteKeysRecordingFailures([key], "job-output", { jobIdOf: () => jobId })
  } catch (err) {
    console.error(`[job-server-output] could not delete ${key} of delivered job ${jobId}:`, err)
  }
}

/**
 * Clear the job's `rawExtensionUrl` (decided 2026-11-23): a watermarked
 * Extend attempt does this before it copies its own raw clip, so the record
 * never names an earlier attempt's clip — a completed job's raw clip is the
 * completing attempt's, or none (the next extension then cuts from the
 * deliverable). A patch-only call of `record_job_stored_object` (no key),
 * live jobs only. Returns whether it landed; never throws.
 */
export async function clearRawExtensionUrl(jobId: string): Promise<boolean> {
  for (let attempt = 0; attempt < RECORD_TRIES; attempt++) {
    try {
      const { error } = await supabase.rpc(RECORD_FN, {
        p_job_id: jobId,
        p_key: null,
        p_bytes: 0,
        p_charge: false,
        p_patch: { rawExtensionUrl: null },
      })
      if (!error) return true
      console.warn(`[job-server-output] could not clear job ${jobId}'s raw clip reference:`, error.message)
    } catch (err) {
      console.warn(`[job-server-output] could not clear job ${jobId}'s raw clip reference:`, err)
    }
  }
  return false
}

/** Jobs this process recorded an object for (`recordStoredObjectAndCharge`): their completion is always pruned. Bounded. */
const recordedHere = new Set<string>()
const RECORDED_HERE_MAX = 5000

/** Note that this process recorded an object on `jobId`. */
function noteRecordedHere(jobId: string): void {
  if (recordedHere.size >= RECORDED_HERE_MAX) recordedHere.clear()
  recordedHere.add(jobId)
}

/**
 * Whether a completion needs `pruneUnnamedStoredObjects`' read (decided
 * 2026-11-23): only a job whose completed output names a stored video
 * (`videoUrl`, `originalVideoUrl`) — the only results a video store records
 * beside — or one this process recorded for. Every other completion (an image,
 * an audio file, text) costs no read at all.
 */
export function completionMayHoldRecordedObjects(jobId: string, outputData: unknown): boolean {
  if (recordedHere.has(jobId)) return true
  if (!outputData || typeof outputData !== "object") return false
  const o = outputData as Record<string, unknown>
  return typeof o.videoUrl === "string" || typeof o.originalVideoUrl === "string"
}
