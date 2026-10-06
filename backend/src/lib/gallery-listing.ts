import { supabase } from "./supabase.js"
import { bannedGalleryUsersFilter, galleryHides, type GalleryModeration } from "./gallery-moderation.js"
import { APPLY_EDL_JOB, applyEdlMedium, isPreviewListing } from "./apply-edl-listing.js"

// Gallery only shows AI-generated creative content — NOT processing/application
// results.
//
// VOCABULARY (load-bearing): every name below is a BULLMQ QUEUE NAME, i.e. the
// `job.name` the video worker ran the job under — NOT a canvas node type. The
// filter is `.in("job_type", …)` against the `jobs` column, and that column is
// OVERWRITTEN with the queue name by the pickup CAS in
// `workers/video-worker.ts` (`job_type: job.name` — unconditional, not a
// backfill). Orchestrated DAG rows are inserted with `job_type = node.type`
// (`services/workflow-engine/node-executor.ts`), so `modify-image`,
// `upscale-image` and `generate-video` would match NOTHING here; they reach the
// gallery only because pickup rewrote them to `image-to-image` / `edit-image` /
// `image-to-video`. Add a NODE type to these sets and it will never match a
// row; add the QUEUE name and it matches both the direct route and the DAG.
// `routes/__tests__/gallery.test.ts` pins the three renames.
//
// `lib/mcp/tools/gallery.ts` keeps a second copy of these sets for the MCP
// `browse_gallery` verb — change one, change both.
const IMAGE_JOBS = new Set([
  "generate-image", "edit-image", "image-to-image",
  "generate-character", "generate-character-asset",
  "generate-object", "generate-object-asset",
  "generate-location", "generate-location-asset",
])

const VIDEO_JOBS = new Set([
  "image-to-video", "text-to-video", "video-to-video",
  "lip-sync", "motion-transfer",
  // Excluded: video-upscale, combine-videos, suno-music-video, merge-video-audio,
  //           resize-video, trim-video, add-captions, fade-video, loop-video (processing)
])

const AUDIO_JOBS = new Set([
  "text-to-speech", "generate-music", "text-to-audio",
  "suno-generate", "suno-cover", "suno-extend",
  "text-to-dialogue", "voice-changer", "dubbing",
  "voice-remix", "voice-design",
  // Excluded: suno-separate, trim-audio, mix-audio, adjust-volume,
  //           extract-youtube-audio, audio-isolation (processing)
])

/** Apply EDL renders list in the OWNER's own view only (decided 2026-10-06; see
 *  lib/apply-edl-listing.ts): a Preview is private, and a public final would be
 *  exposure the public gallery has never had. Their medium is read per row. */
const OWNER_ONLY_JOBS = new Set(["apply-edl"])

function getOutputType(jobName: string, inputData?: unknown, outputData?: unknown): "image" | "video" | "audio" | null {
  if (jobName === APPLY_EDL_JOB) return applyEdlMedium(inputData, outputData)
  if (IMAGE_JOBS.has(jobName)) return "image"
  if (VIDEO_JOBS.has(jobName)) return "video"
  if (AUDIO_JOBS.has(jobName)) return "audio"
  return null
}

/** Dual-mode generators (voice-changer / voice-changer-pro / dubbing): the RUN
 *  decides audio vs video — read what the row actually produced, video first. */
const DUAL_MODE_JOBS = new Set(["voice-changer", "voice-changer-pro", "dubbing"])

function getOutputUrl(
  jobName: string,
  outputData: Record<string, unknown>,
  inputData?: unknown,
): string | null {
  if (DUAL_MODE_JOBS.has(jobName)) {
    return (outputData?.videoUrl as string) ?? (outputData?.audioUrl as string) ?? null
  }
  const type = getOutputType(jobName, inputData, outputData)
  if (type === "image") return (outputData?.imageUrl as string) ?? null
  if (type === "video") return (outputData?.videoUrl as string) ?? null
  if (type === "audio") return (outputData?.audioUrl as string) ?? null
  return null
}

/** Map job names to the set that should be queryable by type filter */
function jobNamesForType(type: string): string[] {
  if (type === "image") return [...IMAGE_JOBS]
  if (type === "video") return [...VIDEO_JOBS]
  if (type === "audio") return [...AUDIO_JOBS]
  return []
}

export type GalleryMediaType = "image" | "video" | "audio"

/** One gallery card, as the public gallery sends it — never whose it is. */
export interface GalleryItem {
  readonly id: string
  readonly type: GalleryMediaType
  readonly jobName: string
  readonly outputUrl: string
  readonly thumbnailUrl: string | null
  readonly createdAt: string
  readonly prompt: string | null
  readonly model: string | null
  /** A private 720p Preview render (Apply EDL at proxy quality). Present only when true. */
  readonly preview?: true
}

/** A card and its creator — the creator stays on the server unless an admin asks. */
export interface GalleryRow {
  readonly item: GalleryItem
  readonly userId: string | null
}

export interface GalleryPage {
  readonly rows: readonly GalleryRow[]
  readonly nextCursor: string | null
  /** Counted on the first page only (no cursor). */
  readonly totalCount: number | null
}

export interface GalleryPageQuery {
  readonly limit: number
  readonly type?: string
  readonly cursor?: string
  /** Only this creator's work. */
  readonly userId?: string
  /** Only these jobs (a person's favorites). */
  readonly favoriteJobIds?: readonly string[] | null
  /** The owner's own view: private work too. */
  readonly includePrivate: boolean
  readonly moderation: GalleryModeration
}

/** Rows read per round of a page: the filters drop some, so read ahead. */
const FETCH_MULTIPLIER = 2
/** Rounds a page may read before it answers with what it has. */
const MAX_ROUNDS = 5
/** …and while it has found nothing yet: a page is never empty while unread rows remain nearby. */
const MAX_ROUNDS_WHILE_EMPTY = 10

function mediaJobNames(type: string | undefined): string[] {
  return type && ["image", "video", "audio"].includes(type) ? jobNamesForType(type) : [...IMAGE_JOBS, ...VIDEO_JOBS, ...AUDIO_JOBS]
}

/**
 * The job-type filter of one read, as the database applies it: `or` when set,
 * else `in`. The owner's own view adds the owner-only jobs: with no type asked
 * for, by name; with a type asked for, only the renders whose output is of it
 * (an `or`, so the count and the page agree about an audio mix on the video tab).
 * Every other read keeps the plain allowlist.
 */
function jobTypeFilter(
  names: string[],
  type: string | undefined,
  ownerView: boolean,
): { readonly in: string[]; readonly or?: undefined } | { readonly or: string; readonly in?: undefined } {
  if (!ownerView || type === "image") return { in: names }
  if (type === "video" || type === "audio") {
    const url = type === "video" ? "videoUrl" : "audioUrl"
    const owned = [...OWNER_ONLY_JOBS].map((j) => `and(job_type.eq.${j},output_data->>${url}.not.is.null)`)
    return { or: [`job_type.in.(${names.join(",")})`, ...owned].join(",") }
  }
  return { in: [...names, ...OWNER_ONLY_JOBS] }
}

/**
 * One page of the gallery: completed media outputs, newest first, through the
 * gallery's moderation (lib/gallery-moderation.ts). Throws when the database
 * cannot be read.
 */
export async function readGalleryPage(q: GalleryPageQuery): Promise<GalleryPage> {
  const { limit, cursor, moderation } = q
  const excludedUsers = bannedGalleryUsersFilter(moderation)
  const jobNames = mediaJobNames(q.type)
  // The owner's own view: a read of one person's work by that person. Neither
  // flag alone is enough (the admin grid sets `includePrivate` with no owner).
  const ownerView = q.includePrivate && !!q.userId
  const typeFilter = jobTypeFilter(jobNames, q.type, ownerView)

  // Count query (only on first page — when no cursor)
  let totalCount: number | null = null
  if (!cursor) {
    let countQuery = supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .not("output_data", "is", null)
    if (!q.includePrivate) countQuery = countQuery.eq("is_public", true)
    if (q.userId) countQuery = countQuery.eq("user_id", q.userId)
    if (excludedUsers) countQuery = countQuery.filter("user_id", "not.in", excludedUsers)
    if (q.favoriteJobIds) countQuery = countQuery.in("id", [...q.favoriteJobIds])
    countQuery = typeFilter.or !== undefined ? countQuery.or(typeFilter.or) : countQuery.in("job_type", typeFilter.in)
    const { count } = await countQuery
    totalCount = count
  }

  // We need `limit` valid items after JS-side filtering (moderation, missing
  // output URLs). Fetch in batches, over-fetching to compensate.
  const rows: GalleryRow[] = []
  let pageCursor = cursor ?? null
  let hasMore = true
  // True when the page filled up before every row it read was looked at.
  let unreadRows = false

  for (let round = 0; rows.length < limit && hasMore && round < (rows.length === 0 ? MAX_ROUNDS_WHILE_EMPTY : MAX_ROUNDS); round++) {
    const fetchCount = (limit - rows.length) * FETCH_MULTIPLIER + 1 // +1 for hasMore detection

    let dbQuery = supabase
      .from("jobs")
      .select("id, job_type, input_data, output_data, completed_at, user_id, provider")
      .eq("status", "completed")
      .not("output_data", "is", null)
      .order("completed_at", { ascending: false })
      .limit(fetchCount)
    if (!q.includePrivate) dbQuery = dbQuery.eq("is_public", true)
    if (q.userId) dbQuery = dbQuery.eq("user_id", q.userId)
    if (excludedUsers) dbQuery = dbQuery.filter("user_id", "not.in", excludedUsers)
    if (q.favoriteJobIds) dbQuery = dbQuery.in("id", [...q.favoriteJobIds])
    if (pageCursor) dbQuery = dbQuery.lt("completed_at", pageCursor)
    dbQuery = typeFilter.or !== undefined ? dbQuery.or(typeFilter.or) : dbQuery.in("job_type", typeFilter.in)

    const { data: jobs, error } = await dbQuery
    if (error) throw new Error(`Gallery query failed: ${error.message}`)
    if (!jobs || jobs.length === 0) {
      hasMore = false
      break
    }
    if (jobs.length < fetchCount) hasMore = false
    const lastJob = jobs[jobs.length - 1]
    if (lastJob?.completed_at) pageCursor = lastJob.completed_at

    for (const job of jobs) {
      if (rows.length >= limit) {
        unreadRows = true
        break
      }
      const outputData = (job.output_data ?? {}) as Record<string, unknown>
      const inputData = (job.input_data ?? {}) as Record<string, unknown>
      // An owner-only job never leaves the owner's view, whatever the row says.
      if (OWNER_ONLY_JOBS.has(job.job_type) && !(ownerView && job.user_id === q.userId)) continue
      const type = getOutputType(job.job_type, inputData, outputData)
      const outputUrl = getOutputUrl(job.job_type, outputData, inputData)
      if (!type || !outputUrl) continue
      // The type asked for is the type listed (a render's medium is per row).
      if (OWNER_ONLY_JOBS.has(job.job_type) && (q.type === "video" || q.type === "audio" || q.type === "image") && q.type !== type) continue
      if (galleryHides(moderation, { userId: job.user_id, inputData, outputData })) continue
      rows.push({
        userId: (job.user_id as string | null) ?? null,
        item: {
          id: job.id,
          type,
          jobName: job.job_type,
          outputUrl,
          thumbnailUrl: (outputData.thumbnailUrl as string) ?? null,
          createdAt: job.completed_at,
          prompt: (inputData.prompt as string) ?? (inputData.text as string) ?? null,
          model: (inputData.provider as string) ?? (job.provider as string) ?? null,
          ...(isPreviewListing(job) ? { preview: true as const } : {}),
        },
      })
    }
  }

  // Where the next page starts. The page filled up with rows still unread →
  // right after the last item returned. Otherwise every row read was looked
  // at → right after the last row READ, so rows the filters dropped are not
  // read again and a stretch of hidden items never ends the paging.
  const lastItem = rows[rows.length - 1]?.item
  const nextCursor = unreadRows ? (lastItem?.createdAt ?? pageCursor) : hasMore ? pageCursor : null
  return { rows, nextCursor, totalCount }
}
