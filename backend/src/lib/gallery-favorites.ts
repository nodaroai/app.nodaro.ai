/**
 * Gallery favorites (`gallery_favorites`, migration 055): a person's bookmarks
 * on generations — their own, or anyone's public ones in the gallery.
 *
 * `POST /v1/gallery/favorite` toggles one and `GET /v1/gallery/favorites`
 * lists them; the MCP `favorite_asset` / `list_favorites` tools are the agent
 * face of the same rows. A job's `favorited` flag on `GET /v1/jobs` reads the
 * same table (job-owner-state.ts).
 */
import { supabase } from "./supabase.js"
import { CHILD_JOB_COLUMN } from "./public-job-data.js"

/**
 * Which jobs a person may favorite, as a PostgREST `or()` filter: their own
 * job, or any public completed one (what the public gallery shows). Shared by
 * the REST toggle and MCP `favorite_asset`, so the two agree.
 */
export function favoritableJobFilter(userId: string): string {
  return `user_id.eq.${userId},and(is_public.eq.true,status.eq.completed)`
}

export type ToggleFavoriteOutcome = { kind: "toggled"; favorited: boolean } | { kind: "not_found" }

/**
 * Favorite the job, or un-favorite it when it already is. Adding checks the
 * job is one the caller may see (another person's private job reads as not
 * found, as if it did not exist); removing does not — a person can always
 * take back their own favorite, even of a job that has since gone private.
 * `jobId` must already be a well-formed uuid. Throws on a database failure.
 *
 * A child job (CHILD_JOB_COLUMN) is never favorited by a non-admin: it reads
 * as not found, as on every job read by id. `opts.isAdmin` lifts that.
 */
export async function toggleGalleryFavorite(
  userId: string,
  jobId: string,
  opts: { isAdmin?: boolean } = {},
): Promise<ToggleFavoriteOutcome> {
  const { data: existing, error: readError } = await supabase
    .from("gallery_favorites")
    .select("id")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .limit(1)
  if (readError) throw readError

  if (existing && existing.length > 0) {
    const { error } = await supabase.from("gallery_favorites").delete().eq("user_id", userId).eq("job_id", jobId)
    if (error) throw error
    return { kind: "toggled", favorited: false }
  }

  let jobQuery = supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .or(favoritableJobFilter(userId))
  if (!opts.isAdmin) jobQuery = jobQuery.is(CHILD_JOB_COLUMN, null)
  const { data: job, error: jobError } = await jobQuery.maybeSingle()
  if (jobError) throw jobError
  if (!job) return { kind: "not_found" }

  const { error } = await supabase.from("gallery_favorites").insert({ user_id: userId, job_id: jobId })
  // A concurrent toggle added it first: it is favorited either way.
  if (error?.code === "23505") return { kind: "toggled", favorited: true }
  // The job was deleted between the check and the write.
  if (error?.code === "23503") return { kind: "not_found" }
  if (error) throw error
  return { kind: "toggled", favorited: true }
}

/** The person's favorited job ids, newest first. Throws on a database failure. */
export async function listFavoriteJobIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("gallery_favorites")
    .select("job_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return ((data ?? []) as Array<{ job_id: string }>).map((row) => row.job_id)
}
