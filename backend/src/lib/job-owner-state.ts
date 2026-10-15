/**
 * What a job's owner has marked on it: whether they favorited it
 * (`gallery_favorites`) and how they rated it (`job_ratings`, migration 520).
 *
 * ONE read per table for every job in a response, never one per job — the
 * same shape as `creditStatusMapFor` (job-credit-status.ts). Used by
 * `GET /v1/jobs`, `GET /v1/jobs/:id` and MCP `list_jobs`, which stamp each
 * job with `favorited` and `rating` after sanitizing it.
 *
 * The owner is the jobs' owner (the listed user), which for any caller who is
 * not an admin is the caller: only the owner may rate a job, and the state is
 * theirs.
 */
import { supabase } from "./supabase.js"
import { isMissingTableError } from "./postgrest-errors.js"
import { isJobRating, type JobRating } from "./job-ratings.js"

export interface JobOwnerState {
  readonly favorited: boolean
  readonly rating: JobRating | null
}

export type JobOwnerStateMap = ReadonlyMap<string, JobOwnerState>

const NONE: JobOwnerState = { favorited: false, rating: null }

/**
 * The owner's state for each id (duplicates and empty ids are ignored).
 *
 * Throws when either read fails: a page that silently said `favorited: false`
 * for a favorited job would make the next favorite toggle REMOVE it. The one
 * tolerated failure is the ratings table not being in the database yet — it
 * reaches the shared database only when main deploys, and staging runs ahead
 * of it — which reads as "nothing rated yet".
 */
export async function jobOwnerStateFor(
  ownerId: string,
  jobIds: readonly (string | null | undefined)[],
): Promise<JobOwnerStateMap> {
  const ids = [...new Set(jobIds.filter((id): id is string => Boolean(id)))]
  const map = new Map<string, JobOwnerState>()
  if (ids.length === 0) return map

  const [favorites, ratings] = await Promise.all([
    supabase.from("gallery_favorites").select("job_id").eq("user_id", ownerId).in("job_id", ids),
    supabase.from("job_ratings").select("job_id, rating").eq("user_id", ownerId).in("job_id", ids),
  ])
  if (favorites.error) throw favorites.error
  if (ratings.error && !isMissingTableError(ratings.error)) throw ratings.error

  const favorited = new Set(((favorites.data ?? []) as Array<{ job_id: string }>).map((row) => row.job_id))
  const rated = new Map<string, JobRating>()
  for (const row of (ratings.error ? [] : (ratings.data ?? [])) as Array<{ job_id: string; rating: unknown }>) {
    if (isJobRating(row.rating)) rated.set(row.job_id, row.rating)
  }
  for (const id of ids) {
    if (favorited.has(id) || rated.has(id)) map.set(id, { favorited: favorited.has(id), rating: rated.get(id) ?? null })
  }
  return map
}

/** A job's state from the map — not favorited, not rated when it is absent. */
export function ownerStateOf(jobId: string, map: JobOwnerStateMap): JobOwnerState {
  return map.get(jobId) ?? NONE
}

/**
 * The fields a response carries for one job: its state, or NONE of the two
 * fields when the state could not be read (`map` is `null`). The readers
 * (`GET /v1/jobs`, `GET /v1/jobs/:id`, MCP `list_jobs`) answer the jobs anyway
 * and leave `favorited` / `rating` out — unknown — rather than fail the read
 * or guess: a `false` they never saw would make the next favorite toggle
 * remove the favorite.
 */
export function ownerStateFields(jobId: string, map: JobOwnerStateMap | null): Partial<JobOwnerState> {
  return map ? ownerStateOf(jobId, map) : {}
}
