import { supabase } from "./supabase.js"
import { objectKeyJobIdCandidates } from "./job-policy-outputs.js"
import { TRASHED_JOB_COLUMN } from "./public-job-data.js"

/**
 * The name a Library file is shown and searched by (`assets.metadata.name`,
 * the Library search's second column, `ASSET_SEARCH_COLUMNS`): a song's title
 * today. The worker writes it on the file it files (`createAssetFromJob`); a
 * take saved from the canvas (`POST /v1/library/save-generated`) is named here
 * from the job that made it; migration 679 named the files filed before.
 */

/** The longest name a Library file carries; migration 679 keeps a song's to the same. */
export const ASSET_NAME_MAX = 200

type LookupClient = Pick<typeof supabase, "from">

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A name as a file carries it: trimmed and kept to {@link ASSET_NAME_MAX}; undefined for no text. */
export function cleanAssetName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const name = raw.trim().slice(0, ASSET_NAME_MAX).trim()
  return name ? name : undefined
}

/** The title of the take in a Suno job's output (`sunoTracks`) whose file is one of `urls`, or undefined. */
export function songTakeTitle(output: unknown, urls: readonly string[]): string | undefined {
  const tracks = output && typeof output === "object" ? (output as { sunoTracks?: unknown }).sunoTracks : undefined
  if (!Array.isArray(tracks)) return undefined
  for (const track of tracks) {
    if (!track || typeof track !== "object") continue
    const { audioUrl, title } = track as { audioUrl?: unknown; title?: unknown }
    if (typeof audioUrl === "string" && urls.includes(audioUrl)) return cleanAssetName(title)
  }
  return undefined
}

/**
 * The title of the song take stored at `key` (sent as one of `urls`), read off
 * the caller's own finished job that made it: the job named by the key's family
 * (`<jobId>[-v<n>]`, `objectKeyJobIdCandidates`). Undefined for any other file,
 * another user's job, a job in the Trash, or a take with no title. Never throws:
 * a name is a nicety, never a reason to refuse a save.
 */
export async function savedSongName(userId: string, key: string, urls: readonly string[], client: LookupClient = supabase): Promise<string | undefined> {
  const ids = objectKeyJobIdCandidates(key).filter((id) => UUID.test(id))
  if (ids.length === 0) return undefined
  try {
    const { data } = await client
      .from("jobs")
      .select("output_data")
      .in("id", ids)
      .eq("user_id", userId)
      .eq("status", "completed")
      .is(TRASHED_JOB_COLUMN, null)
      .limit(ids.length)
    for (const job of (data ?? []) as Array<{ output_data?: unknown }>) {
      const title = songTakeTitle(job.output_data, urls)
      if (title) return title
    }
    return undefined
  } catch {
    return undefined
  }
}
