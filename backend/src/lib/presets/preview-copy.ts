import { ownKeysOnly } from "../key-ownership.js"
import { copyOwnObjectToKey, getR2ObjectSize, headR2Object, r2Url } from "../storage.js"
import { deleteKeysRecordingFailures } from "../storage-delete.js"
import { supabase } from "../supabase.js"
import { updateStorageUsage } from "../../utils/file-validation.js"
import { isOwnPresetPreviewKey, presetPreviewKey } from "./preview-key.js"
import { previewStorageKey } from "./preview-url.js"

/**
 * A user preset keeps its OWN copy of its example picture (decided 2026-10-15).
 *
 * The picture a caller names is one of their uploads or results. Storing that
 * address as-is tied the preset to a file with a life of its own: a library
 * delete or a retention sweep would leave the preset showing a broken
 * picture. So a create, update or import copies the file — storage to
 * storage, never through the CDN — to a key the preset owns
 * (lib/presets/preview-key.ts) and stores THAT address.
 *
 * The copy is released (deleted, its bytes given back to the user's quota)
 * once no preset of the user names it: on delete, on a replaced or cleared
 * picture, and when the write that made it fails.
 */

/** How many copies run at once for a bulk import. */
const COPY_CONCURRENCY = 8

/**
 * Copies each source key (already checked: lib/presets/preview-url.ts) into the
 * user's preset folder and returns, per source key, the address to store. A key
 * that already is one of the user's preset pictures is kept as it is; a copy
 * that already exists is reused. Throws when a copy fails.
 */
export async function storePresetPreviews(userId: string, sourceKeys: readonly string[]): Promise<Map<string, string>> {
  const stored = new Map<string, string>()
  const distinct = [...new Set(sourceKeys)]
  for (let i = 0; i < distinct.length; i += COPY_CONCURRENCY) {
    const batch = distinct.slice(i, i + COPY_CONCURRENCY)
    const urls = await Promise.all(batch.map((key) => storeOne(userId, key)))
    batch.forEach((key, at) => stored.set(key, urls[at]!))
  }
  return stored
}

async function storeOne(userId: string, sourceKey: string): Promise<string> {
  if (isOwnPresetPreviewKey(userId, sourceKey)) return r2Url(sourceKey)
  const dest = presetPreviewKey(userId, sourceKey)
  // Same source, same key: an existing copy is this very picture.
  if ((await headR2Object(dest)).exists) return r2Url(dest)
  return copyOwnObjectToKey(sourceKey, dest, userId)
}

/** The key of one of `userId`'s preset pictures that `url` names, else null. */
function ownPreviewKeyOf(userId: string, url: string): string | null {
  const key = previewStorageKey(url)
  return key && isOwnPresetPreviewKey(userId, key) ? key : null
}

/**
 * Deletes the copies among `urls` that no preset of the user names any more,
 * and gives their bytes back to the user's quota. Best effort: a failure is
 * logged (a failed storage delete is also recorded for the daily retry),
 * never thrown — the preset write it follows has already happened.
 */
export async function releasePresetPreviews(userId: string, urls: ReadonlyArray<string | null | undefined>): Promise<void> {
  try {
    const candidates = [...new Set(urls.filter((u): u is string => !!u && ownPreviewKeyOf(userId, u) !== null))]
    if (candidates.length === 0) return
    const { data, error } = await supabase
      .from("node_presets")
      .select("preview_url")
      .eq("user_id", userId)
      .in("preview_url", candidates)
    if (error) throw new Error(`preset preview lookup failed: ${error.message}`)
    const stillNamed = new Set(((data ?? []) as { preview_url: string | null }[]).map((r) => r.preview_url))
    const unused = candidates.filter((u) => !stillNamed.has(u)).map((u) => ownPreviewKeyOf(userId, u)!)
    // Someone may have saved the address to their own library: it stays then.
    const keys = await ownKeysOnly(userId, unused, "preset preview release")
    if (keys.length === 0) return
    const sizes = await Promise.all(keys.map((k) => getR2ObjectSize(k)))
    const { failed } = await deleteKeysRecordingFailures(keys, "preset-preview")
    const freed = keys.reduce((sum, k, i) => (failed.includes(k) ? sum : sum + sizes[i]!), 0)
    if (freed > 0) await updateStorageUsage(userId, -freed)
  } catch (err) {
    console.error("[node-presets] releasing preset pictures failed:", err)
  }
}
