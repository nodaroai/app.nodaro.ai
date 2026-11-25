/**
 * Where a stored video's kept ORIGINAL lives (decided 2026-11-22): beside its
 * browser-safe preview `videos/<id>.mp4`, at `videos/<id>-master.<ext>` —
 * in the job's own key family, so every job-keyed sweep finds it. A leaf with
 * no imports: the funnel (`lib/video-result-store.ts`) names it, and library
 * delete (`lib/asset-delete.ts`) finds it again from the preview's key.
 */

/** The containers an original is stored as (`lib/storage.ts` VIDEO_EXT_MIME). */
export const ORIGINAL_VIDEO_CONTAINERS = ["mp4", "mov", "webm", "mkv"] as const

/** The suffix of an original's object id. */
const ORIGINAL_SUFFIX = "-master"

/** The object id of a store's original: `<jobId>-master` (the file is `videos/<jobId>-master.<ext>`). */
export function originalVideoObjectId(jobId: string): string {
  return `${jobId}${ORIGINAL_SUFFIX}`
}

/**
 * The keys a preview's original may be stored at, one per container — none
 * when `key` is not a preview (`videos/<id>.mp4`, the id not itself an
 * original's).
 */
export function keptOriginalKeysOf(key: string): string[] {
  const match = /^videos\/([^/]+)\.mp4$/.exec(key)
  if (!match || match[1]!.endsWith(ORIGINAL_SUFFIX)) return []
  return ORIGINAL_VIDEO_CONTAINERS.map((ext) => `videos/${originalVideoObjectId(match[1]!)}.${ext}`)
}

/**
 * Whether `key` is a kept original (`videos/<id>-master.<ext>`). Such an
 * object is never charged on upload: its bytes are its job's record's
 * (`jobs.server_output.stored`), so any delete of it claims it off that record
 * and gives back the claim, never a size of its own (decided 2026-11-23).
 */
export function isKeptOriginalKey(key: string): boolean {
  const match = /^videos\/([^/]+)\.([a-z0-9]+)$/.exec(key)
  return !!match && match[1]!.endsWith(ORIGINAL_SUFFIX) && (ORIGINAL_VIDEO_CONTAINERS as readonly string[]).includes(match[2]!)
}

/** The job id a kept original's key names (`videos/<jobId>-master.<ext>`, or `<jobId>-merged-master`…): its UUID head. */
export function jobIdOfKeptOriginalKey(key: string): string | undefined {
  if (!isKeptOriginalKey(key)) return undefined
  return /^videos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(key)?.[1]
}
