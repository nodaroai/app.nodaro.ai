import { supabase } from "../../../lib/supabase.js"
import { listObjectsByPrefix, batchDeleteFromR2, copyR2ObjectToPrefix } from "../../../lib/storage.js"
import { refundStorage } from "../../../utils/file-validation.js"
import { COMMUNITY_ENTITY_ADAPTERS, type EntityType } from "../../lib/community-entity-adapters.js"

export interface CopyResult { copiedAssets: Record<string, unknown>; bytes: number; previewImages: string[] }

/**
 * Copy an entity row's adapter assetFields into community/<listingId>/.
 * Returns the copied URL map (same shape per field), total bytes, and a curated
 * preview set. Handles string URLs, arrays of {name,url}, and object-shaped
 * fields (character_sheet: {frontView,...}).
 */
export async function copyEntityAssetsToPrefix(
  entityType: EntityType,
  row: Record<string, unknown>,
  listingId: string,
  previewBudget: number,
): Promise<CopyResult> {
  const a = COMMUNITY_ENTITY_ADAPTERS[entityType]
  const prefix = `community/${listingId}/`
  const copiedAssets: Record<string, unknown> = {}
  const previewImages: string[] = []
  let bytes = 0

  const copyUrl = async (url: string): Promise<string> => {
    const { url: newUrl, bytes: b } = await copyR2ObjectToPrefix(url, prefix)
    bytes += b
    return newUrl
  }

  for (const field of a.assetFields) {
    const val = row[field]
    if (val == null) continue
    if (typeof val === "string") {
      copiedAssets[field] = await copyUrl(val)
      if (previewImages.length < previewBudget) previewImages.push(copiedAssets[field] as string)
    } else if (Array.isArray(val)) {
      const arr = await Promise.all(
        (val as Array<{ name?: string; url?: string }>).map(async (item) =>
          item?.url ? { ...item, url: await copyUrl(item.url) } : item,
        ),
      )
      copiedAssets[field] = arr
      for (const it of arr) if (it?.url && previewImages.length < previewBudget) previewImages.push(it.url)
    } else if (typeof val === "object") {
      const obj: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        obj[k] = typeof v === "string" ? await copyUrl(v) : v
      }
      copiedAssets[field] = obj
    }
  }
  return { copiedAssets, bytes, previewImages }
}

/**
 * Idempotently purge a listing's community/<id>/ blobs and refund the publisher.
 * CAS-claims r2_assets_purged_at so concurrent takedown+backstop refund once.
 */
export async function purgeCommunityListingBlobs(listingId: string): Promise<void> {
  const { data } = await supabase
    .from("community_listings")
    .update({ r2_assets_purged_at: new Date().toISOString() })
    .eq("id", listingId)
    .is("r2_assets_purged_at", null)
    .select("published_bytes, creator_id")
  const claimed = (data ?? []) as Array<{ published_bytes: number; creator_id: string }>
  if (claimed.length === 0) return
  const keys = await listObjectsByPrefix(`community/${listingId}/`)
  if (keys.length > 0) await batchDeleteFromR2(keys)
  const row = claimed[0]!
  if (row.published_bytes > 0) await refundStorage(row.creator_id, row.published_bytes)
}
