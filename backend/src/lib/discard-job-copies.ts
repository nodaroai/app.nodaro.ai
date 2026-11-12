/**
 * Files a run copied into its own job's family, discarded when the run fails
 * (independent review round of the expiry walk).
 *
 * A Seedance extend copies its raw extension to `videos/<jobId>-raw.mov` after
 * it generates (it used to copy the clip it continues from to
 * `videos/<jobId>-raw-ref.mov` too). Expiry deletes a job's files by walking its
 * output (decided 2026-10-08, round 12: "the job's output names it, so expiry
 * deletes it"), but only a COMPLETED job has an output naming them. A run
 * that fails or is cancelled after a copy would leave it in storage, counted
 * against the user's quota, for good. So the run discards its copies on the
 * way out, through the storage-delete funnel (a failed delete is recorded for
 * the retry pass), and gives their bytes back to the quota.
 *
 * Never from a job that completed: a run re-picked after its job already
 * completed writes the same keys its completed output names. Only keys in the
 * job's own family on our storage are touched, and nothing here throws — the
 * caller rethrows the run's own error.
 *
 * The same lane serves a finalize that will not complete its job
 * (lib/job-finalize-discard.ts `discardUnfinishedStores`): it decides the job is not
 * completing with its objects behind its own claim fence, then deletes them
 * through `ownedCopyKeys` + `discardOwnedKeys`.
 */
import { supabase } from "./supabase.js"
import { getR2ObjectSize, r2KeyFromOurUrl } from "./storage.js"
import { isOwnedObjectKey } from "./job-policy-outputs.js"
import { deleteKeysRecordingFailures } from "./storage-delete.js"
import { updateStorageUsage } from "../utils/file-validation.js"

/**
 * The keys of `urls` that are this job's own files on our storage (its key
 * family, `isOwnedObjectKey`), each once. A foreign url, another job's file and
 * a relayed output (the far end's key, never counted here) are left out.
 */
export function ownedCopyKeys(jobId: string, urls: ReadonlyArray<string | undefined>): string[] {
  return [
    ...new Set(
      urls.flatMap((url) => {
        const key = url ? r2KeyFromOurUrl(url) : null
        return key && isOwnedObjectKey(jobId, key) ? [key] : []
      }),
    ),
  ]
}

/**
 * Delete `keys` — this job's own files (`ownedCopyKeys`) — through the
 * storage-delete funnel, and give back to `userId`'s quota the bytes of each
 * one storage confirmed gone, sized before the delete (what its upload
 * counted). A key storage keeps (a failed delete, recorded for the retry pass;
 * a legal hold; a deployment that deletes nothing) gives nothing back. The
 * caller has decided nothing will name these files. Never throws.
 */
export async function discardOwnedKeys(jobId: string, userId: string | undefined, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    const sizes = new Map(await Promise.all(keys.map(async (key) => [key, await getR2ObjectSize(key)] as const)))
    const result = await deleteKeysRecordingFailures(keys, "job-output", { jobIdOf: () => jobId })
    const kept = new Set(result.notDeleted ?? [])
    const freed = keys.filter((key) => !kept.has(key)).reduce((sum, key) => sum + (sizes.get(key) ?? 0), 0)
    if (userId && freed > 0) await updateStorageUsage(userId, -freed)
  } catch (err) {
    console.error(`[discard-job-copies] Discarding job ${jobId}'s files failed:`, err)
  }
}

export async function discardFailedRunCopies(
  jobId: string,
  userId: string | undefined,
  urls: ReadonlyArray<string | undefined>,
): Promise<void> {
  try {
    const keys = ownedCopyKeys(jobId, urls)
    if (keys.length === 0) return

    const { data, error } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle()
    const status = (data as { status?: string } | null)?.status
    if (error || !status || status === "completed") return

    await discardOwnedKeys(jobId, userId, keys)
  } catch (err) {
    console.error(`[discard-job-copies] Discarding job ${jobId}'s copies after a failed run failed:`, err)
  }
}
