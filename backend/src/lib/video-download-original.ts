/**
 * The file a Download of a video result gives (decided 2026-11-22: "Download
 * and downstream nodes read the original; the preview is for playing and
 * thumbnails"). The download half only: this module never changes what a
 * node, a player or a thumbnail reads.
 *
 * A video the browser-safe step changed is stored twice by the result funnel
 * (lib/video-result-store.ts): the provider's file untouched at
 * `videos/<id>-master.<ext>`, and its browser-safe preview at
 * `videos/<id>.mp4`. The job's `output_data` names both: `videoUrl` the
 * preview, `originalVideoUrl` the original. Every surface that plays the
 * result holds the preview's address only, so the original is found from it
 * here, by ONE rule every Download reads (`GET /v1/download?original=1`):
 *
 * - an address that is itself a kept original's key
 *   (`videos/<id>-master.<ext>`: a job that completed on its original, or a
 *   copy of that address) is served as it is, with no job read, as the plain
 *   route always served any address of ours;
 * - an address of a preview (`videos/<id>.mp4`) gives the original when the
 *   job its key names (the UUID head of `<id>`) is completed, not in the
 *   Trash, names that very preview as its `videoUrl` and names an original
 *   beside it (`videos/<id>-master.<ext>`) as its `originalVideoUrl`;
 * - anything else, and any read that fails, gives the address itself.
 *
 * For a preview the job's own record is the proof, never the object's
 * presence in storage: an original no completed output names beside that
 * preview (an earlier attempt's, one awaiting the prune) is never given in its
 * place. The key, not the address text, is compared, so
 * a preview read through the fallback host or a transform still finds its
 * original. Only an original in the preview's own key family is ever given,
 * so no job's output can point a Download at another file.
 *
 * A watermarked run keeps no original (its output names none), and a
 * plugin's string-returning store keeps none either: both download what they
 * downloaded before.
 */
import { config } from "./config.js"
import { isOurCdnUrl } from "./cdn-host.js"
import { restrictedKeyOfAddress } from "./content-restriction-address.js"
import { TRASHED_JOB_COLUMN } from "./public-job-data.js"
import { isKeptOriginalKey, jobIdOfKeptOriginalKey, keptOriginalKeysOf } from "./video-original-keys.js"
import { supabase } from "./supabase.js"

/** The two `output_data` fields the rule reads, as a job records them. */
export interface VideoOutputPair {
  readonly videoUrl?: unknown
  readonly originalVideoUrl?: unknown
}

/** The storage key an address of ours names (the content restrictions' decoder: fallback host, transforms, escapes), or null. */
function keyOf(url: string): string | null {
  return restrictedKeyOfAddress(url)
}

/** Whether `key` is a preview's (`videos/<id>.mp4`, never an original's): one an original can be kept beside. */
function isPreviewKey(key: string): boolean {
  return keptOriginalKeysOf(key).length > 0
}

/**
 * The kept original a job's output names beside the preview `previewUrl`
 * (pure): its `originalVideoUrl` when the output's `videoUrl` names the same
 * object as `previewUrl` and the original is one of ours, stored beside that
 * preview. Undefined otherwise.
 */
export function keptOriginalNamedBeside(previewUrl: string, output: VideoOutputPair | null | undefined): string | undefined {
  if (!output) return undefined
  const previewKey = keyOf(previewUrl)
  if (!previewKey || !isPreviewKey(previewKey)) return undefined
  if (typeof output.videoUrl !== "string" || keyOf(output.videoUrl) !== previewKey) return undefined
  const original = output.originalVideoUrl
  if (typeof original !== "string" || !isOurCdnUrl(original, config.R2_PUBLIC_URL, config.R2_PUBLIC_FALLBACK_DOMAIN)) return undefined
  const originalKey = keyOf(original)
  return originalKey !== null && keptOriginalKeysOf(previewKey).includes(originalKey) ? original : undefined
}

/** What a Download of an address serves: the address to fetch, and whether that file is a kept original. */
export interface VideoDownloadTarget {
  readonly url: string
  /** A kept original (`videos/<id>-master.<ext>`): saved as an attachment, never redirected, given the longer fetch. */
  readonly isOriginal: boolean
}

/**
 * The file a Download of `url` fetches (module note): the kept original
 * beside it when its job names one, else `url` itself. An address that IS a
 * kept original (a job that completed on its original) is that original. One
 * read of the job by id, and only for a preview's address; a read that fails
 * gives `url`.
 */
export async function videoDownloadTargetOf(url: string): Promise<VideoDownloadTarget> {
  const key = keyOf(url)
  if (!key) return { url, isOriginal: false }
  if (isKeptOriginalKey(key)) return { url, isOriginal: true }
  if (!isPreviewKey(key)) return { url, isOriginal: false }
  // The job a preview belongs to: the UUID head of its id (`<jobId>`, `<jobId>-merged`…),
  // read off the original's key beside it (the same id, `-master` added).
  const jobId = jobIdOfKeptOriginalKey(keptOriginalKeysOf(key)[0]!)
  if (!jobId) return { url, isOriginal: false }
  try {
    const { data, error } = await supabase
      .from("jobs")
      .select("videoUrl:output_data->>videoUrl, originalVideoUrl:output_data->>originalVideoUrl")
      .eq("id", jobId)
      .eq("status", "completed")
      // A job in the Trash reads as one that does not exist: its Download is the preview, as before.
      .is(TRASHED_JOB_COLUMN, null)
      .maybeSingle()
    if (error || !data) return { url, isOriginal: false }
    const original = keptOriginalNamedBeside(url, data as VideoOutputPair)
    return original ? { url: original, isOriginal: true } : { url, isOriginal: false }
  } catch {
    return { url, isOriginal: false }
  }
}
