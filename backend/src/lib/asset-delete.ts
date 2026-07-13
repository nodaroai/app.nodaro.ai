import { supabase } from "./supabase.js"
import { config } from "./config.js"
import { deleteFromR2 } from "./storage.js"
import { updateStorageUsage } from "../utils/file-validation.js"

/**
 * The platform's canonical permanent asset delete — the exact logic that
 * `DELETE /v1/library/:id?permanent=true` (routes/library.ts) shipped with,
 * extracted so `POST /v1/media/delete` (lib/media-delete.ts) can reuse it
 * instead of growing a drifting second copy.
 *
 * Lives in lib/, not the route, because routes may not import the service-role
 * client (backend/scripts/check-admin-client-import.mjs): this helper takes the
 * owner as an EXPLICIT parameter (precedent: lib/asset-records.ts), and every
 * destructive query is additionally scoped by `.eq("user_id", userId)` so a
 * caller that got the ownership check wrong still cannot delete across tenants.
 *
 * What it does, in order:
 *   1. Referrer safety — the R2 object is removed only when no OTHER assets row
 *      references the same `r2_key` (content-addressed safety: another user may
 *      have saved this output from the public gallery via save-generated).
 *      Lookup errors fail safe toward keeping data.
 *   2. Optionally (`blockOnOwnJobReferrers`) also keeps the object when one of
 *      the caller's OWN jobs' `output_data` points at it — the library page's
 *      semantics, where deleting a library row must not break the gallery /
 *      job-history entry that reads `jobs.output_data`. `POST /v1/media/delete`
 *      passes `false`: there the caller names the URL itself, so orphaning
 *      their own job entry is their deliberate choice (they deleted the export).
 *   3. Deletes the caller's assets row (scoped by user_id) and, only when a row
 *      was actually deleted (`.select("id")` returning-rows guard, so a
 *      concurrent double-delete cannot decrement twice), refunds the row's
 *      `size_bytes` from the user's tracked storage — the same way the quota
 *      was charged at upload/generation time.
 */
export interface OwnedAssetRow {
  id: string
  r2_key: string | null
  size_bytes: number | null
}

export type PermanentDeleteResult =
  | { ok: true; r2Deleted: boolean }
  | { ok: false; dbError: { message: string } }

export async function permanentlyDeleteAsset(opts: {
  userId: string
  asset: OwnedAssetRow
  blockOnOwnJobReferrers: boolean
}): Promise<PermanentDeleteResult> {
  const { userId, asset, blockOnOwnJobReferrers } = opts
  let r2Deleted = false

  try {
    if (asset.r2_key) {
      // Content-addressed safety: another row may reference the SAME R2 object,
      // so deleting it would turn that row into a permanent broken link (R2
      // objects are unrecoverable). Checked across ALL users — this is also the
      // backstop that stops a caller whose own job/asset row merely ECHOES a
      // url from destroying an object other tenants still own.
      const { count: otherAssetRefs, error: assetRefError } = await supabase
        .from("assets")
        .select("id", { count: "exact", head: true })
        .eq("r2_key", asset.r2_key)
        .neq("id", asset.id)

      // Fail safe: a query error means we can't prove there are no referrers.
      const assetRefsExist = !!assetRefError || (!!otherAssetRefs && otherAssetRefs > 0)

      // Reconstruct the public URL exactly as stored in jobs.output_data
      // (mirror of workers/shared.ts: r2Key = url.replace(R2_PUBLIC_URL + "/", "")).
      const publicUrl = config.R2_PUBLIC_URL
        ? `${config.R2_PUBLIC_URL}/${asset.r2_key}`
        : asset.r2_key

      // Check the media-URL keys the gallery/job-history extractors read,
      // one .eq() per key — NOT a hand-built .or() string. PostgREST does
      // NOT quote values inside an .or() filter, and a public URL contains
      // reserved chars (`:` `.` `,`) that corrupt the filter; passing the
      // value as an .eq() argument lets supabase-js encode it safely (same
      // pattern as suno.ts `.eq("metadata->>kie_task_id", …)`). Skipped
      // entirely when an asset referrer already keeps the object alive.
      let otherJobRefs = 0
      let jobRefError: { message: string } | null = null
      if (!assetRefsExist && blockOnOwnJobReferrers) {
        for (const key of ["imageUrl", "videoUrl", "audioUrl"] as const) {
          const { count, error } = await supabase
            .from("jobs")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq(`output_data->>${key}`, publicUrl)
          if (error) {
            jobRefError = error
            break
          }
          otherJobRefs += count ?? 0
          if (otherJobRefs > 0) break
        }
      }
      // Fail safe: a query error means we can't prove there are no
      // referrers, so treat it as if one exists and skip the R2 delete.
      const jobRefsExist = !!jobRefError || otherJobRefs > 0

      if (!assetRefsExist && !jobRefsExist) {
        await deleteFromR2(asset.r2_key)
        r2Deleted = true
      } else {
        console.log(
          `[asset-delete] Skipping R2 delete for ${asset.r2_key}: ` +
            `${otherAssetRefs ?? 0} other asset(s) and ${otherJobRefs} job(s) reference it` +
            (jobRefError ? ` (jobs check errored: ${jobRefError.message})` : ""),
        )
      }
    }
  } catch (err) {
    console.error("[asset-delete] R2 delete failed (continuing):", err)
  }

  // Delete the row, scoped by owner, RETURNING the deleted ids so the storage
  // decrement below runs only when THIS call actually removed the row — two
  // concurrent deletes of the same asset must not decrement the quota twice.
  const { data: deletedRows, error: deleteError } = await supabase
    .from("assets")
    .delete()
    .eq("id", asset.id)
    .eq("user_id", userId)
    .select("id")

  if (deleteError) {
    return { ok: false, dbError: deleteError }
  }

  try {
    const sizeBytes = asset.size_bytes ?? 0
    if (sizeBytes > 0 && (deletedRows?.length ?? 0) > 0) {
      await updateStorageUsage(userId, -sizeBytes)
    }
  } catch (err) {
    console.error("[asset-delete] Storage usage update failed:", err)
  }

  return { ok: true, r2Deleted }
}
