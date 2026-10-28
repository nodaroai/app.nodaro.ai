/**
 * /v1/admin/trends — build, test, promote examples and publish trends (EE
 * admin; registered under `hasAdmin() && hasCredits()`). Every route is
 * `requireAdmin`.
 *
 *   GET    /v1/admin/trends                          every trend (any status)
 *   POST   /v1/admin/trends                          create a draft → 201
 *   GET    /v1/admin/trends/engine-environments      what each environment's engine supports
 *   GET    /v1/admin/trends/tags                     every tag in use or labelled, with its labels
 *   PUT    /v1/admin/trends/tags                     save one tag's labels ({ tag, labels }; none = clear)
 *   GET    /v1/admin/trends/test-runs/:jobId/prompt  the engine prompt a run used, and the trend's prompt parts (admin-trends-prompt.ts; ?mode=full|preview)
 *   GET    /v1/admin/trends/:id                      the trend, its draft and published data
 *   PATCH  /v1/admin/trends/:id                      slug, tags, badges, sort order
 *   PUT    /v1/admin/trends/:id/draft                save the draft (examples kept)
 *   POST   /v1/admin/trends/:id/media                copy a clip (+ its display copy) / picture into trend storage
 *   POST   /v1/admin/trends/:id/test-runs            run the DRAFT as the admin → 202
 *   GET    /v1/admin/trends/:id/test-runs            the trend's runs by admin accounts
 *   POST   /v1/admin/trends/:id/examples             promote an admin run to an example
 *   PUT    /v1/admin/trends/:id/examples/order       reorder the examples
 *   DELETE /v1/admin/trends/:id/examples/:index      remove an example
 *   POST   /v1/admin/trends/:id/publish              publish the draft (checks + engine check)
 *   POST   /v1/admin/trends/:id/unpublish            take it off the catalog
 *   POST   /v1/admin/trends/:id/archive              put it away (admin-trends-lifecycle.ts)
 *   POST   /v1/admin/trends/:id/restore              bring an archived trend back, unpublished
 *   DELETE /v1/admin/trends/:id/test-runs/:jobId     delete an admin's test run and its media
 *   POST   /v1/admin/trends/:id/face-mask            make the trend's face mask (admin-trends-face-mask.ts) → 202 { jobId, revision }
 *   POST   /v1/admin/trends/:id/face-mask/approve    approve a finished one: stored on the draft
 *   DELETE /v1/admin/trends/:id/face-mask            clear the draft's face mask
 *   POST   /v1/admin/trends/:id/upscale              upscale the source or an example to 720p / 1080p (admin-trends-upscale.ts) → 202
 *   POST   /v1/admin/trends/:id/upscale/apply        use a finished upscale (in the background) → 202: replaces that video on the draft
 *   DELETE /v1/admin/trends/:id/upscale/:jobId       discard an upscale in the making
 *   POST   /v1/admin/trends/:id/crop                 crop the source to 16:9 / 9:16 (admin-trends-crop.ts, in the background) → 202
 *   DELETE /v1/admin/trends/:id/crop                 dismiss a failed source crop
 *   POST   /v1/admin/trends/:id/frame-crop           crop one frame of the original into a stored picture (admin-trends-frame-crop.ts) → { url }
 *   GET    /v1/admin/trends/:id/prompt-parts         the engine's prompt parts for the draft (admin-trends-prompt-parts.ts)
 *   PUT    /v1/admin/trends/:id/prompt-parts         save the draft's overrides, checked by the engine first
 *
 * Replies use the platform's `{ data }` envelope; errors `{ error: { code, message, … } }`.
 *
 * Admins may see a trend's hidden data (source, roleName, references, trend
 * prompt, the engine prompt); nothing here is reachable by a user.
 *
 * Draft writes are guarded on the draft's `revision` (a token that changes on
 * every write of the draft, returned by `GET /:id` and by every draft write):
 * `PUT /:id/draft`, the example reorder and remove routes send the revision
 * they read and get 409 `draft_conflict` when the draft changed since (the
 * screen refetches). Promoting an example re-reads the draft AFTER copying
 * the media and appends to that, and publishing publishes only the exact
 * draft revision it checked.
 *
 * Every draft write goes through the store's `saveDraft`, so editing a
 * published trend writes a new version and users keep the published one until
 * the next publish. A write that can move the 4 s preview's window (the draft
 * save: its source or `previewStart`; an upscale or crop put in; a face mask
 * approved or cleared) first makes the preview's INPUT CLIP as the draft
 * needs it (`ensurePreviewClip`, preview-clip-media.ts: cut once from the
 * source, with the stored face mask's matching cut), and publish makes it
 * too before its checks, so a stale clip never blocks on its own — only one
 * that could not be made (`preview_clip_missing` / `preview_clip_out_of_date`,
 * the failure in the message). Examples are only ever written by the example
 * routes, which copy a run's media into trend storage: only runs by ADMIN
 * accounts (the role `requireAdmin` checks) may become examples.
 */
import { CHILD_JOB_COLUMN } from "../../lib/public-job-data.js"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { LANGUAGES } from "@nodaro/shared/i18n"
import { supabase } from "../../lib/supabase.js"
import { ADMIN_ROLES, checkIsAdmin } from "../../lib/admin-check.js"
import { formatZodError } from "../../lib/zod-error.js"
import { afterKeyset, findOwnSession } from "../../lib/generation-sessions.js"
import { deriveJobSource } from "../../lib/job-source.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { TREND_PUBLISH_ENVIRONMENTS, listEngineEnvironments } from "../lib/engine-environments.js"
import {
  DraftConflictError,
  TrendSlugTakenError,
  TrendsUnavailableError,
  createTrend,
  getDraftState,
  getTrendById,
  getVersion,
  listAllTrends,
  publish,
  saveDraft,
  unpublish,
  updateTrendMeta,
} from "../lib/trends/store.js"
import { trendRunRequestSchema, trendVersionDataSchema } from "../lib/trends/schemas.js"
import { pickText } from "../lib/trends/localize.js"
import { TrendRunError, composeTrendRun, type ComposedTrendRun } from "../lib/trends/compose.js"
import { TREND_SOURCE_SECONDS, TrendMediaError, copyToTrendStorage, isTransientMediaFailure } from "../lib/trends/media.js"
import { publishBlockers } from "../lib/trends/publish-check.js"
import { trendPromptPartProblems } from "../lib/trends/prompt-parts-check.js"
import { replyPromptPartsFailure } from "../lib/cast-swap-prompt-parts.js"
import { allTagUsage, readTagLabels, saveTagLabels, type TagLabels } from "../lib/trends/tags.js"
import {
  RUN_JOB_COLS,
  displaySlots,
  engineRequest,
  engineSupports,
  followPreviewMasking,
  withoutUnsupportedFields,
  isRec,
  jobIdOf,
  listedRunsPage,
  outputVideo,
  relay,
  unavailableOrInternal,
  toTrendRuns,
  type RunJobRow,
  type RunKeyset,
  type TrendRun,
} from "../lib/trends/run-helpers.js"
import type { TrendExample, TrendRow, TrendVersionData } from "../lib/trends/types.js"
import { registerTrendLifecycleRoutes } from "./admin-trends-lifecycle.js"
import { draftFaceMaskState, loadedEngineMakesMarks, registerTrendFaceMaskRoutes, withMarksForSource } from "./admin-trends-face-mask.js"
import { SUPERSEDED, closeAbandonedVariantJobs } from "./admin-trends-face-mask-variants.js"
import { pendingFaceMaskJob } from "../lib/trends/face-mask.js"
import { registerTrendUpscaleRoutes } from "./admin-trends-upscale.js"
import { registerTrendPromptRoutes } from "./admin-trends-prompt.js"
import { registerTrendCropRoutes } from "./admin-trends-crop.js"
import { registerTrendFrameCropRoutes } from "./admin-trends-frame-crop.js"
import { registerTrendPromptPartRoutes } from "./admin-trends-prompt-parts.js"
import { withServerOwnedFields } from "../lib/trends/server-owned.js"
import { pendingSourceCrop } from "../lib/trends/crop.js"
import { pendingUpscaleJobs } from "../lib/trends/upscale.js"
import { ensurePreviewClip } from "../lib/trends/preview-clip-media.js"

// ── shapes ──────────────────────────────────────────────────────────────────

export interface AdminTrendListItem {
  id: string
  slug: string
  status: TrendRow["status"]
  /** English, from the draft. */
  name: string
  /** The draft's Example 1 poster (else its video). */
  coverUrl?: string
  slotCount: number
  draftVersion: number
  publishedVersion: number | null
  tags: string[]
  badges: string[]
  sortOrder: number
  updatedAt: string
}

export type AdminTrendRun = TrendRun & { ownerIsAdmin: boolean }

/** A tag in use on any trend, or one with labels: its labels and how many trends (published ones) carry it. */
export interface AdminTrendTag {
  tag: string
  labels: TagLabels
  trends: number
  published: number
}

// ── constants ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Same shape as migration 549's CHECK on `trends.slug` (and 555's: never `tags`). */
const RESERVED_SLUGS: ReadonlySet<string> = new Set(["runs", "tags"])
const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "A slug is 1–64 of a–z, 0–9 and -, starting with a letter or digit.")
  .refine((s) => !RESERVED_SLUGS.has(s), "\"runs\" and \"tags\" cannot be slugs.")
/** How many of a trend's runs the test list shows. */
const TEST_RUNS_LIMIT = 50
/** Media copied at once while promoting an example. */
const COPY_CONCURRENCY = 4
/** A promotion re-reads the draft and tries again this often when a concurrent write wins. */
const PROMOTE_ATTEMPTS = 3

const createBody = z.strictObject({ slug: slugSchema, name: z.unknown() })
const revisionSchema = z.string().min(1).max(100)
const draftBody = z.strictObject({ data: z.record(z.string(), z.unknown()), revision: revisionSchema })
/**
 * A tag: 1–100 letters, digits (any script, with their combining marks),
 * spaces, - and _. No quotes, backslashes, commas or parentheses: a tag rides
 * in catalog URLs and filters as it is.
 */
const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{M}\p{N} _-]+$/u, "A tag is letters, digits, spaces, - and _ only.")
const patchBody = z.strictObject({
  slug: slugSchema.optional(),
  tags: z.array(tagSchema).max(30).optional(),
  badges: z.array(z.enum(["trending", "new"])).max(2).optional(),
  sortOrder: z.int().min(-1_000_000).max(1_000_000).optional(),
})
/**
 * `source`: the clip (and its display copy); `reference` / `hint` / `default`: a picture (a fixed
 * reference, a slot's hint picture, a slot's default picture for Full depth).
 */
const mediaBody = z.strictObject({ url: z.url({ protocol: /^https?$/ }), kind: z.enum(["source", "reference", "hint", "default"]) })
const exampleBody = z.strictObject({ jobId: z.string().regex(UUID_RE, "Not a job id.") })
const orderBody = z.strictObject({ order: z.array(z.int().min(0)), revision: revisionSchema })
const revisionQuery = z.object({ revision: revisionSchema })
const publishBody = z.strictObject({ revision: revisionSchema.optional() }).optional()
/** A tag as `patchBody` takes it, and its labels by platform language (≤ 100 characters; empty = none). */
const tagLabelsBody = z.strictObject({
  tag: tagSchema,
  labels: z.strictObject(Object.fromEntries(LANGUAGES.map((l) => [l.id, z.string().max(100).optional()]))),
})

// ── replies ─────────────────────────────────────────────────────────────────

function err(reply: FastifyReply, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return reply.status(status).send({ error: { code, message, ...extra } })
}

const notFound = (reply: FastifyReply, what = "Trend") => err(reply, 404, "not_found", `${what} not found`)

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

const draftConflict = (reply: FastifyReply) =>
  err(reply, 409, "draft_conflict", "The draft changed since it was loaded. Reload it and try again.")

// ── reads ───────────────────────────────────────────────────────────────────

/** The trend `:id`, its draft data and the draft's revision, or null after replying (404 for an unknown or malformed id). */
async function loadDraft(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ trend: TrendRow; draft: TrendVersionData; revision: string } | null> {
  const { id } = req.params as { id: string }
  if (!UUID_RE.test(id)) {
    notFound(reply)
    return null
  }
  const state = await getDraftState(id)
  if (!state) {
    notFound(reply)
    return null
  }
  return { trend: state.trend, draft: state.data, revision: state.revision }
}

function toListItem(t: TrendRow & { draft: TrendVersionData | null }): AdminTrendListItem {
  // Example 1, else (a draft with no example yet) the original's display copy.
  const cover = t.draft?.examples[0] ?? t.draft?.source?.display
  const coverUrl = cover?.posterUrl ?? cover?.videoUrl
  return {
    id: t.id,
    slug: t.slug,
    status: t.status,
    name: pickText(t.draft?.name, "en") ?? t.slug,
    ...(coverUrl ? { coverUrl } : {}),
    slotCount: t.draft?.slots.length ?? 0,
    draftVersion: t.draftVersion,
    publishedVersion: t.publishedVersion,
    tags: [...t.tags],
    badges: [...t.badges],
    sortOrder: t.sortOrder,
    updatedAt: t.updatedAt,
  }
}

/** The ids of every admin account (the role `requireAdmin` checks). */
async function adminUserIds(): Promise<string[]> {
  const { data, error } = await supabase.from("profiles").select("id").in("role", [...ADMIN_ROLES])
  if (error) throw new Error(`Could not read admin accounts: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

/** A trend run of trend `trendId` (any owner), with its owner, or null. */
async function findTrendRun(jobId: string, trendId?: string): Promise<(RunJobRow & { user_id: string }) | null> {
  if (!UUID_RE.test(jobId)) return null
  const { data, error } = await supabase
    .from("jobs")
    .select(`${RUN_JOB_COLS}, user_id`)
    .eq("id", jobId)
    .filter("input_data->>type", "eq", "cast-swap")
    .maybeSingle()
  if (error) throw new Error(`Could not read job ${jobId}: ${error.message}`)
  const row = data as (RunJobRow & { user_id: string }) | null
  if (!row || !isRec(row.input_data) || !isRec(row.input_data.trend)) return null
  if (trendId !== undefined && row.input_data.trend.id !== trendId) return null
  return row
}

// ── examples ────────────────────────────────────────────────────────────────

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

interface CopiedRunMedia {
  video: { url: string; width: number; height: number; durationSec: number }
  posterUrl?: string
  /** The run's picture → its copy in trend storage. */
  images: Map<string, string>
}

/**
 * Copy a completed run's result video (+ poster) and every picture it used
 * into the trend's storage (an example keeps its own copies).
 */
async function copyRunMedia(req: FastifyRequest, trendId: string, run: RunJobRow, pictures: string[]): Promise<CopiedRunMedia> {
  const { videoUrl, posterUrl } = outputVideo(run.output_data)
  if (!videoUrl) throw new TrendMediaError("media_unreadable", "The run has no result video.")

  const video = await copyToTrendStorage(trendId, videoUrl, "video")
  let poster: string | undefined
  if (posterUrl) {
    try {
      poster = (await copyToTrendStorage(trendId, posterUrl, "image")).url
    } catch (e) {
      // A poster is a nicety: the example stands without one.
      req.log.warn({ err: e, jobId: run.id }, "admin-trends: could not copy the run's poster")
    }
  }

  const unique = [...new Set(pictures)]
  const copied = await mapLimit(unique, COPY_CONCURRENCY, async (url) => (await copyToTrendStorage(trendId, url, "image")).url)
  return {
    video: { url: video.url, width: video.width!, height: video.height!, durationSec: video.durationSec! },
    ...(poster ? { posterUrl: poster } : {}),
    images: new Map(unique.map((u, i) => [u, copied[i]!])),
  }
}

/**
 * The draft's REQUIRED slots the run has no pictures for. An optional slot
 * may be left without: the example then has no key for it, and a run that
 * leaves it empty with this example keeps that role as in the clip.
 */
function requiredSlotsMissing(draft: TrendVersionData, used: Map<string, string[]>): string[] {
  return draft.slots.filter((s) => s.required && (used.get(s.key)?.length ?? 0) === 0).map((s) => s.key)
}

/**
 * The example for `draft`: the copied video and, for each of the draft's
 * slots the run has pictures for, the copies of them (a slot without any has
 * no key: never an empty list).
 */
function exampleFor(draft: TrendVersionData, run: RunJobRow, media: CopiedRunMedia, used: Map<string, string[]>): TrendExample {
  const slots: Record<string, string[]> = {}
  for (const s of draft.slots) {
    const pictures = used.get(s.key) ?? []
    if (pictures.length > 0) slots[s.key] = pictures.map((u) => media.images.get(u)!)
  }
  return {
    videoUrl: media.video.url,
    ...(media.posterUrl ? { posterUrl: media.posterUrl } : {}),
    width: media.video.width,
    height: media.video.height,
    durationSec: media.video.durationSec,
    slots,
    sourceJobId: run.id,
  }
}

/**
 * Save `data` as the draft if it is still at `expectedRevision`, or reply 400
 * when it does not validate. Throws `DraftConflictError` when the draft moved.
 */
/**
 * The draft's source as saved: the body's, with the stored display copy kept
 * when the body names the SAME clip and sends no `display` (an admin tab
 * opened before the backfill set it, or a builder that predates the field,
 * would otherwise drop it and block publishing), and its stored `sha256`
 * whatever the body says. A different clip never keeps the old clip's copy or
 * hash. A slot's `hintImageUrl` is NOT carried this way: the
 * builder removes a hint picture by leaving the key out.
 */
function keepDisplayCopy(body: Record<string, unknown>, stored: TrendVersionData): Record<string, unknown> {
  const source = body.source
  const kept = stored.source
  if (!kept || !isRec(source) || source.videoUrl !== kept.videoUrl) return body
  const display = kept.display
  // The stored clip's hash is the server's (recorded when the clip was stored): a body naming the same clip
  // never sets it — a tab from before it was recorded would drop it, and a run's provenance must not be a
  // client's word. A different clip takes the body's, which came from the media route.
  const { sha256: _client, ...rest } = source
  const hash = kept.sha256
  return {
    ...body,
    source: {
      ...rest,
      ...(hash ? { sha256: hash } : {}),
      ...(display && !Object.hasOwn(source, "display") ? { display } : {}),
    },
  }
}

async function saveValidDraft(
  reply: FastifyReply,
  trendId: string,
  data: TrendVersionData,
  expectedRevision: string,
): Promise<{ version: number; revision: string } | null> {
  const parsed = trendVersionDataSchema.safeParse(data)
  if (!parsed.success) {
    badRequest(reply, parsed.error)
    return null
  }
  return saveDraft(trendId, parsed.data, { expectedRevision })
}

function trendRunError(reply: FastifyReply, e: TrendRunError) {
  // The draft is not ready to run yet, not a bad request.
  if (e.code === "face_mask_required") return err(reply, 409, e.code, e.message)
  // Admins see the real reason (the public route masks some of them).
  return err(reply, 400, e.code, e.message, {
    ...(e.slot !== undefined ? { slot: e.slot } : {}),
    ...(e.chip !== undefined ? { chip: e.chip } : {}),
  })
}

function mediaError(reply: FastifyReply, e: TrendMediaError) {
  return err(reply, 400, e.code, e.message)
}

/**
 * The answer to a failed media copy, or null when `e` is not one: a file the
 * platform refuses is a 400 (ffmpeg's own words logged when it has some); an
 * ffmpeg or ffprobe the platform killed or could not admit is a 503 (the same
 * file may pass on a retry), never "unreadable".
 */
function mediaFailure(reply: FastifyReply, req: FastifyRequest, e: unknown, trendId: string) {
  if (e instanceof TrendMediaError) {
    if (e.cause !== undefined) req.log.warn({ err: e.cause, trendId }, "admin-trends: the media could not be read or re-encoded")
    return mediaError(reply, e)
  }
  if (isTransientMediaFailure(e)) {
    req.log.warn({ err: e, trendId }, "admin-trends: the media step was stopped, not refused")
    return err(reply, 503, "media_busy", "The video could not be processed right now. Try again in a moment.")
  }
  return null
}

// ── routes ──────────────────────────────────────────────────────────────────

export async function adminTrendsRoutes(app: FastifyInstance) {
  app.get("/v1/admin/trends", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: (await listAllTrends()).map(toListItem) }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to list trends")
    }
  })

  app.post("/v1/admin/trends", { preHandler: requireAdmin }, async (req, reply) => {
    const body = createBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)
    const data = trendVersionDataSchema.safeParse({
      name: body.data.name,
      source: null,
      // The preview starts at 0 until the admin moves it (0 + 4 s fits any 4–30 s source).
      previewStart: 0,
      slots: [],
      references: [],
      examples: [],
    })
    if (!data.success) return badRequest(reply, data.error)
    try {
      const { id } = await createTrend({ slug: body.data.slug, data: data.data, ...(req.userId ? { createdBy: req.userId } : {}) })
      return reply.status(201).send({ data: { id } })
    } catch (e) {
      if (e instanceof TrendSlugTakenError) return err(reply, 409, "slug_taken", e.message)
      return unavailableOrInternal(reply, req, e, "Failed to create the trend")
    }
  })

  // Static segments: registered before /:id (find-my-way prefers them anyway).
  app.get("/v1/admin/trends/engine-environments", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await listEngineEnvironments() }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to read engine environments")
    }
  })

  app.get("/v1/admin/trends/tags", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const usage = await allTagUsage()
      let labels = new Map<string, TagLabels>()
      try {
        labels = await readTagLabels()
      } catch (e) {
        // Before migration 555 the tags still list, without labels; a save says why.
        if (!(e instanceof TrendsUnavailableError)) throw e
      }
      const tags = [...new Set([...usage.keys(), ...labels.keys()])].sort()
      const data: AdminTrendTag[] = tags.map((tag) => ({
        tag,
        labels: labels.get(tag) ?? {},
        trends: usage.get(tag)?.trends ?? 0,
        published: usage.get(tag)?.published ?? 0,
      }))
      return { data }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to list the trend tags")
    }
  })

  app.put("/v1/admin/trends/tags", { preHandler: requireAdmin }, async (req, reply) => {
    const body = tagLabelsBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)
    try {
      const labels = await saveTagLabels(body.data.tag, body.data.labels as TagLabels)
      return { data: { tag: body.data.tag, labels } }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to save the tag's labels")
    }
  })

  app.get("/v1/admin/trends/:id", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const loaded = await loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      const published =
        trend.publishedVersion === null
          ? null
          : trend.publishedVersion === trend.draftVersion
            ? draft
            : await getVersion(trend.id, trend.publishedVersion)
      return {
        data: { trend, draft, published, revision, faceMaskState: await draftFaceMaskState(req, draft), faceMaskJob: pendingFaceMaskJob(draft),
          upscaleJobs: pendingUpscaleJobs(draft), sourceCrop: pendingSourceCrop(draft),
          // Whether a face mask with marks can be made here (the marks editor is offered only then).
          faceMaskMarksSupported: loadedEngineMakesMarks() },
      }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to read the trend")
    }
  })

  app.patch("/v1/admin/trends/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!UUID_RE.test(id)) return notFound(reply)
    const body = patchBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)
    if (Object.keys(body.data).length === 0) return err(reply, 400, "validation_error", "No fields to update")
    const patch = {
      ...body.data,
      ...(body.data.tags ? { tags: [...new Set(body.data.tags)] } : {}),
      ...(body.data.badges ? { badges: [...new Set(body.data.badges)] } : {}),
    }
    try {
      const trend = await updateTrendMeta(id, patch)
      if (!trend) return notFound(reply)
      return { data: trend }
    } catch (e) {
      if (e instanceof TrendSlugTakenError) return err(reply, 409, "slug_taken", e.message)
      return unavailableOrInternal(reply, req, e, "Failed to update the trend")
    }
  })

  app.put("/v1/admin/trends/:id/draft", { preHandler: requireAdmin }, async (req, reply) => {
    const body = draftBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)
    try {
      const loaded = await loadDraft(req, reply)
      if (!loaded) return reply
      if (loaded.revision !== body.data.revision) return draftConflict(reply)
      // The examples, face mask, upscales, source crop and prompt parts are each written only by their
      // own routes: the body's are ignored, and the row's own (at the revision the client read) are kept.
      const merged = withServerOwnedFields(keepDisplayCopy(body.data.data, loaded.draft), loaded.draft)
      // A new source clip clears the face mask's marks (they were drawn on the old one), and says so.
      const { data: marked, cleared, abandoned } = withMarksForSource(merged, loaded.draft)
      // Validated BEFORE the preview clip is cut: a draft that cannot save pays for no ffmpeg run.
      const valid = trendVersionDataSchema.safeParse(marked)
      if (!valid.success) return badRequest(reply, valid.error)
      // The preview's input clip, cut (again) when the source, the window or the face mask moved. A cut that
      // fails never loses the save: the draft is saved as it is (its clip missing or stale, which blocks
      // publish — the blocker carries the reason — but not the admin's other edits), and the answer says why.
      let data = valid.data
      let previewClipError: string | undefined
      try {
        data = await ensurePreviewClip(loaded.trend.id, valid.data)
      } catch (e) {
        if (!(e instanceof TrendMediaError) && !isTransientMediaFailure(e)) throw e
        req.log.warn({ err: e instanceof TrendMediaError ? (e.cause ?? e) : e, trendId: loaded.trend.id }, "admin-trends: the preview input clip could not be made at save")
        previewClipError = e instanceof TrendMediaError ? e.message : "The clip could not be processed right now. Try again in a moment."
      }
      const saved = await saveValidDraft(reply, loaded.trend.id, data, body.data.revision)
      if (!saved) return reply
      await closeAbandonedVariantJobs(abandoned, SUPERSEDED)
      // The face mask's state after the save: the editor starts no make when the saved settings already match it.
      return {
        data: {
          ...saved,
          faceMaskState: await draftFaceMaskState(req, data),
          ...(cleared ? { marksCleared: true } : {}),
          ...(previewClipError ? { previewClipError } : {}),
        },
      }
    } catch (e) {
      if (e instanceof DraftConflictError) return draftConflict(reply)
      return mediaFailure(reply, req, e, (req.params as { id: string }).id) ?? unavailableOrInternal(reply, req, e, "Failed to save the draft")
    }
  })

  app.post("/v1/admin/trends/:id/media", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!UUID_RE.test(id)) return notFound(reply)
    const body = mediaBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)
    try {
      if (!(await getTrendById(id))) return notFound(reply)
      const source = body.data.kind === "source"
      const stored = await copyToTrendStorage(id, body.data.url, source ? "video" : "image", source ? { durationSec: TREND_SOURCE_SECONDS, display: true } : {})
      return {
        data: {
          url: stored.url,
          ...(stored.durationSec !== undefined ? { durationSec: stored.durationSec } : {}),
          ...(stored.width !== undefined ? { width: stored.width } : {}),
          ...(stored.height !== undefined ? { height: stored.height } : {}),
          // The source's display copy: the admin saves it on the draft's `source.display`.
          ...(stored.display ? { display: stored.display } : {}),
          // The source's hash (`source.sha256`, a full run's provenance): saved on the draft the same way.
          ...(source && stored.sha256 ? { sha256: stored.sha256 } : {}),
        },
      }
    } catch (e) {
      return mediaFailure(reply, req, e, id) ?? unavailableOrInternal(reply, req, e, "Failed to store the media")
    }
  })

  app.post("/v1/admin/trends/:id/test-runs", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = trendRunRequestSchema.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const loaded = await loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft } = loaded

      let composed: ComposedTrendRun
      try {
        // The DRAFT version: what the admin is building, not what users see.
        // Every chip of every slot may be set here, the ones the draft hides
        // from people too, so the admin can try each before choosing.
        composed = composeTrendRun(
          { id: trend.id, slug: trend.slug, version: trend.draftVersion, data: draft },
          parsed.data,
          { allowHiddenChips: true },
        )
      } catch (e) {
        if (e instanceof TrendRunError) return trendRunError(reply, e)
        throw e
      }
      if (!engineSupports(composed)) {
        return err(reply, 503, "engine_unsupported", "This environment's Cast Swap engine cannot run this trend yet.")
      }

      const sessionId = parsed.data.sessionId
      if (sessionId) {
        if (!UUID_RE.test(sessionId)) return notFound(reply, "Session")
        const own = await findOwnSession(req, req.userId!, sessionId)
        if (own.error) throw own.error
        if (!own.data) return notFound(reply, "Session")
      }
      // After the session check: a refused request reads no job.
      await followPreviewMasking(composed, {
        userId: req.userId!,
        trendId: trend.id,
        previewJobId: parsed.data.previewJobId,
        log: req.log,
      })
      withoutUnsupportedFields(composed)

      const key = req.headers["idempotency-key"]
      const res = await engineRequest(
        app,
        req,
        "/v1/cast-swap",
        composed.body,
        typeof key === "string" && key ? { "idempotency-key": key } : {},
        // A test run is labelled as one; like a public run it is filed in no
        // session (the session above is checked, not applied).
        { origin: "trends-admin", source: deriveJobSource(req) },
      )
      if (res.statusCode < 200 || res.statusCode >= 300) return relay(reply, res)
      const jobId = jobIdOf(res.body)
      if (!jobId) return err(reply, 502, "engine_error", "Nodaro Motion did not return a job id.")
      return reply.status(202).send({ data: { jobId } })
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to start the test run")
    }
  })

  app.get("/v1/admin/trends/:id/test-runs", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!UUID_RE.test(id)) return notFound(reply)
    try {
      if (!(await getTrendById(id))) return notFound(reply)
      const admins = await adminUserIds()
      if (admins.length === 0) return { data: [] }
      // Runs read from their own stamp, so a run on an older version is listed
      // too. A Full Quality version is listed as its own run, only the newest
      // try of each draft (`listedRunsPage`), so older tries never use up the
      // list's TEST_RUNS_LIMIT.
      const read = async (from: RunKeyset | null, n: number) => {
        let query = supabase
          .from("jobs")
          .select(`${RUN_JOB_COLS}, user_id`)
          .in("user_id", admins)
          // A child job (a run's step) is shown only through its run, as on every job list.
          .is(CHILD_JOB_COLUMN, null)
          .filter("input_data->>type", "eq", "cast-swap")
          .filter("input_data->trend->>id", "eq", id)
        if (from) query = query.or(afterKeyset("created_at", "id", from))
        const { data, error } = await query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(n)
        if (error) throw new Error(`Could not list the trend's runs: ${error.message}`)
        return (data ?? []) as unknown as Array<RunJobRow & { user_id: string }>
      }
      const { rows } = await listedRunsPage(read, null, TEST_RUNS_LIMIT, admins)
      const adminSet = new Set(admins)
      const owners = new Map(rows.map((r) => [r.id, r.user_id]))
      const runs = await toTrendRuns(rows, admins, "admin")
      const out: AdminTrendRun[] = runs.map((r) => ({ ...r, ownerIsAdmin: adminSet.has(owners.get(r.jobId) ?? "") }))
      return { data: out }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to list the trend's runs")
    }
  })

  app.post("/v1/admin/trends/:id/examples", { preHandler: requireAdmin }, async (req, reply) => {
    const body = exampleBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)
    try {
      const loaded = await loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft } = loaded

      const run = await findTrendRun(body.data.jobId, trend.id)
      if (!run) return notFound(reply, "Run")
      if (run.status !== "completed") return err(reply, 409, "not_completed", "Only a finished run can be an example.")
      const input = isRec(run.input_data) ? run.input_data : {}
      if (input.preview === true) {
        return err(reply, 409, "preview_run", "A 4-second preview can't be an example; use a full-length run.")
      }
      // D16: never another user's run — no face appears in a trend unless an admin chose it.
      if (!(await checkIsAdmin(run.user_id))) {
        return err(reply, 409, "not_admin_run", "Only a run made by an admin account can be an example.")
      }
      const used = new Map(displaySlots(input.slots).map((s) => [s.key, s.images]))
      const missing = requiredSlotsMissing(draft, used)
      if (missing.length > 0) {
        return err(reply, 409, "slots_incomplete", "This run has no pictures for every required slot of the draft.", { slots: missing })
      }

      // The copies take a while: the draft is read again afterwards, so an
      // edit (or another promotion) that landed meanwhile is kept, never undone.
      const media = await copyRunMedia(req, trend.id, run, [...used.values()].flat())
      for (let attempt = 0; attempt < PROMOTE_ATTEMPTS; attempt++) {
        const fresh = await getDraftState(trend.id)
        if (!fresh) return notFound(reply)
        const stillMissing = requiredSlotsMissing(fresh.data, used)
        if (stillMissing.length > 0) {
          return err(reply, 409, "slots_incomplete", "This run has no pictures for every required slot of the draft.", { slots: stillMissing })
        }
        const example = exampleFor(fresh.data, run, media, used)
        try {
          const saved = await saveValidDraft(reply, trend.id, { ...fresh.data, examples: [...fresh.data.examples, example] }, fresh.revision)
          if (!saved) return reply
          return reply.status(201).send({ data: { ...saved, index: fresh.data.examples.length, example } })
        } catch (e) {
          if (!(e instanceof DraftConflictError)) throw e
        }
      }
      return draftConflict(reply)
    } catch (e) {
      return mediaFailure(reply, req, e, (req.params as { id: string }).id) ?? unavailableOrInternal(reply, req, e, "Failed to add the example")
    }
  })

  app.put("/v1/admin/trends/:id/examples/order", { preHandler: requireAdmin }, async (req, reply) => {
    const body = orderBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)
    try {
      const loaded = await loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft } = loaded
      // Stale first: a client whose example count changed must refetch, not fix its order.
      if (loaded.revision !== body.data.revision) return draftConflict(reply)
      const { order } = body.data
      const isPermutation =
        order.length === draft.examples.length && new Set(order).size === order.length && order.every((i) => i < draft.examples.length)
      if (!isPermutation) {
        return err(reply, 400, "validation_error", `order must list each example index 0–${draft.examples.length - 1} once.`)
      }
      const saved = await saveValidDraft(reply, trend.id, { ...draft, examples: order.map((i) => draft.examples[i]!) }, body.data.revision)
      if (!saved) return reply
      return { data: saved }
    } catch (e) {
      if (e instanceof DraftConflictError) return draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to reorder the examples")
    }
  })

  app.delete("/v1/admin/trends/:id/examples/:index", { preHandler: requireAdmin }, async (req, reply) => {
    const { index } = req.params as { index: string }
    const i = /^\d+$/.test(index) ? Number(index) : -1
    const query = revisionQuery.safeParse(req.query)
    if (!query.success) return badRequest(reply, query.error)
    try {
      const loaded = await loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft } = loaded
      if (loaded.revision !== query.data.revision) return draftConflict(reply)
      if (i < 0 || i >= draft.examples.length) return notFound(reply, "Example")
      const saved = await saveValidDraft(reply, trend.id, { ...draft, examples: draft.examples.filter((_, j) => j !== i) }, query.data.revision)
      if (!saved) return reply
      return { data: saved }
    } catch (e) {
      if (e instanceof DraftConflictError) return draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to remove the example")
    }
  })

  app.post("/v1/admin/trends/:id/publish", { preHandler: requireAdmin }, async (req, reply) => {
    const body = publishBody.safeParse(req.body ?? undefined)
    if (!body.success) return badRequest(reply, body.error)
    try {
      const loaded = await loadDraft(req, reply)
      if (!loaded) return reply
      const { trend } = loaded
      if (trend.status === "archived") return err(reply, 409, "archived", "Restore the trend before publishing it.")
      if (body.data?.revision !== undefined && body.data.revision !== loaded.revision) return draftConflict(reply)
      // The preview's input clip, made (again) first so a stale or missing one never blocks on its own:
      // saved as its own write (guarded on the revision read; on a published draft that is a new
      // version), and the checks run on what was saved. A make that fails (a clip ffmpeg cannot cut, a
      // stopped launch) leaves the draft as it was: the blocker below stays the gate, carrying why.
      let { draft, revision } = loaded
      let version = trend.draftVersion
      let makeFailed: string | undefined
      try {
        // An invalid draft is refused by the checks below (`invalid_data`) before any ffmpeg run.
        const prepared = trendVersionDataSchema.safeParse(draft).success ? await ensurePreviewClip(trend.id, draft) : draft
        if (prepared !== draft) {
          const saved = await saveValidDraft(reply, trend.id, prepared, revision)
          if (!saved) return reply
          draft = prepared
          revision = saved.revision
          version = saved.version
        }
      } catch (e) {
        if (!(e instanceof TrendMediaError) && !isTransientMediaFailure(e)) throw e
        req.log.warn({ err: e instanceof TrendMediaError ? (e.cause ?? e) : e, trendId: trend.id }, "admin-trends: the preview input clip could not be made at publish")
        makeFailed = e instanceof TrendMediaError ? e.message : "The clip could not be processed right now. Try again in a moment."
      }
      // An outage reading the environments is a 500, never "unknown engine".
      const environments = await listEngineEnvironments()
      // The engine prompt changes, checked by this environment's engine against the draft as it is now.
      const parts = await trendPromptPartProblems(app, req, draft)
      if (parts && "failure" in parts) return replyPromptPartsFailure(reply, parts.failure)
      const reasons = publishBlockers(draft, environments, TREND_PUBLISH_ENVIRONMENTS, parts?.problems).map((r) =>
        makeFailed && (r.code === "preview_clip_missing" || r.code === "preview_clip_out_of_date")
          ? { ...r, message: `${r.message ?? ""} Making it failed: ${makeFailed}`.trim() }
          : r,
      )
      if (reasons.length > 0) {
        return err(reply, 409, "publish_blocked", "This trend cannot be published yet.", { reasons })
      }
      // Publishes exactly the draft revision checked above (the one just saved, when the clip was made), or nothing.
      await publish(trend.id, { version, revision })
      return { data: (await getTrendById(trend.id)) ?? trend }
    } catch (e) {
      if (e instanceof DraftConflictError) return draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to publish the trend")
    }
  })

  app.post("/v1/admin/trends/:id/unpublish", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!UUID_RE.test(id)) return notFound(reply)
    try {
      if (!(await getTrendById(id))) return notFound(reply)
      await unpublish(id)
      const trend = await getTrendById(id)
      if (!trend) return notFound(reply)
      return { data: trend }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to unpublish the trend")
    }
  })

  registerTrendLifecycleRoutes(app, { findTrendRun })
  registerTrendPromptRoutes(app, { findTrendRun, badRequest })
  registerTrendFaceMaskRoutes(app, { loadDraft, saveValidDraft, draftConflict, badRequest })
  registerTrendUpscaleRoutes(app, { loadDraft, saveValidDraft, draftConflict, badRequest })
  registerTrendCropRoutes(app, { loadDraft, saveValidDraft, draftConflict, badRequest })
  registerTrendFrameCropRoutes(app, { loadDraft, badRequest })
  registerTrendPromptPartRoutes(app, { loadDraft, saveValidDraft, draftConflict, badRequest })
}
