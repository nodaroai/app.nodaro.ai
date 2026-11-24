import { supabase } from "./supabase.js"
import { config } from "./config.js"
import { deleteKeyRecordingFailure } from "./storage-delete.js"
import { heldAmong } from "./legal-hold.js"
import { JOB_OUTPUT_URL_PATHS } from "./job-output-urls.js"
import { isCanonicalObjectKey, judgeKeys, mayDeleteObject } from "./key-ownership.js"
import type { AssetCompanion } from "./asset-companions.js"

/**
 * Release a deleted row's companions. `objectDeleted` says whether the row's
 * own object went: a companion goes with its result, never without it.
 * Returns the bytes to refund: those of each companion that is the user's
 * alone and not held (whether or not a referrer kept its bytes — the
 * same terms the row's own size is refunded on). Never throws: a failed lookup
 * keeps the object and refunds nothing for it.
 */
export async function releaseCompanions(opts: {
  userId: string
  companions: readonly AssetCompanion[]
  objectDeleted: boolean
  /**
   * The row's own object is provably this user's (`judgeAssetRowDelete`'s
   * `owned`). A companion is in that object's key family (`companionsOf`), so
   * it is the same job's file and this proof covers it too — which matters
   * once the job itself is gone: then no maker row is left to prove the
   * companion on its own, and the row's object is exactly what the Library
   * delete removes. Another user's claim, a job cover or the hold still keep it.
   */
  rowOwned: boolean
  blockOnOwnJobReferrers: boolean
}): Promise<{ deleted: string[]; refundBytes: number }> {
  const { userId, companions, objectDeleted, rowOwned, blockOnOwnJobReferrers } = opts
  const deleted: string[] = []
  let refundBytes = 0
  if (companions.length === 0) return { deleted, refundBytes }

  let mine: Set<string>
  let held: Set<string>
  try {
    const keys = companions.map((c) => c.key)
    held = await heldAmong(keys)
    const verdicts = await judgeKeys(userId, keys.filter((k) => !held.has(k)))
    mine = new Set(
      [...verdicts]
        .filter(([key, v]) => mayDeleteObject({ ...v, owned: v.owned || (rowOwned && isCanonicalObjectKey(key)) }))
        .map(([key]) => key),
    )
  } catch (err) {
    console.warn("[asset-companions] Keeping companion object(s): ownership lookup failed:", err)
    return { deleted, refundBytes }
  }

  for (const { key, sizeBytes } of companions) {
    if (held.has(key) || !mine.has(key)) {
      console.log(`[asset-companions] Keeping companion ${key}: ${held.has(key) ? "on legal hold" : "not provably this user's alone"}`)
      continue
    }
    refundBytes += sizeBytes
    if (!objectDeleted) continue
    try {
      if (await companionReferenced(userId, key, blockOnOwnJobReferrers)) {
        console.log(`[asset-companions] Keeping companion ${key}: another row still names it`)
        continue
      }
      await deleteKeyRecordingFailure(key, "asset")
      deleted.push(key)
    } catch (err) {
      console.error(`[asset-companions] Companion delete failed for ${key} (continuing):`, err)
    }
  }
  return { deleted, refundBytes }
}

/** Does another Library row, or (when asked) one of the user's job outputs, still name this object? Errors answer yes. */
async function companionReferenced(userId: string, key: string, checkJobs: boolean): Promise<boolean> {
  // fileless-read: a referrer count — any row naming the key keeps the object, with or without a file.
  // restricted-read: a referrer count — a restricted row naming the key keeps the object too.
  const { count, error } = await supabase
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("r2_key", key)
  if (error || (count ?? 0) > 0) return true
  if (!checkJobs) return false
  const publicUrl = config.R2_PUBLIC_URL ? `${config.R2_PUBLIC_URL}/${key}` : key
  for (const path of JOB_OUTPUT_URL_PATHS) {
    // trash-read: a referrer count — a trashed job still reads its output, so it keeps the object too.
    const { count: jobCount, error: jobError } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq(path, publicUrl)
    if (jobError || (jobCount ?? 0) > 0) return true
  }
  return false
}
