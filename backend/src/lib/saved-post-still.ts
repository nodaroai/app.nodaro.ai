import type { SocialPost } from "@nodaro/shared"
import { permanentlyDeleteAsset } from "./asset-delete.js"
import { readBodyCapped, storeImportedImageBuffer } from "./media-import.js"
import { safeFetch } from "./safe-fetch.js"
import { isStorageConfigured } from "./storage.js"
import { supabase } from "./supabase.js"

/**
 * A saved post's still, copied into the saver's storage so the inspiration
 * wall outlives the platform's signed image links (they expire within days).
 *
 * Best effort, like the scrapers' media step (lib/scraped-media.ts): a dead
 * link, an undecodable image, a full quota or an install without storage all
 * mean "no copy", never a failed save. The copy is a quota-accounted asset
 * kept out of the media picker (`in_library: false`).
 */

/** A post still is a cover image; far below the 20 MB import cap. */
const STILL_MAX_BYTES = 8 * 1024 * 1024
const FETCH_TIMEOUT_MS = 8_000

export interface SavedPostStill {
  readonly assetId: string
  readonly url: string
}

function stillFilename(postId: string): string {
  return `saved-post-${postId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80)}`
}

export async function mirrorSavedPostStill(userId: string, post: SocialPost): Promise<SavedPostStill | null> {
  const sourceUrl = post.media.thumbnailUrl
  if (!sourceUrl || !isStorageConfigured()) return null
  try {
    const res = await safeFetch(sourceUrl, { timeoutMs: FETCH_TIMEOUT_MS })
    if (!res.ok) return null
    const body = await readBodyCapped(res, STILL_MAX_BYTES)
    if (!body) return null
    const stored = await storeImportedImageBuffer({
      userId,
      body,
      uploadSource: "url_import",
      sourceUrl,
      filename: stillFilename(post.id),
      sourceDetail: post.author.handle || undefined,
      inLibrary: false,
    })
    // No asset row means nothing can ever delete or account for the copy, so
    // it is not used (media-import already reports those bytes as orphaned).
    return stored.ok && stored.assetId ? { assetId: stored.assetId, url: stored.url } : null
  } catch (err) {
    console.warn(`[saved-posts] still copy failed for ${post.id}: ${(err as Error).message}`)
    return null
  }
}

/**
 * Remove a saved post's still. Kept when the person has since put it in their
 * library, and its bytes are kept while a job's output still reads them
 * (`blockOnOwnJobReferrers`, the library page's rule). Never throws: a still
 * left behind is a quota leak to report, not a reason to fail the delete.
 */
export async function deleteSavedPostStill(userId: string, assetId: string): Promise<void> {
  try {
    const { data: asset, error } = await supabase
      .from("assets")
      .select("id, r2_key, size_bytes, job_id, relay_job_id, in_library")
      .eq("id", assetId)
      .eq("user_id", userId)
      .maybeSingle()
    if (error) {
      console.warn(`[saved-posts] still lookup failed for asset ${assetId}: ${error.message}`)
      return
    }
    if (!asset || asset.in_library) return
    if (!asset.r2_key) {
      // The storage cleanup already removed the bytes (and their count); only the row is left.
      await supabase.from("assets").delete().eq("id", assetId).eq("user_id", userId)
      return
    }
    const result = await permanentlyDeleteAsset({ userId, asset, blockOnOwnJobReferrers: true })
    if (!result.ok) console.warn(`[saved-posts] still delete failed for asset ${assetId}: ${result.dbError.message}`)
  } catch (err) {
    console.warn(`[saved-posts] still delete failed for asset ${assetId}: ${(err as Error).message}`)
  }
}
