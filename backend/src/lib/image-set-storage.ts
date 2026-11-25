/**
 * Storage accounting for a SET's pictures (lib/image-output-store.ts). A set
 * stores one picture at a time and may outlive its finalize claim, so another
 * finalize of the same job can store the same keys. Its writes are charged by
 * what each key holds, read from storage; a read that fails is never taken as
 * "no object": it is retried, and when it still fails the store step fails
 * (retryable, post-processing) instead of guessing, so nothing is charged or
 * given back on a guess. This is the owner's storage usage only, never credits.
 * Every other job keeps its own accounting (`uploadBufferToR2`'s tracking).
 */
import { headR2Object, mediaObjectKey } from "./storage.js"
import type { DeleteSource } from "./storage-delete.js"
import { variantJobId } from "@nodaro/shared/workflow"
import { IMAGE_OUTPUT_FORMAT_EXT } from "@nodaro/shared/models"
import { KLING_IMAGE_4_SET_MAX } from "@nodaro/shared/model-catalog"
import { isOwnedObjectKey } from "./job-policy-outputs.js"
import { PostProcessingError } from "./post-processing-error.js"
import { updateStorageUsage } from "../utils/file-validation.js"

/** What a key holds, read from storage: nothing, or an object of `size` bytes. */
export interface KnownObjectState {
  readonly exists: boolean
  readonly size: number
  readonly etag?: string
  readonly metadata?: Readonly<Record<string, string>>
}

/** A set's store step whose storage state could not be read: retryable, nothing charged on a guess. */
export class StorageStateUnknownError extends PostProcessingError {
  readonly storageStateUnknown = true
}

export function isStorageStateUnknown(err: unknown): boolean {
  return (err as { storageStateUnknown?: unknown } | null)?.storageStateUnknown === true
}

/** How many times a read is tried before the step fails. */
const READ_TRIES = 3
const READ_PAUSE_MS = 200

/**
 * What `key` holds, read from storage (tried a few times). Throws
 * `StorageStateUnknownError` when no read succeeds, or when an object is
 * there but its size or ETag is not said: never answers "absent" on a guess.
 */
export async function knownObjectState(key: string): Promise<KnownObjectState> {
  let lastError: unknown
  for (let i = 0; i < READ_TRIES; i++) {
    try {
      const head = await headR2Object(key)
      if (!head.exists) return { exists: false, size: 0 }
      if (typeof head.sizeBytes === "number" && head.etag) {
        return { exists: true, size: head.sizeBytes, etag: head.etag, ...(head.metadata ? { metadata: head.metadata } : {}) }
      }
      lastError = new Error("the object's size or ETag was not said")
    } catch (err) {
      lastError = err
    }
    if (i < READ_TRIES - 1) await new Promise((r) => setTimeout(r, READ_PAUSE_MS))
  }
  throw new StorageStateUnknownError(`storage state of ${key} could not be read`, { cause: lastError })
}

/** Give `userId`'s storage the change in bytes a set's write made (either sign); best effort. */
export function chargeSetStorage(userId: string | undefined, delta: number): void {
  if (!userId || delta === 0) return
  updateStorageUsage(userId, delta).catch((err) => console.error("[image-set-storage] Failed to track usage:", err))
}

/** Where a set's clean-up may run: on a row that ended without a completion. */
export const ENDED_SET_STATUSES: readonly string[] = ["failed", "cancelled"]

let missingClaimLogged = false

/** Tests only: forget that the missing claim function was already logged. */
export function resetMissingClaimLogForTests(): void {
  missingClaimLogged = false
}

/** The answer of a claim: this caller won (`claimedAt`), another clean-up holds it or the row is not in the asked states (`lost`), or the claim could not be asked (`error`). */
type ClaimAnswer = { readonly won: string } | { readonly lost: true } | { readonly error: true }

/**
 * Ask for the one clean-up of `jobId`'s set (`claim_job_set_discard`, the
 * migration that adds it lands before this code): won, lost, or an error. The
 * function reaches the shared database only when that migration is released,
 * and staging runs code before production does: a missing function is an
 * error like any other (logged once), never a win, so nothing is ever given
 * back on a guess.
 */
async function claimSetDiscard(jobId: string, statuses: readonly string[]): Promise<ClaimAnswer> {
  try {
    const { supabase } = await import("./supabase.js")
    const { data, error } = await supabase.rpc("claim_job_set_discard", { p_job_id: jobId, p_statuses: [...statuses] })
    if (error) {
      const missing = error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? "")
      if (!missing || !missingClaimLogged) {
        console.warn(`[image-set-storage] job ${jobId}: its set's clean-up could not be claimed (${missing ? "the claim is not on this database yet" : error.message}): its pictures are deleted without giving storage back`)
        if (missing) missingClaimLogged = true
      }
      return { error: true }
    }
    return typeof data === "string" && data.length > 0 ? { won: data } : { lost: true }
  } catch (err) {
    console.warn(`[image-set-storage] job ${jobId}: its set's clean-up could not be claimed (${String(err)}): its pictures are deleted without giving storage back`)
    return { error: true }
  }
}

/** Mark the clean-up claimed with `claimedAt` done. True only when the row still carried that claim (not taken over). */
async function finishSetDiscard(jobId: string, claimedAt: string): Promise<boolean> {
  try {
    const { supabase } = await import("./supabase.js")
    const { data, error } = await supabase.rpc("finish_job_set_discard", { p_job_id: jobId, p_claimed_at: claimedAt })
    if (error) {
      console.warn(`[image-set-storage] job ${jobId}: its set's clean-up could not be marked done; nothing is given back: ${error.message}`)
      return false
    }
    return data === true
  } catch (err) {
    console.warn(`[image-set-storage] job ${jobId}: its set's clean-up could not be marked done; nothing is given back: ${String(err)}`)
    return false
  }
}

/** Whether `jobId`'s row ended failed or cancelled: from the status the caller read, else one narrow read. False when it cannot be read. */
async function rowHasEnded(jobId: string, known: string | undefined): Promise<boolean> {
  if (known !== undefined) return ENDED_SET_STATUSES.includes(known)
  try {
    const { supabase } = await import("./supabase.js")
    // trash-read: the job's own row, read to decide whether its clean-up may wait for another
    const { data, error } = await supabase.from("jobs").select("status").eq("id", jobId).single()
    if (error) return false
    return ENDED_SET_STATUSES.includes(String((data as { status?: unknown } | null)?.status))
  } catch {
    return false
  }
}

/** Every key a set of `count` pictures can have written: each picture under every image extension, and its still. */
export function setPictureKeys(jobId: string, count: number): string[] {
  const exts = [...new Set(Object.values(IMAGE_OUTPUT_FORMAT_EXT))]
  const keys: string[] = [mediaObjectKey(`${jobId}-still`, "image", "png")]
  for (let i = 0; i < count; i++) for (const ext of exts) keys.push(mediaObjectKey(variantJobId(jobId, i), "image", ext))
  return keys
}

/** How long one clean-up may run: well under the claim's 15-minute stale window, so it is never taken over while it runs. */
export const SET_DISCARD_DEADLINE = { ms: 5 * 60_000 }
/** How a clean-up on an ended row waits for a running one to finish before it tries again: a few short waits. */
export const SET_DISCARD_RETRY = { tries: 3, waitMs: 2_000 }

/**
 * Clean up a SET job's pictures, once. The clean-up is claimed on the job row
 * first (`claim_job_set_discard`):
 *   - the winner reads each key, deletes (through the delete funnel, which
 *     keeps what storage keeps, skips what this deployment skips, and records
 *     a failed delete for the retry pass), marks its clean-up done, and gives
 *     back the bytes of what it deleted only when that mark lands (the claim
 *     was still its own: a clean-up taken over after the stale window gives
 *     nothing back). It stops at `SET_DISCARD_DEADLINE`, leaving the rest
 *     to the retry pass and its claim for a later take-over;
 *   - on an ended row the winner takes every picture the set can have written,
 *     whichever path asked; on a live or completed one only the keys named
 *     (the delivered pictures are never among them);
 *   - a loser on an ended row waits for the running clean-up and tries again
 *     (`SET_DISCARD_RETRY`); still not the winner, it leaves its keys to the
 *     retry pass. A loser on any other row does nothing;
 *   - when the claim cannot be asked at all (an error, the function not on
 *     this database yet), the keys are deleted with nothing given back, so a
 *     picture never stays at its public key and nothing is given back twice.
 * `statuses`: the row states in which the caller may clean up. Returns how
 * many keys this call deleted. Never throws.
 */
export async function discardSetKeys(
  jobId: string,
  userId: string | undefined,
  keys: readonly string[],
  opts: {
    readonly statuses?: readonly string[]
    readonly setCount?: number
    readonly source?: DeleteSource
    /** The row's status, when the caller has just read it (no second read). */
    readonly rowStatus?: string
  } = {},
): Promise<number> {
  const statuses = opts.statuses ?? ENDED_SET_STATUSES
  const ended = statuses.every((s) => ENDED_SET_STATUSES.includes(s))
  const all = ended ? [...keys, ...setPictureKeys(jobId, opts.setCount ?? KLING_IMAGE_4_SET_MAX)] : [...keys]
  // Only this job's own files (its key family): a key from anywhere else is never deleted.
  const unique = [...new Set(all)].filter((key) => isOwnedObjectKey(jobId, key))
  const source = opts.source ?? "job-output"
  try {
    const { deleteKeysRecordingFailures, recordFailedDeletes, keyFailures } = await import("./storage-delete.js")
    const leaveToRetry = (left: readonly string[]) =>
      left.length > 0 ? recordFailedDeletes(keyFailures(left, source, { jobIdOf: () => jobId }, new Date())).catch(() => undefined) : undefined
    let answer = await claimSetDiscard(jobId, statuses)
    // An empty answer is either "another clean-up holds it" or "the row is not
    // in the asked states". Only on a row that has truly ended does a loser
    // wait, try again and leave its keys to the retry pass: a live or
    // completed row's keys (its delivered pictures among them) never go there.
    if (ended && "lost" in answer && !(await rowHasEnded(jobId, opts.rowStatus))) return 0
    for (let t = 0; ended && "lost" in answer && t < SET_DISCARD_RETRY.tries; t++) {
      await new Promise((r) => setTimeout(r, SET_DISCARD_RETRY.waitMs))
      answer = await claimSetDiscard(jobId, statuses)
    }
    if ("error" in answer) {
      // Not asked: deleted, nothing given back.
      if (unique.length === 0) return 0
      const { deleted } = await deleteKeysRecordingFailures(unique, source, { jobIdOf: () => jobId })
      return deleted
    }
    if ("lost" in answer) {
      // Another clean-up holds it. On an ended row it may have read a key this
      // caller then stored: the retry pass deletes what is left.
      if (ended) await leaveToRetry(unique)
      return 0
    }
    const deadline = Date.now() + SET_DISCARD_DEADLINE.ms
    const sizes = new Map<string, number>()
    const unread: string[] = []
    let stopped = false
    for (const [i, key] of unique.entries()) {
      if (Date.now() > deadline) {
        await leaveToRetry(unique.slice(i))
        stopped = true
        break
      }
      try {
        const state = await knownObjectState(key)
        if (state.exists) sizes.set(key, state.size)
      } catch {
        unread.push(key)
      }
    }
    // A key whose state could not be read is kept, and left to the retry pass.
    await leaveToRetry(unread)
    const present = [...sizes.keys()]
    let removed = 0
    let freed = 0
    if (present.length > 0) {
      const result = await deleteKeysRecordingFailures(present, source, { jobIdOf: () => jobId })
      const kept = new Set([...(result.notDeleted ?? []), ...(result.kept ?? [])])
      const deleted = present.filter((key) => !kept.has(key))
      removed = deleted.length
      freed = deleted.reduce((sum, key) => sum + (sizes.get(key) ?? 0), 0)
    }
    // Past the deadline the claim is left unfinished (a later clean-up takes
    // it over) and nothing is given back.
    if (stopped || Date.now() > deadline) return removed
    // Given back only when the claim was still this caller's.
    if (!(await finishSetDiscard(jobId, answer.won))) return removed
    if (userId && freed > 0) {
      await updateStorageUsage(userId, -freed).catch((err) => console.error(`[image-set-storage] job ${jobId}: giving back storage failed:`, err))
    }
    return removed
  } catch (err) {
    console.warn(`[image-set-storage] job ${jobId}: its set's pictures could not be cleaned up: ${String(err)}`)
    return 0
  }
}

/**
 * The owner and set size of `jobId` when it is a SET job, else undefined.
 * Every clean-up of a set's objects (the result gate, a held set's rejection,
 * the finalize's fence, the failure funnel, the cancels) goes through
 * `discardSetKeys` on a set. Throws when the row cannot be read: the caller
 * then deletes the objects with nothing given back when they may be a set's.
 */
export async function setJobOwner(jobId: string): Promise<{ userId: string | undefined; setCount: number; status?: string } | undefined> {
  const { supabase } = await import("./supabase.js")
  // trash-read: the job's own row, read to choose how its files are cleaned up
  const { data, error } = await supabase
    .from("jobs")
    .select("user_id, status, setHoldCreditId:input_data->>setHoldCreditId")
    .eq("id", jobId)
    .single()
  // No such row: not a set (nothing of it to clean up as one).
  if (error && (error as { code?: string }).code !== "PGRST116") throw error
  const row = (error ? null : data) as { user_id?: string | null; status?: string | null; setHoldCreditId?: string | null } | null
  if (!row || typeof row.setHoldCreditId !== "string" || row.setHoldCreditId.length === 0) return undefined
  return { userId: row.user_id ?? undefined, setCount: setStoreLimit(row.setHoldCreditId), ...(typeof row.status === "string" ? { status: row.status } : {}) }
}

/**
 * After a SET job ended failed or cancelled (`markJobFailedDetailed` runs it
 * for every failure; each cancel writer runs it after its flip): delete every
 * picture its stores may have written and give back what each held, through
 * the one claimed clean-up (`discardSetKeys`). Only on a row that ended
 * without a completion, which no finalize can complete any more, so a key a
 * completed row names is never deleted. Every other job: nothing. Best
 * effort; never throws.
 */
export async function discardEndedSetImages(jobId: string): Promise<void> {
  try {
    const { supabase } = await import("./supabase.js")
    // trash-read: the job's own row, read to decide whether its set's files may go
    // Only the fields it needs: the row's state, its owner, and the set's hold.
    const { data, error } = await supabase
      .from("jobs")
      .select("status, user_id, setHoldCreditId:input_data->>setHoldCreditId")
      .eq("id", jobId)
      .maybeSingle()
    const row = data as { status?: string; user_id?: string | null; setHoldCreditId?: string | null } | null
    if (error || !row || typeof row.setHoldCreditId !== "string" || row.setHoldCreditId.length === 0) return
    if (row.status !== "failed" && row.status !== "cancelled") return
    await discardSetKeys(jobId, row.user_id ?? undefined, [], { setCount: setStoreLimit(row.setHoldCreditId), rowStatus: row.status })
  } catch (err) {
    console.warn(`[image-set-storage] job ${jobId}: an ended set's pictures could not be discarded: ${String(err)}`)
  }
}

/**
 * How many pictures a set stores: the count its hold was taken for (the
 * `:x<n>` of its `setHoldCreditId`, the one source the hold and the charge
 * read), never more, whatever the provider returned; the largest set when the
 * hold does not say. The store and the clean-up both read it, so nothing
 * unasked is ever stored, charged or left behind.
 */
export function setStoreLimit(setHoldCreditId: unknown): number {
  const asked = typeof setHoldCreditId === "string" ? /:x(\d+)$/.exec(setHoldCreditId)?.[1] : undefined
  const n = asked === undefined ? NaN : Number(asked)
  return Number.isInteger(n) && n > 0 ? Math.min(n, KLING_IMAGE_4_SET_MAX) : KLING_IMAGE_4_SET_MAX
}

/**
 * Whether `keys` may be a set's pictures when the job's row cannot be read:
 * any key at a picture's place (`images/<jobId>[-v<n>].<ext>`, or its still).
 * Only by the keys, since the row is what would say; a job whose keys are all
 * elsewhere (videos, audio, other files) is not a set.
 */
export function mayBeSetPictures(jobId: string, keys: readonly string[]): boolean {
  // `images/<jobId>[-v<n>].<ext>` or `images/<jobId>-still.png` (mediaObjectKey's layout).
  const id = jobId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const exts = [...new Set(Object.values(IMAGE_OUTPUT_FORMAT_EXT))].join("|")
  const place = new RegExp(`^images/${id}(?:-v\\d+)?\\.(?:${exts})$|^images/${id}-still\\.png$`)
  return keys.some((key) => place.test(key))
}
