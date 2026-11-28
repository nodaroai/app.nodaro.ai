/**
 * The SOURCE a step of ours reads for a video input (decided 2026-11-22):
 * the kept original behind a preview, when the run may read it, else the url
 * as given.
 *
 * A provider's file the browser-safe step would change is kept untouched as
 * the job's original (`videos/<id>-master.<ext>`, `originalVideoUrl`) beside
 * an 8-bit H.264 preview (`videos/<id>.mp4`, `videoUrl`) —
 * `lib/video-result-store.ts`. Every node is handed the preview, the url the
 * job's output names. A step that reads the picture itself reads better from
 * the original: an editing node conforms it once at near-lossless quality
 * (`providers/video/editing-source.ts`), a step that finishes a generation
 * keeps its 10-bit picture.
 *
 * The rule, every part of it required, any miss the url as given:
 * - the run has an owner (the job's user);
 * - the url is a file of this install's own storage (`isOwnStoredFileUrl`) at
 *   a preview's key, `videos/<id>.mp4` with `<id>` not itself an original's;
 * - the LIVE job row the key names (its UUID head, `<jobId>` or
 *   `<jobId>-merged`…) is completed and not in the Trash, and is one the
 *   owner may read by today's rule (`jobReadableBy`: their own, or a public
 *   completed one — exactly who could already read the job's output, its
 *   `originalVideoUrl` included);
 * - that row's output names this very object as its `videoUrl` (the key is
 *   compared, not the address text) and an original beside it, at the
 *   preview's own original key (`keptOriginalKeysOf`: the same id plus
 *   `-master`, in the job's key family) — the one rule a Download of the same
 *   preview reads (`keptOriginalNamedBeside`, `lib/video-download-original.ts`).
 *   This module keeps only what a run adds: the owner scoping, the strict
 *   own-storage form of the input, and the doors that read it.
 *
 * The job row is the only proof, never a copied `originalVideoUrl` (a
 * workflow's saved node, a run's node states, an app's snapshot): a node run
 * again after its source job was deleted for good reads the preview, as
 * before. The Download of a result finds its original by the same rule.
 *
 * Never throws: a lookup that fails is the url as given, logged. The run's
 * `input_data` is never rewritten (its route priced the url it names); only
 * the worker's read changes.
 */
import { jobReadableBy } from "./public-job-read.js"
import { TRASHED_JOB_COLUMN } from "./public-job-data.js"
import { isOwnStoredFileUrl } from "./own-storage-url.js"
import { isKeptOriginalKey, jobIdOfKeptOriginalKey, keptOriginalKeysOf } from "./video-original-keys.js"

/** What a video input resolved to. */
export type VideoSource =
  /** The kept original of the preview the run named. */
  | { readonly kind: "original"; readonly url: string; readonly previewUrl: string; readonly jobId: string }
  /** The url the run named, read as it is (it may itself be an original: `isKeptOriginalUrl`). */
  | { readonly kind: "as-given"; readonly url: string }

/** The storage key of one of this install's own files, read from its public url; null for any other url. */
async function ownKeyOf(url: string): Promise<string | null> {
  if (!isOwnStoredFileUrl(url)) return null
  try {
    const { r2KeyFromOurUrl } = await import("./storage.js")
    return r2KeyFromOurUrl(url)
  } catch {
    return null
  }
}

/**
 * Whether `url` is itself a kept original (`videos/<id>-master.<ext>` in this
 * install's own storage): what a job's `videoUrl` names when its preview could
 * not be made (`videoPreviewUnavailable`).
 */
export async function isKeptOriginalUrl(url: string): Promise<boolean> {
  const key = await ownKeyOf(url)
  return key !== null && isKeptOriginalKey(key)
}

/** The job a preview key's id belongs to, when the key is a preview's (`keptOriginalKeysOf` reads it). */
function previewJobOf(key: string): { jobId: string } | undefined {
  const originalKeys = keptOriginalKeysOf(key)
  // The UUID head of the id (`<jobId>`, `<jobId>-merged`…), read off the original's key beside it.
  const jobId = originalKeys[0] ? jobIdOfKeptOriginalKey(originalKeys[0]) : undefined
  return jobId ? { jobId } : undefined
}

/** Injectable for tests: the one row read. */
export interface VideoSourceDeps {
  readJob?: (jobId: string) => Promise<Record<string, unknown> | null>
}

async function readJobRow(jobId: string): Promise<Record<string, unknown> | null> {
  const { supabase } = await import("./supabase.js")
  const { data, error } = await supabase
    .from("jobs")
    .select("user_id, is_public, status, output_data")
    .eq("id", jobId)
    // The live row only: a job in the Trash, or one not completed, names no original here.
    .eq("status", "completed")
    .is(TRASHED_JOB_COLUMN, null)
    .maybeSingle()
  if (error) throw new Error(`job read failed: ${error.message}`)
  return (data as Record<string, unknown> | null) ?? null
}

/**
 * The source a step reads for `url`, a video input of a run of `owner`'s
 * (module note). The original only when every part of the rule holds.
 */
export async function resolveVideoSource(url: string, owner: string | undefined, deps: VideoSourceDeps = {}): Promise<VideoSource> {
  const asGiven: VideoSource = { kind: "as-given", url }
  if (!owner) return asGiven
  const key = await ownKeyOf(url)
  if (key === null) return asGiven
  const preview = previewJobOf(key)
  if (!preview) return asGiven
  let row: Record<string, unknown> | null
  try {
    row = await (deps.readJob ?? readJobRow)(preview.jobId)
  } catch (err) {
    console.warn(`[video-source] the job behind an input could not be read; reading the input as given: ${err instanceof Error ? err.message : String(err)}`)
    return asGiven
  }
  if (!row || row.status !== "completed" || !jobReadableBy(row, owner)) return asGiven
  const output = row.output_data
  // A job whose content was erased (an expunge nulls its output) names nothing.
  if (!output || typeof output !== "object" || Array.isArray(output)) return asGiven
  // Which original sits beside this preview on the row: the ONE rule a
  // Download reads too (`keptOriginalNamedBeside`, lib/video-download-original.ts):
  // the row's `videoUrl` names this very object, its `originalVideoUrl` is
  // ours and in the preview's own key family. Loaded here, not at the top:
  // every provider module imports this one.
  let original: string | undefined
  try {
    const { keptOriginalNamedBeside } = await import("./video-download-original.js")
    original = keptOriginalNamedBeside(url, output as { videoUrl?: unknown; originalVideoUrl?: unknown })
  } catch (err) {
    console.warn(`[video-source] the original beside an input could not be checked; reading the input as given: ${err instanceof Error ? err.message : String(err)}`)
    return asGiven
  }
  return original ? { kind: "original", url: original, previewUrl: url, jobId: preview.jobId } : asGiven
}
