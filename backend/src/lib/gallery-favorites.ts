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
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN } from "./public-job-data.js"
import { readableJobsFilter } from "./public-job-read.js"

/**
 * Which jobs a person may favorite, as a PostgREST `or()` filter: their own
 * job, or any public completed one (what the public gallery shows) — the jobs
 * they may read by id (`lib/public-job-read.ts`, which narrows to their own on
 * a deployment that does not allow public work). Shared by the REST toggle and
 * MCP `favorite_asset`, so the two agree.
 */
export function favoritableJobFilter(userId: string): string {
  return readableJobsFilter(userId)
}

export type ToggleFavoriteOutcome = { kind: "toggled"; favorited: boolean } | { kind: "not_found" }

export type AddFavoriteOutcome = { kind: "added" } | { kind: "not_found" }

/**
 * Favorite the job — idempotent: a job already favorited stays favorited, and
 * a concurrent add that lands first is the same answer (23505). Only a job the
 * caller may see: their own, or any public completed one (`favoritableJobFilter`),
 * never one in the Trash; another person's private job reads as not found, as
 * if it did not exist. A child job (CHILD_JOB_COLUMN) is never favorited by a
 * non-admin (`opts.isAdmin` lifts that). `jobId` must already be a well-formed
 * uuid. Throws on a database failure.
 */
export async function addGalleryFavorite(
  userId: string,
  jobId: string,
  opts: { isAdmin?: boolean } = {},
): Promise<AddFavoriteOutcome> {
  let jobQuery = supabase
    .from("jobs")
    .select("id")
    .is(TRASHED_JOB_COLUMN, null)
    .eq("id", jobId)
    .or(favoritableJobFilter(userId))
  if (!opts.isAdmin) jobQuery = jobQuery.is(CHILD_JOB_COLUMN, null)
  const { data: job, error: jobError } = await jobQuery.maybeSingle()
  if (jobError) throw jobError
  if (!job) return { kind: "not_found" }

  const { error } = await supabase.from("gallery_favorites").insert({ user_id: userId, job_id: jobId })
  // Already favorited (an earlier call, or a concurrent one): favorited either way.
  if (error?.code === "23505") return { kind: "added" }
  // The job was deleted between the check and the write.
  if (error?.code === "23503") return { kind: "not_found" }
  if (error) throw error
  return { kind: "added" }
}

/**
 * Take back the caller's favorite of the job — idempotent: one that is not
 * there is already removed. No visibility check: a person can always take back
 * their own favorite, even of a job that has since gone private or into the
 * Trash. Throws on a database failure.
 */
export async function removeGalleryFavorite(userId: string, jobId: string): Promise<void> {
  const { error } = await supabase.from("gallery_favorites").delete().eq("user_id", userId).eq("job_id", jobId)
  if (error) throw error
}

/**
 * Favorite the job, or un-favorite it when it already is — for `POST
 * /v1/gallery/favorite`, whose body names no wanted state. Adding is
 * `addGalleryFavorite` (its visibility rules), removing `removeGalleryFavorite`.
 * A caller that knows the state it wants calls one of those instead: two
 * toggles at once can cancel each other out. Throws on a database failure.
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
    await removeGalleryFavorite(userId, jobId)
    return { kind: "toggled", favorited: false }
  }
  const added = await addGalleryFavorite(userId, jobId, opts)
  return added.kind === "added" ? { kind: "toggled", favorited: true } : { kind: "not_found" }
}

/** The person's favorited job ids, newest first. Throws on a database failure. */
export async function listFavoriteJobIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("gallery_favorites")
    // A favorite of a job in the Trash is left out, as the job is (`!inner`).
    .select("job_id, job:jobs!gallery_favorites_job_id_fkey!inner(id)")
    .eq("user_id", userId)
    .is(`job.${TRASHED_JOB_COLUMN}`, null)
    .order("created_at", { ascending: false })
  if (error) throw error
  return ((data ?? []) as Array<{ job_id: string }>).map((row) => row.job_id)
}
