/**
 * Ratings on generations (migration 520): a job's owner marks it `good` or
 * `bad`, or clears the mark. One rating per job, by its owner only — the
 * database refuses any other writer as well (the 520 guard trigger).
 *
 * The vocabulary lives here so the route (`PUT /v1/jobs/:id/rating`), the
 * list filter (`GET /v1/jobs?rating=`) and the MCP tools (`rate_job`,
 * `list_jobs`) cannot drift apart.
 */
import { supabase } from "./supabase.js"
import { isMissingTableError } from "./postgrest-errors.js"
import { TRASHED_JOB_COLUMN } from "./public-job-data.js"

export const JOB_RATINGS = ["good", "bad"] as const
export type JobRating = (typeof JOB_RATINGS)[number]

/** The list filter: one rating, any rating (`rated`) or none (`unrated`). */
export const JOB_RATING_FILTERS = [...JOB_RATINGS, "rated", "unrated"] as const
export type JobRatingFilter = (typeof JOB_RATING_FILTERS)[number]

export function isJobRating(value: unknown): value is JobRating {
  return (JOB_RATINGS as readonly unknown[]).includes(value)
}

export type SetJobRatingOutcome =
  | { kind: "ok"; rating: JobRating | null }
  /** Not the caller's job, or no such job — the same answer, never a hint which. */
  | { kind: "not_found" }
  /** The ratings table is not in this database yet (staging before migration 520 reaches main). */
  | { kind: "not_available" }

/**
 * Set the owner's rating of their own job, or clear it with `null`. `jobId`
 * must already be a well-formed uuid. Throws on a database failure.
 */
export async function setJobRating(ownerId: string, jobId: string, rating: JobRating | null): Promise<SetJobRatingOutcome> {
  const { data: job, error: readError } = await supabase
    .from("jobs")
    .select("id")
    .is(TRASHED_JOB_COLUMN, null)
    .eq("id", jobId)
    .eq("user_id", ownerId)
    .maybeSingle()
  if (readError) throw readError
  if (!job) return { kind: "not_found" }

  const { error } =
    rating === null
      ? await supabase.from("job_ratings").delete().eq("user_id", ownerId).eq("job_id", jobId)
      : await supabase
          .from("job_ratings")
          .upsert({ user_id: ownerId, job_id: jobId, rating }, { onConflict: "user_id,job_id" })
  if (isMissingTableError(error)) return { kind: "not_available" }
  // The job was deleted between the check above and the write.
  if (error?.code === "23503") return { kind: "not_found" }
  if (error) throw error
  return { kind: "ok", rating }
}
