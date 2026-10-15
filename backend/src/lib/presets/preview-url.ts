import { config } from "../config.js"
import { isOwnMediaUrl } from "../fetch-own-media.js"
import { foreignStorageUrls } from "../key-ownership.js"
import { headR2Object, isStorageConfigured, r2KeyFromOurUrl } from "../storage.js"
import { isOwnPresetPreviewKey, isPresetPreviewKey } from "./preview-key.js"

/**
 * A user preset's example picture (`previewUrl` on create / update / import).
 *
 * Accepted only when it is an image THIS platform stores, the caller's own —
 * an upload or a generated result — and the file already exists. Then the
 * preset keeps its own copy of it (lib/presets/preview-copy.ts). Why:
 *   - every client that lists the preset loads the URL; a link to another
 *     host would let a preset carry a tracking pixel or a hotlink, and the
 *     in-app assistant must never be handed an outside address;
 *   - another user's file is not the caller's to copy; it is refused BEFORE
 *     the storage is asked, so the answer never says whether it exists;
 *   - the CDN in front of the media keeps a 404 for a long time, so a preset
 *     naming a job's output before the job completes would show a broken
 *     picture long after the file lands. The existence check is a HEAD on the
 *     storage itself, never through the CDN.
 */
export const PREVIEW_URL_MAX_LENGTH = 2048

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif)$/i

export type PreviewUrlVerdict = "ok" | "not_platform_image" | "not_yours" | "missing"

const PROBLEM: Readonly<Record<Exclude<PreviewUrlVerdict, "ok">, string>> = {
  not_platform_image:
    "must be an image stored on this platform (an upload or a generated result): png, jpg, webp, gif or avif",
  not_yours: "must be one of your own uploads or results",
  missing: "points at a file that does not exist yet — set it once the job that makes it has completed",
}

/** The storage key a platform media URL names: under the public storage URL, or on its second public host. */
export function previewStorageKey(url: string): string | null {
  const key = r2KeyFromOurUrl(url)
  if (key) return key
  const fallback = config.R2_PUBLIC_FALLBACK_DOMAIN
  if (!fallback) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" || parsed.hostname !== fallback) return null
    return parsed.pathname.replace(/^\/+/, "") || null
  } catch {
    return null
  }
}

/** The key of a platform image, or null when `url` is not one. */
function imageKeyOf(url: string): string | null {
  if (!isStorageConfigured() || !isOwnMediaUrl(url)) return null
  const key = previewStorageKey(url)
  return key && IMAGE_FILE.test(key) ? key : null
}

/** Whether `url` may be `userId`'s preset preview. Throws only when the storage or the ownership lookup cannot be asked. */
export async function checkPresetPreviewUrl(userId: string, url: string): Promise<PreviewUrlVerdict> {
  const key = imageKeyOf(url)
  if (!key) return "not_platform_image"
  if (isPresetPreviewKey(key)) {
    if (!isOwnPresetPreviewKey(userId, key)) return "not_yours"
  } else if ((await foreignStorageUrls(userId, [url])).has(url)) {
    return "not_yours"
  }
  const { exists } = await headR2Object(key)
  return exists ? "ok" : "missing"
}

/** How many storage checks run at once for a bulk import. */
const CHECK_CONCURRENCY = 8

/**
 * The first problem among `entries` as a 400 message (`<label> <problem>`), or
 * null when every preview is acceptable. Each distinct URL is checked once.
 * Throws when the storage cannot be asked (the caller answers 500).
 */
export async function previewUrlProblem(
  userId: string,
  entries: ReadonlyArray<{ readonly label: string; readonly url: string }>,
): Promise<string | null> {
  const distinct = [...new Map(entries.map((e) => [e.url, e] as const)).values()]
  for (let i = 0; i < distinct.length; i += CHECK_CONCURRENCY) {
    const batch = distinct.slice(i, i + CHECK_CONCURRENCY)
    const verdicts = await Promise.all(batch.map((e) => checkPresetPreviewUrl(userId, e.url)))
    const at = verdicts.findIndex((v) => v !== "ok")
    if (at >= 0) return `${batch[at]!.label} ${PROBLEM[verdicts[at] as Exclude<PreviewUrlVerdict, "ok">]}`
  }
  return null
}
