/**
 * The filters of a jobs listing, in ONE place: `GET /v1/jobs` and MCP
 * `list_jobs` (scope mine) both parse into `JobListFilters` and apply it
 * through `applyJobListFilters`, so the two cannot drift.
 *
 * Every filter combines with AND and narrows the database query itself, so
 * the keyset cursor (`created_at`) stays correct: a page is cut from rows
 * that already passed every filter.
 *
 *  - `status`: one or more of the canonical job statuses (job-status.ts).
 *  - `type`: one or more `input_data.type` values — the route that created
 *    the job. Never the `job_type` column: that one is NULL on every row a
 *    synchronous route inserted and is rewritten to the queue name by the
 *    video worker at pickup (see the list route's comment).
 *  - `origin`: `input_data.origin`, the client app that sent the job.
 *  - `source`: one or more caller kinds (`jobs.source`, job-source.ts) — the
 *    surface that created the job: `mcp`, `cli`, `web`, ….
 *  - `favorited`: the owner favorited it (`gallery_favorites`) — or, false,
 *    did not.
 *  - `rating`: the owner rated it good / bad (`job_ratings`, migration 520),
 *    rated it at all (`rated`), or did not (`unrated`).
 *
 * The last two filter on another table, which PostgREST can only do through
 * an EMBED of that table in the select: `!inner` keeps the jobs that have a
 * matching row, and the plain (left) embed plus `is null` keeps the ones that
 * have none (an anti-join). Each embed names the foreign key it follows, so a
 * second key between the tables later cannot make it ambiguous (PGRST201) —
 * the failure `jobs-execution-embed-sites.test.ts` guards for the executions
 * embed.
 */
import { z } from "zod"
import { JOB_STATUSES, type JobStatus } from "./job-status.js"
import { JOB_SOURCES, type JobSource } from "./job-source.js"
import { JOB_RATING_FILTERS, type JobRatingFilter } from "./job-ratings.js"
import { isMissingRelationshipError, isMissingTableError } from "./postgrest-errors.js"

export interface JobListFilters {
  readonly statuses?: readonly JobStatus[]
  readonly types?: readonly string[]
  readonly origin?: string
  readonly sources?: readonly JobSource[]
  readonly favorited?: boolean
  readonly rating?: JobRatingFilter
}

/** The most values one list filter takes. */
export const MAX_JOB_LIST_FILTER_VALUES = 20

/**
 * A query value given once, repeated (`type=a&type=b`, which Fastify parses
 * into an array) or comma-separated (`type=a,b`) — all read the same, deduped.
 * Empty reads as no filter, as an empty value always has.
 */
function listParam<T extends string>(item: z.ZodType<T, string>) {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((value) => [
      ...new Set(
        (Array.isArray(value) ? value : [value])
          .flatMap((part) => part.split(","))
          .map((part) => part.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(item).max(MAX_JOB_LIST_FILTER_VALUES))
}

const jobListQuerySchema = z.object({
  status: listParam(z.enum(JOB_STATUSES)).optional(),
  type: listParam(z.string().max(100)).optional(),
  origin: z.string().max(100).optional(),
  source: listParam(z.enum(JOB_SOURCES)).optional(),
  favorited: z.enum(["true", "false"]).optional(),
  rating: z.enum(JOB_RATING_FILTERS).optional(),
})

export type ParsedJobListQuery = { success: true; data: JobListFilters } | { success: false; error: z.ZodError }

/** `GET /v1/jobs`'s filter params; every other param of the listing is ignored here. */
export function parseJobListQuery(query: unknown): ParsedJobListQuery {
  const parsed = jobListQuerySchema.safeParse(query ?? {})
  if (!parsed.success) return { success: false, error: parsed.error }
  const { status, type, origin, source, favorited, rating } = parsed.data
  return {
    success: true,
    data: {
      ...(status && status.length > 0 ? { statuses: status } : {}),
      ...(type && type.length > 0 ? { types: type } : {}),
      ...(origin ? { origin } : {}),
      ...(source && source.length > 0 ? { sources: source } : {}),
      ...(favorited ? { favorited: favorited === "true" } : {}),
      ...(rating ? { rating } : {}),
    },
  }
}

const RATINGS_TABLE = "job_ratings"
const FAVORITES_EMBED = "gallery_favorites!gallery_favorites_job_id_fkey"
const RATINGS_EMBED = `${RATINGS_TABLE}!job_ratings_job_id_fkey`

/** The embeds the filters need, to append to the listing's select (empty when none does). */
export function jobListFilterSelect(filters: JobListFilters): string {
  const embeds: string[] = []
  if (filters.favorited === true) embeds.push(`${FAVORITES_EMBED}!inner(job_id)`)
  if (filters.favorited === false) embeds.push(`${FAVORITES_EMBED}(job_id)`)
  if (filters.rating === "unrated") embeds.push(`${RATINGS_EMBED}(rating)`)
  else if (filters.rating) embeds.push(`${RATINGS_EMBED}!inner(rating)`)
  return embeds.map((embed) => `, ${embed}`).join("")
}

/** The slice of the PostgREST filter builder the filters use. */
type JobListFilterable<Q> = {
  eq: (column: string, value: string) => Q
  in: (column: string, values: readonly string[]) => Q
  is: (column: string, value: null) => Q
  filter: (column: string, operator: string, value: string) => Q
}

/**
 * Apply every filter to a jobs query whose select carries
 * `jobListFilterSelect(filters)`. `ownerId` is whose favorites and ratings
 * count — the jobs' owner.
 *
 * Always, whatever the filters: a child job (`parent_job_id` set — a step a
 * worker-side handler ran for its parent) is left out. It is shown only
 * through its parent, as the Library leaves it out (`createAssetFromJob`).
 */
export function applyJobListFilters<Q extends JobListFilterable<Q>>(query: Q, filters: JobListFilters, ownerId: string): Q {
  let out = query.is("parent_job_id", null)
  const { statuses, types, origin, sources, favorited, rating } = filters
  if (statuses && statuses.length > 0) out = statuses.length === 1 ? out.eq("status", statuses[0]!) : out.in("status", statuses)
  if (types && types.length > 0) {
    out = types.length === 1 ? out.filter("input_data->>type", "eq", types[0]!) : out.in("input_data->>type", types)
  }
  if (origin) out = out.filter("input_data->>origin", "eq", origin)
  if (sources && sources.length > 0) out = sources.length === 1 ? out.eq("source", sources[0]!) : out.in("source", sources)
  if (favorited !== undefined) {
    out = out.eq("gallery_favorites.user_id", ownerId)
    if (!favorited) out = out.is("gallery_favorites", null)
  }
  if (rating) {
    out = out.eq("job_ratings.user_id", ownerId)
    if (rating === "good" || rating === "bad") out = out.eq("job_ratings.rating", rating)
    if (rating === "unrated") out = out.is("job_ratings", null)
  }
  return out
}

/** A listed row without the embeds the filters joined (they are a filtering detail, never output). */
export function withoutFilterEmbeds<T extends object>(row: T): T {
  const { gallery_favorites: _favorites, job_ratings: _ratings, ...rest } = row as T & {
    gallery_favorites?: unknown
    job_ratings?: unknown
  }
  return rest as T
}

/**
 * Whether a listing failed because it filtered on ratings before the ratings
 * table reached this database (staging runs ahead of main's migrations): the
 * route answers 503 `not_available` instead of a server error.
 *
 * The same query can embed `gallery_favorites` too, so the error code alone
 * cannot tell which embed failed: it must be the ratings table the message or
 * the details name. PostgREST's `hint` is deliberately not read — it guesses
 * at OTHER tables ("Perhaps you meant 'job_ratings'…"), so a broken favorites
 * embed would read as missing ratings and hide a real error behind a 503.
 */
export function ratingsNotAvailable(
  filters: JobListFilters,
  error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined,
): boolean {
  if (!filters.rating) return false
  if (!isMissingRelationshipError(error) && !isMissingTableError(error)) return false
  return [error?.message, error?.details].some((text) => typeof text === "string" && text.includes(RATINGS_TABLE))
}
