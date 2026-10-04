import { supabase } from "./supabase.js"
import { bannedGalleryUsersFilter, galleryHides, type GalleryModeration } from "./gallery-moderation.js"

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

function getOutputType(jobName: string): "image" | "video" | "audio" | null {
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
): string | null {
  if (DUAL_MODE_JOBS.has(jobName)) {
    return (outputData?.videoUrl as string) ?? (outputData?.audioUrl as string) ?? null
  }
  const type = getOutputType(jobName)
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
 * One page of the gallery: completed media outputs, newest first, through the
 * gallery's moderation (lib/gallery-moderation.ts). Throws when the database
 * cannot be read.
 */
export async function readGalleryPage(q: GalleryPageQuery): Promise<GalleryPage> {
  const { limit, cursor, moderation } = q
  const excludedUsers = bannedGalleryUsersFilter(moderation)
  const jobNames = mediaJobNames(q.type)

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
    countQuery = countQuery.in("job_type", jobNames)
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
    dbQuery = dbQuery.in("job_type", jobNames)

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
      const type = getOutputType(job.job_type)
      const outputUrl = getOutputUrl(job.job_type, outputData)
      if (!type || !outputUrl) continue
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
