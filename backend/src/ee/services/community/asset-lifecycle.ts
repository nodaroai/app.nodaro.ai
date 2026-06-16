import { supabase } from "../../../lib/supabase.js"
import { listObjectsByPrefix, batchDeleteFromR2, copyR2ObjectToPrefix } from "../../../lib/storage.js"
import { refundStorage } from "../../../utils/file-validation.js"
import { COMMUNITY_ENTITY_ADAPTERS, type EntityType } from "../../lib/community-entity-adapters.js"

export interface CopyResult { copiedAssets: Record<string, unknown>; bytes: number; previewImages: string[] }

/** Deep-copy every R2 URL on a ReferenceSheet item (top-level url, the gen source,
 *  and every panel url) through `copyUrl`. Non-string fields pass through untouched. */
export async function deepCopyReferenceSheet(
  sheet: Record<string, unknown>,
  copyUrl: (url: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  return {
    ...sheet,
    url: typeof sheet.url === "string" ? await copyUrl(sheet.url) : sheet.url,
    sourceImageUrlAtGen:
      typeof sheet.sourceImageUrlAtGen === "string" ? await copyUrl(sheet.sourceImageUrlAtGen) : sheet.sourceImageUrlAtGen,
    panelUrls: Array.isArray(sheet.panelUrls)
      ? await Promise.all(sheet.panelUrls.map((u) => (typeof u === "string" ? copyUrl(u) : u)))
      : sheet.panelUrls,
    panelSources: Array.isArray(sheet.panelSources)
      ? await Promise.all(
          (sheet.panelSources as Array<Record<string, unknown>>).map(async (ps) => ({
            ...ps,
            url: typeof ps.url === "string" ? await copyUrl(ps.url) : ps.url,
          })),
        )
      : sheet.panelSources,
  }
}

/**
 * Copy an entity row's adapter assetFields into community/<listingId>/.
 * Returns the copied URL map (same shape per field), total bytes, and a curated
 * preview set. Handles string URLs (e.g. source_image_url), arrays of {name,url}
 * (e.g. detail_closeups/outfit_variations/boards — top-level url copied here),
 * and object-shaped map fields ({ variant: url, ... }). The `sheets` field is
 * an array of ReferenceSheet items: in addition to the top-level url, its nested
 * panelUrls / panelSources[].url / sourceImageUrlAtGen are deep-copied here via
 * deepCopyReferenceSheet (so no panel keeps pointing at the original owner's R2).
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
    } else if (field === "sheets" && Array.isArray(val)) {
      // ReferenceSheet[] — deep-copy nested panel/source/gen URLs, not just the top-level url.
      const sheets = await Promise.all(
        (val as Array<Record<string, unknown>>).map((s) => deepCopyReferenceSheet(s, copyUrl)),
      )
      copiedAssets[field] = sheets
      for (const s of sheets) {
        if (typeof s.url === "string" && previewImages.length < previewBudget) previewImages.push(s.url)
      }
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
        if (typeof v === "string") {
          obj[k] = await copyUrl(v)
        } else if (Array.isArray(v)) {
          obj[k] = await Promise.all(
            v.map((u) => (typeof u === "string" ? copyUrl(u) : u)),
          )
        } else {
          obj[k] = v
        }
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
