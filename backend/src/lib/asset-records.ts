import { supabase } from "./supabase.js"
import { updateStorageUsage } from "../utils/file-validation.js"

/**
 * Record ownership of a video object that a background download placed in R2 —
 * the `assets` row plus the storage-usage increment, exactly the bookkeeping
 * `/v1/upload` does inline.
 *
 * Lives in lib/, not the route, because routes may not import the service-role
 * client (backend/scripts/check-admin-client-import.mjs): this helper takes the
 * owner as an EXPLICIT parameter, so the ownership decision is visible at the
 * call boundary instead of buried in a query.
 *
 * Best-effort by contract: the caller's download has already succeeded, and a
 * bookkeeping failure must not retroactively fail it. An unrecorded object is
 * merely unowned — deleteSource skips it later, the same state every download
 * before this bookkeeping existed is in. Never throws.
 *
 * Deliberately NO quota enforcement (`reserve_storage_if_within_limit`):
 * social downloads have never failed on quota, and introducing that would be a
 * product change nobody authorized. Increment-only accounting; enforcement is
 * a future decision to make on purpose.
 */
export async function recordDownloadedVideoAsset(opts: {
  userId: string
  outputId: string
  sizeBytes: number
  r2Key: string
  r2Url: string
  thumbnailUrl?: string
  sourceUrl: string
}): Promise<void> {
  const { userId, outputId, sizeBytes, r2Key, r2Url, thumbnailUrl, sourceUrl } = opts
  try {
    const { error: insertError } = await supabase.from("assets").insert({
      user_id: userId,
      type: "video",
      filename: `yt-${outputId}.mp4`,
      mime_type: "video/mp4",
      size_bytes: sizeBytes,
      r2_key: r2Key,
      r2_url: r2Url,
      upload_source: "social_download",
      metadata: { thumbnail_url: thumbnailUrl ?? null, source_url: sourceUrl },
    })
    if (insertError) {
      console.warn(
        `[download-video] asset record insert failed for ${r2Key} (video kept, unowned): ${insertError.message}`,
      )
      return
    }
    await updateStorageUsage(userId, sizeBytes)
  } catch (err) {
    console.warn(`[download-video] asset bookkeeping failed for ${r2Key} (video kept, unowned):`, err)
  }
}
