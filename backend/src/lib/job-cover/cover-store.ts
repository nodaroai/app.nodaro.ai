import { keysHeldByOtherLibraryRows, ownKeysOnly } from "../key-ownership.js"
import { previewStorageKey } from "../presets/preview-url.js"
import { copyOwnObjectToKey, getR2ObjectSize } from "../storage.js"
import { deleteKeysRecordingFailures } from "../storage-delete.js"
import { updateStorageUsage } from "../../utils/file-validation.js"
import { isOwnJobCoverKey, newJobCoverKey } from "./cover-key.js"
import { coverKeysNamedByJobs } from "./cover-job-refs.js"

/**
 * A job keeps its OWN copy of its custom cover (decided 2026-11-23), as a
 * user preset keeps its picture (lib/presets/preview-copy.ts): the picture a
 * caller names is one of their uploads or results, a file with a life of its
 * own — a library delete or a retention sweep would leave the job showing a
 * broken picture. So setting a cover copies the file, storage to storage, to
 * a key the user's covers own (lib/job-cover/cover-key.ts) and the job stores
 * THAT address.
 *
 * Every set is a NEW copy at a key no other write ever names (review round,
 * decided 2026-11-23): two jobs given the same picture, or two concurrent
 * writes to one job, never share an object, so releasing one can never take
 * another's picture away.
 *
 * The copy is released (deleted, its bytes given back to the user's quota)
 * once nothing names it: on a replaced or cleared cover, when the write that
 * made it fails or loses a race, and when the job itself is deleted or
 * expunged.
 */

/** Copy the judged source (lib/job-cover/cover-source.ts) into the user's covers; answers the address to store. Throws when the copy fails. */
export async function storeJobCover(userId: string, sourceKey: string, ext: string): Promise<string> {
  return copyOwnObjectToKey(sourceKey, newJobCoverKey(userId, sourceKey, ext), userId)
}

/** The key of one of `userId`'s covers that `url` names, else null. */
function ownCoverKeyOf(userId: string, url: string): string | null {
  const key = previewStorageKey(url)
  return key && isOwnJobCoverKey(userId, key) ? key : null
}

/**
 * The cover keys among `keys` something still names: a job's cover (any
 * user's job, in the Trash or not) or a library row (any user's — the owner's
 * own saved copy of the address included). THE one question every release
 * and every library delete of a cover key asks. Throws when it cannot be
 * asked: a caller that cannot ask must keep the object.
 */
export async function coverKeysStillReferenced(keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const [byJobs, byLibraries] = await Promise.all([coverKeysNamedByJobs(keys), keysHeldByOtherLibraryRows(keys, () => false)])
  return new Set([...byJobs, ...byLibraries])
}

/**
 * Deletes the covers among `urls` (each one of `userId`'s own) that nothing
 * names any more, and gives their bytes back to the user's quota. Best
 * effort: a failure is logged (a failed storage delete is also recorded for
 * the daily retry), never thrown — the write it follows has already happened.
 */
export async function releaseJobCovers(userId: string, urls: ReadonlyArray<string | null | undefined>): Promise<void> {
  try {
    const candidates = [...new Set(urls.flatMap((u) => (u ? [ownCoverKeyOf(userId, u)] : [])).filter((k): k is string => k !== null))]
    if (candidates.length === 0) return
    const referenced = await coverKeysStillReferenced(candidates)
    const unused = candidates.filter((k) => !referenced.has(k))
    // Only what the user provably made, and nobody else claims.
    const keys = await ownKeysOnly(userId, unused, "job cover release")
    if (keys.length === 0) return
    const sizes = await Promise.all(keys.map((k) => getR2ObjectSize(k)))
    const { failed } = await deleteKeysRecordingFailures(keys, "job-cover")
    const freed = keys.reduce((sum, k, i) => (failed.includes(k) ? sum : sum + sizes[i]!), 0)
    if (freed > 0) await updateStorageUsage(userId, -freed)
  } catch (err) {
    console.error("[job-cover] releasing covers failed:", err)
  }
}

/** One deleted or cleared job's cover: whose it was, and its address. */
export interface ReleasedJobCover {
  readonly userId: string | null
  readonly coverUrl: string | null
}

/** Release each owner's covers (lib/job-cover/cover-release.ts reads them before the delete or the clear). */
export async function releaseCoversOfJobs(rows: ReadonlyArray<ReleasedJobCover>): Promise<void> {
  const byUser = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.userId || !row.coverUrl) continue
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.coverUrl])
  }
  for (const [userId, urls] of byUser) await releaseJobCovers(userId, urls)
}
