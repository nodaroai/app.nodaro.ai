/**
 * Cropping a trend's source clip to 16:9 or 9:16. Registered by
 * `adminTrendsRoutes` (admin-trends.ts), so it shares its `requireAdmin` door
 * and its edition gate; every route here is admin-only.
 *
 *   POST   /v1/admin/trends/:id/crop            { aspect, position?, revision }: crop the saved source clip → 202 (runs in the background)
 *   DELETE /v1/admin/trends/:id/crop?revision=  dismiss a failed (or stale) crop
 *
 * Only the crop that trims is taken (`cropAspectFor` of the clip as shown):
 * 16:9 for a clip wider than 16:9 (the sides cut), 9:16 for one taller than
 * 9:16 (the top and bottom cut). `position` (0–1, default 0.5: centered) is
 * the share of the cut taken from the left (16:9) or the top (9:16). It is
 * made from the SAVED source clip, and keeps its quality (`storeCroppedSource`:
 * its codec family, bitrate, pixel format and colour tags; its sound copied).
 *
 * Starting answers 202 at once and does the work in the background, in this
 * process (the download, the crop and the store outlast the edge's timeout):
 * the draft records it (`sourceCrop`, named by the clip it is made from), and
 * the editor reads the trend until the record is gone (put in) or carries an
 * `error`. One running for longer than `CROP_STALE_MS` (a restart) may be
 * started again; a second start meanwhile is 409 `crop_in_progress`. The work
 * stores the crop exactly as a new source clip is (`storeCroppedSource`: the
 * source's length range, a new display copy) and puts it in the draft as it
 * is THEN (another write that landed meanwhile is kept), the preview start
 * kept inside it and the preview's input clip cut again from the crop
 * (`ensurePreviewClip`) — only while the source is still the clip it was
 * made from. That makes a stored face mask out of date, by design: its
 * settings key names the source clip. It also clears the face mask's marks, as any new
 * source clip does (`withMarksForSource`): they are boxes in % of the old
 * frame, and the crop moves it. Edits go to the draft only; a published version is
 * never touched, and republishing shows them.
 *
 * Each action writes an `admin_actions` row.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { requireAdmin } from "../middleware/require-admin.js"
import { DraftConflictError, getDraftState, saveDraft } from "../lib/trends/store.js"
import { trendVersionDataSchema } from "../lib/trends/schemas.js"
import { TrendMediaError, isTransientMediaFailure, storeCroppedSource } from "../lib/trends/media.js"
import { DEFAULT_CROP_POSITION, cropAspectFor, isCropping, pendingSourceCrop, shownSourceSize, withoutSourceCrop } from "../lib/trends/crop.js"
import { withNewSourceClip } from "../lib/trends/upscale.js"
import { ensurePreviewClip } from "../lib/trends/preview-clip-media.js"
import { unavailableOrInternal } from "../lib/trends/run-helpers.js"
import type { TrendPreviewClip, TrendRow, TrendSourceCrop, TrendVersionData } from "../lib/trends/types.js"
import type { TrendUpscaleDeps } from "./admin-trends-upscale.js"
import { audit } from "./admin-trends-lifecycle.js"
import { withMarksForSource } from "./admin-trends-face-mask.js"
import { SUPERSEDED, closeAbandonedVariantJobs } from "./admin-trends-face-mask-variants.js"

const revisionSchema = z.string().min(1).max(100)
const startBody = z.strictObject({
  aspect: z.enum(["16:9", "9:16"]),
  position: z.number().min(0).max(1).default(DEFAULT_CROP_POSITION),
  revision: revisionSchema,
})
const revisionQuery = z.object({ revision: revisionSchema })
/** The background work re-reads the draft and tries again this often when another write wins. */
const APPLY_ATTEMPTS = 3

/** The crops running in the background, so a test can wait for them. */
const inFlight = new Set<Promise<void>>()

/** Every background crop settled (tests only). */
export async function _settledSourceCropsForTests(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight])
}

/** The draft routes this one shares with admin-trends.ts. */
export type TrendCropDeps = TrendUpscaleDeps

function err(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } })
}

const cropInProgress = (reply: FastifyReply) =>
  err(reply, 409, "crop_in_progress", "The source clip is being cropped right now. Wait for it to finish.")

interface CropRun {
  req: FastifyRequest
  trend: TrendRow
  crop: TrendSourceCrop
}

/** The run's own record on `data` (the one it started, not one started after it), or null. */
const ownRecord = (data: TrendVersionData, run: CropRun) =>
  data.sourceCrop && data.sourceCrop.startedAt === run.crop.startedAt && data.sourceCrop.fromUrl === run.crop.fromUrl ? data.sourceCrop : null

/**
 * Write `error` on the run's record, retrying a lost race. Never throws: it is
 * the background's last word (logged).
 */
async function markFailed(run: CropRun, code: string, message: string): Promise<void> {
  try {
    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt++) {
      const fresh = await getDraftState(run.trend.id)
      if (!fresh || !ownRecord(fresh.data, run)) return
      const next = { ...fresh.data, sourceCrop: { ...run.crop, error: { code, message, at: new Date().toISOString() } } }
      try {
        await saveDraft(run.trend.id, next, { expectedRevision: fresh.revision })
        await audit(run.req, "crop_trend_source_failed", "trend", run.trend.id, { slug: run.trend.slug, aspect: run.crop.aspect, code })
        return
      } catch (e) {
        if (!(e instanceof DraftConflictError)) throw e
      }
    }
    run.req.log.warn({ trendId: run.trend.id, code }, "admin-trends: a source crop's failure could not be written on the draft")
  } catch (e) {
    run.req.log.error({ err: e, trendId: run.trend.id }, "admin-trends: a source crop's failure could not be written on the draft")
  }
}

/** The crop, in the background: store it, then put it in the draft as it is then. Never throws. */
async function finishCrop(run: CropRun): Promise<void> {
  const { req, trend, crop } = run
  try {
    const stored = await storeCroppedSource(trend.id, { sourceUrl: crop.fromUrl, aspect: crop.aspect, position: crop.position })
    // The preview clip cut once (the first attempt's), re-used by a retry after a lost race while it still fits.
    let clip: TrendPreviewClip | undefined
    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt++) {
      const fresh = await getDraftState(trend.id)
      if (!fresh) return
      // Dismissed, or a newer crop started after this one went stale: that one decides.
      if (!ownRecord(fresh.data, run)) {
        req.log.warn({ trendId: trend.id }, "admin-trends: a source crop was taken over; its result is not used")
        return
      }
      if (fresh.data.source?.videoUrl !== crop.fromUrl) {
        return await markFailed(run, "source_changed", "The source clip was replaced meanwhile. Crop the new one.")
      }
      const { data: marked, cleared, abandoned } = withMarksForSource(withoutSourceCrop(withNewSourceClip(fresh.data, stored)), fresh.data)
      const parsed = trendVersionDataSchema.safeParse(marked)
      if (!parsed.success) return await markFailed(run, "validation_error", "The draft would not be valid with the cropped clip in it.")
      // A new source clip puts the preview's input clip out of date: cut again from the crop.
      const next = await ensurePreviewClip(trend.id, parsed.data, clip ? { reuse: clip } : {})
      clip = next.previewClip
      try {
        await saveDraft(trend.id, next, { expectedRevision: fresh.revision })
      } catch (e) {
        if (e instanceof DraftConflictError) continue
        throw e
      }
      await closeAbandonedVariantJobs(abandoned, SUPERSEDED)
      await audit(req, "crop_trend_source", "trend", trend.id, {
        slug: trend.slug,
        aspect: crop.aspect,
        position: crop.position,
        fromUrl: crop.fromUrl,
        url: stored.url,
        width: stored.width,
        height: stored.height,
        ...(cleared ? { marksCleared: true } : {}),
      })
      return
    }
    await markFailed(run, "draft_conflict", "The draft kept changing while the cropped clip was put in. Crop it again.")
  } catch (e) {
    if (e instanceof TrendMediaError) {
      req.log.warn({ err: e.cause ?? e, trendId: trend.id }, "admin-trends: the cropped source could not be stored")
      return markFailed(run, e.code, e.message)
    }
    if (isTransientMediaFailure(e)) {
      req.log.warn({ err: e, trendId: trend.id }, "admin-trends: the source crop's media step was stopped, not refused")
      return markFailed(run, "media_busy", "The clip could not be processed right now. Crop it again in a moment.")
    }
    req.log.error({ err: e, trendId: trend.id }, "admin-trends: the source crop failed")
    return markFailed(run, "internal_error", "The source clip could not be cropped. Crop it again.")
  }
}

export function registerTrendCropRoutes(app: FastifyInstance, deps: TrendCropDeps): void {
  app.post("/v1/admin/trends/:id/crop", { preHandler: requireAdmin }, async (req, reply) => {
    const body = startBody.safeParse(req.body)
    if (!body.success) return deps.badRequest(reply, body.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      if (revision !== body.data.revision) return deps.draftConflict(reply)
      const source = draft.source
      if (!source) return err(reply, 409, "source_missing", "Add a source clip and save the draft first.")
      const shown = shownSourceSize(source)
      const offered = shown ? cropAspectFor(shown.width, shown.height) : null
      if (offered !== body.data.aspect) {
        const size = shown ? ` (${shown.width}×${shown.height})` : ""
        return err(
          reply,
          409,
          "crop_not_needed",
          body.data.aspect === "16:9"
            ? `The source clip${size} is not wider than 16:9, so there is nothing to cut at the sides.`
            : `The source clip${size} is not taller than 9:16, so there is nothing to cut at the top and bottom.`,
        )
      }
      if (isCropping(draft.sourceCrop)) return cropInProgress(reply)

      // Marked on the draft first, so a reload follows it and a second click is refused; the work
      // then runs in the background.
      const crop: TrendSourceCrop = {
        aspect: body.data.aspect,
        position: body.data.position,
        fromUrl: source.videoUrl,
        startedAt: new Date().toISOString(),
        by: req.userId!,
      }
      const next = { ...draft, sourceCrop: crop }
      const saved = await deps.saveValidDraft(reply, trend.id, next, revision)
      if (!saved) return reply
      await audit(req, "start_trend_source_crop", "trend", trend.id, { slug: trend.slug, aspect: crop.aspect, position: crop.position, fromUrl: crop.fromUrl })
      const work = finishCrop({ req, trend, crop }).finally(() => inFlight.delete(work))
      inFlight.add(work)
      return reply.status(202).send({ data: { ...saved, sourceCrop: pendingSourceCrop(next) } })
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to start the crop")
    }
  })

  app.delete("/v1/admin/trends/:id/crop", { preHandler: requireAdmin }, async (req, reply) => {
    const query = revisionQuery.safeParse(req.query)
    if (!query.success) return deps.badRequest(reply, query.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      if (revision !== query.data.revision) return deps.draftConflict(reply)
      const pending = draft.sourceCrop
      if (!pending) return { data: { version: trend.draftVersion, revision, sourceCrop: null } }
      if (isCropping(pending)) return cropInProgress(reply)
      const next = withoutSourceCrop(draft)
      const saved = await deps.saveValidDraft(reply, trend.id, next, revision)
      if (!saved) return reply
      await audit(req, "dismiss_trend_source_crop", "trend", trend.id, { slug: trend.slug, aspect: pending.aspect, fromUrl: pending.fromUrl })
      return { data: { ...saved, sourceCrop: null } }
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to dismiss the crop")
    }
  })
}
