/**
 * Upscaling a trend's source clip or one of its examples to 1080p. Registered
 * by `adminTrendsRoutes` (admin-trends.ts), so it shares its `requireAdmin`
 * door and its edition gate; every route here is admin-only.
 *
 *   POST   /v1/admin/trends/:id/upscale                 { target, index?, revision }: start a Topaz upscale → 202
 *   POST   /v1/admin/trends/:id/upscale/apply           { jobId, revision }: use the finished upscale → 202 (runs in the background)
 *   DELETE /v1/admin/trends/:id/upscale/:jobId?revision=  discard an upscale in the making
 *
 * Starting asks the core `POST /v1/video-upscale` (Topaz, `targetResolution`
 * "1080p": the short side) as the admin, through `engineRequest`: the job is
 * the admin's, billed as any upscale, and the core route refuses a clip it
 * cannot take (unreadable, too long) before anything is held. A video at
 * exactly 1080 on its short side is enhanced at that size (the same ask); one
 * above 1080 is refused here (`offersUpscale`: a 1080p target would shrink it),
 * and so is a start while an upscale of the same video is still running. The job is written
 * onto the draft (`upscaleJobs`, named by the video it was made from), so the
 * editor follows it across a reload, a reorder or a removal.
 *
 * Applying takes the draft's own pending upscale only: the caller's finished
 * Topaz job of exactly that video, while the video is still the target's. It
 * answers 202 at once and does the work in the background, in this process
 * (the download, the resize and the store outlast the edge's timeout): the
 * record is marked `applying`, and the editor reads the trend until the record
 * is gone (applied) or carries an `error`. One applying for longer than
 * `UPSCALE_APPLY_STALE_MS` (a restart) may be tried again; a second "Use it"
 * meanwhile is 409 `apply_in_progress`. The work:
 *   - stores the upscale at 1080p (short side; `storeUpscaledVideo`) under
 *     the trend;
 *   - an example gets the new video, a fresh poster, and its size and length;
 *   - the source is replaced exactly as a new source clip is (stored with the
 *     source's length range and a new display copy; the preview start kept
 *     inside it), and the preview's input clip is cut again from it
 *     (`ensurePreviewClip`). That makes a stored face mask out of date, by
 *     design: its settings key names the source clip.
 * It is applied to the draft as it is THEN (another write that landed
 * meanwhile is kept). Edits go to the draft only; a published version is
 * never touched, and republishing shows them.
 *
 * Each action writes an `admin_actions` row.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { deriveJobSource } from "../../lib/job-source.js"
import { IN_FLIGHT_JOB_STATUSES } from "../../lib/job-status.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { DraftConflictError, getDraftState, saveDraft } from "../lib/trends/store.js"
import { trendVersionDataSchema } from "../lib/trends/schemas.js"
import { TrendMediaError, isTransientMediaFailure, storeUpscaledVideo } from "../lib/trends/media.js"
import {
  UPSCALE_JOB_TYPE,
  UPSCALE_TOPAZ_RESOLUTION,
  currentUpscaleTarget,
  isApplying,
  offersUpscale,
  pendingUpscaleJobs,
  upscaleSourceOf,
  withNewSourceClip,
  withUpscaleJob,
  withoutUpscaleJob,
  type UpscaleTarget,
} from "../lib/trends/upscale.js"
import { ensurePreviewClip } from "../lib/trends/preview-clip-media.js"
import { engineRequest, isRec, jobIdOf, parseJson, str, unavailableOrInternal } from "../lib/trends/run-helpers.js"
import type { TrendPreviewClip, TrendRow, TrendUpscaleJob, TrendVersionData } from "../lib/trends/types.js"
import { audit } from "./admin-trends-lifecycle.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const revisionSchema = z.string().min(1).max(100)
const startBody = z.discriminatedUnion("target", [
  z.strictObject({ target: z.literal("source"), revision: revisionSchema }),
  z.strictObject({ target: z.literal("example"), index: z.int().min(0), revision: revisionSchema }),
])
const applyBody = z.strictObject({ jobId: z.string().regex(UUID_RE, "Not a job id."), revision: revisionSchema })
const revisionQuery = z.object({ revision: revisionSchema })
/** Recording a started job re-reads the draft and tries again this often when another write wins (25 ms, doubling). */
const RECORD_ATTEMPTS = 6
const RECORD_BACKOFF_MS = 25
/** The background apply re-reads the draft and tries again this often when another write wins. */
const APPLY_ATTEMPTS = 3
/** The job statuses of an upscale still running (a job held for review included). */
const JOB_IN_FLIGHT: ReadonlySet<string> = new Set(IN_FLIGHT_JOB_STATUSES)
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The applies running in the background, so a test can wait for them. */
const inFlight = new Set<Promise<void>>()

/** Every background apply settled (tests only). */
export async function _settledUpscaleAppliesForTests(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight])
}

export interface TrendUpscaleDeps {
  /** The trend `:id`, its draft and the draft's revision, or null after replying. */
  loadDraft: (req: FastifyRequest, reply: FastifyReply) => Promise<{ trend: TrendRow; draft: TrendVersionData; revision: string } | null>
  /** Save a valid draft at `expectedRevision`, or reply 400 and return null; throws `DraftConflictError`. */
  saveValidDraft: (reply: FastifyReply, trendId: string, data: TrendVersionData, expectedRevision: string) => Promise<{ version: number; revision: string } | null>
  draftConflict: (reply: FastifyReply) => unknown
  badRequest: (reply: FastifyReply, error: z.ZodError) => unknown
}

function err(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } })
}

/** Video Upscale's refusal as it gave it (an admin route: the reason is theirs to see). */
function relay(reply: FastifyReply, res: { statusCode: number; body: string }) {
  const body = parseJson(res.body)
  if (isRec(body) && isRec(body.error)) return reply.status(res.statusCode).send(body)
  return reply.status(res.statusCode >= 500 ? res.statusCode : 502).send({ error: { code: "upscale_error", message: "Video Upscale answered unexpectedly." } })
}

const targetName = (t: UpscaleTarget) => (t.target === "source" ? "the source clip" : `example ${t.index + 1}`)
const applyInProgress = (reply: FastifyReply) =>
  err(reply, 409, "apply_in_progress", "This upscale is being put in the draft right now. Wait for it to finish.")

/** The caller's own job `jobId`, or null. Throws on a database error. */
async function ownJob(jobId: string, userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, user_id, status, input_data, output_data, should_watermark")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Could not read job ${jobId}: ${error.message}`)
  return isRec(data) && data.user_id === userId ? data : null
}

/** Job `jobId`'s status (whoever started it), or null. Throws on a database error. */
async function jobStatus(jobId: string): Promise<string | null> {
  const { data, error } = await supabase.from("jobs").select("id, status").eq("id", jobId).maybeSingle()
  if (error) throw new Error(`Could not read job ${jobId}: ${error.message}`)
  return isRec(data) ? str(data.status) : null
}

/** The caller's own audit row `action` of job `jobId` on trend `trendId`: its payload, or null. Throws on a database error. */
async function auditedPayload(action: string, trendId: string, jobId: string, userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("admin_actions")
    .select("payload")
    .eq("action", action)
    .eq("target_type", "trend")
    .eq("target_id", trendId)
    .eq("admin_user_id", userId)
    .filter("payload->>jobId", "eq", jobId)
    .limit(1)
  if (error) throw new Error(`Could not read the upscale's ${action}: ${error.message}`)
  const payload = (data as Array<{ payload?: unknown }> | null)?.[0]?.payload
  return isRec(payload) && payload.jobId === jobId ? payload : null
}

/**
 * What an upscale job of trend `trendId` was started for, from the caller's
 * own `upscale_trend_video` audit row of it, or null. Only for a job the draft
 * holds no record of (`recorded: false`, or applied already).
 */
async function auditedUpscale(trendId: string, jobId: string, userId: string): Promise<Pick<TrendUpscaleJob, "target" | "fromUrl"> | null> {
  const payload = await auditedPayload("upscale_trend_video", trendId, jobId, userId)
  const fromUrl = str(payload?.fromUrl)
  const target = payload?.target === "source" || payload?.target === "example" ? payload.target : null
  return fromUrl && target ? { target, fromUrl } : null
}

/** Where the draft holds `url` as the `target`'s video now (the source, or an example's index), or null. */
function holding(data: TrendVersionData, target: TrendUpscaleJob["target"], url: string): UpscaleTarget | null {
  return currentUpscaleTarget(data, { target, fromUrl: url })
}

/** `data` with the upscale applied to `target` (the stored 1080p video and what goes with it). */
function applied(
  data: TrendVersionData,
  target: UpscaleTarget,
  stored: Awaited<ReturnType<typeof storeUpscaledVideo>>,
): TrendVersionData {
  // As a new source clip is set: the stored clip, its size and length, and its own display copy.
  if (target.target === "source") return withNewSourceClip(data, stored)
  const examples = data.examples.map((ex, i) => {
    if (i !== target.index) return ex
    const { posterUrl: _old, ...rest } = ex
    return {
      ...rest,
      videoUrl: stored.url,
      ...(stored.posterUrl ? { posterUrl: stored.posterUrl } : {}),
      width: stored.width,
      height: stored.height,
      durationSec: stored.durationSec,
    }
  })
  return { ...data, examples }
}

/** `data` with its record of `jobId` replaced by `fn`'s (left out when `fn` returns null). */
function withRecord(data: TrendVersionData, jobId: string, fn: (rec: TrendUpscaleJob) => TrendUpscaleJob | null): TrendVersionData {
  const { upscaleJobs, ...rest } = data
  const next = (upscaleJobs ?? []).flatMap((j) => (j.jobId === jobId ? (fn(j) ?? []) : [j]))
  return next.length > 0 ? { ...rest, upscaleJobs: next } : rest
}

interface ApplyRun {
  req: FastifyRequest
  trend: TrendRow
  jobId: string
  made: Pick<TrendUpscaleJob, "target" | "fromUrl">
  /** The `applying.startedAt` this run owns: a run whose mark was taken over (a stale retry) stops. */
  mark: string
  upscaledUrl: string
  durationSec: number
  shownAs?: { width: number; height: number }
}

/** The run's own record on `data` (still marked by it), or null. */
const ownRecord = (data: TrendVersionData, run: ApplyRun) =>
  data.upscaleJobs?.find((j) => j.jobId === run.jobId && j.applying?.startedAt === run.mark) ?? null

/**
 * Write `error` on the run's record and end its `applying` mark, retrying a
 * lost race. Never throws: it is the background's last word (logged).
 */
async function markFailed(run: ApplyRun, code: string, message: string): Promise<void> {
  try {
    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt++) {
      const fresh = await getDraftState(run.trend.id)
      if (!fresh || !ownRecord(fresh.data, run)) return
      const next = withRecord(fresh.data, run.jobId, ({ applying: _a, ...rec }) => ({ ...rec, error: { code, message, at: new Date().toISOString() } }))
      try {
        await saveDraft(run.trend.id, next, { expectedRevision: fresh.revision })
        await audit(run.req, "apply_trend_upscale_failed", "trend", run.trend.id, { slug: run.trend.slug, jobId: run.jobId, code })
        return
      } catch (e) {
        if (!(e instanceof DraftConflictError)) throw e
      }
    }
    run.req.log.warn({ jobId: run.jobId, trendId: run.trend.id, code }, "admin-trends: an upscale's failure could not be written on the draft")
  } catch (e) {
    run.req.log.error({ err: e, jobId: run.jobId, trendId: run.trend.id }, "admin-trends: an upscale's failure could not be written on the draft")
  }
}

/** "Use it", in the background: store the 1080p video, then put it in the draft as it is then. Never throws. */
async function finishApply(run: ApplyRun): Promise<void> {
  const { req, trend, jobId, made } = run
  try {
    const stored = await storeUpscaledVideo(trend.id, {
      upscaledUrl: run.upscaledUrl,
      originalUrl: made.fromUrl,
      durationSec: run.durationSec,
      asSource: made.target === "source",
      ...(run.shownAs ? { shownAs: run.shownAs } : {}),
    })
    // The preview clip cut once (the first attempt's), re-used by a retry after a lost race while it still fits.
    let clip: TrendPreviewClip | undefined
    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt++) {
      const fresh = await getDraftState(trend.id)
      if (!fresh) return
      // Discarded, or taken over by a retry after this run went stale: that one decides.
      if (!ownRecord(fresh.data, run)) {
        req.log.warn({ jobId, trendId: trend.id }, "admin-trends: an upscale's apply was taken over; its result is not used")
        return
      }
      const now = currentUpscaleTarget(fresh.data, made)
      if (!now) {
        return await markFailed(run, "upscale_target_changed", "The video this upscale was made from was replaced or removed meanwhile. Upscale the new one.")
      }
      const parsed = trendVersionDataSchema.safeParse(withoutUpscaleJob(applied(fresh.data, now, stored), jobId))
      if (!parsed.success) return await markFailed(run, "validation_error", "The draft would not be valid with this upscale in it.")
      // A new source clip puts the preview's input clip out of date: cut again from the stored 1080p clip.
      const next = await ensurePreviewClip(trend.id, parsed.data, clip ? { reuse: clip } : {})
      clip = next.previewClip
      try {
        await saveDraft(trend.id, next, { expectedRevision: fresh.revision })
      } catch (e) {
        if (e instanceof DraftConflictError) continue
        throw e
      }
      await audit(req, "apply_trend_upscale", "trend", trend.id, {
        slug: trend.slug,
        jobId,
        target: made.target,
        fromUrl: made.fromUrl,
        url: stored.url,
        width: stored.width,
        height: stored.height,
      })
      return
    }
    await markFailed(run, "draft_conflict", "The draft kept changing while the upscale was put in. Try Use it again.")
  } catch (e) {
    if (e instanceof TrendMediaError) {
      req.log.warn({ err: e.cause ?? e, jobId, trendId: trend.id }, "admin-trends: the upscale could not be stored")
      return markFailed(run, e.code, e.message)
    }
    if (isTransientMediaFailure(e)) {
      req.log.warn({ err: e, jobId, trendId: trend.id }, "admin-trends: the upscale's media step was stopped, not refused")
      return markFailed(run, "media_busy", "The video could not be processed right now. Try Use it again in a moment.")
    }
    req.log.error({ err: e, jobId, trendId: trend.id }, "admin-trends: the upscale could not be used")
    return markFailed(run, "internal_error", "The upscale could not be put in the draft. Try Use it again.")
  }
}

export function registerTrendUpscaleRoutes(app: FastifyInstance, deps: TrendUpscaleDeps): void {
  app.post("/v1/admin/trends/:id/upscale", { preHandler: requireAdmin }, async (req, reply) => {
    const body = startBody.safeParse(req.body)
    if (!body.success) return deps.badRequest(reply, body.error)
    let jobId: string | null = null
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      // Before anything is paid for: a stale screen reloads first.
      if (revision !== body.data.revision) return deps.draftConflict(reply)
      const target: UpscaleTarget = body.data.target === "source" ? { target: "source" } : { target: "example", index: body.data.index }
      const from = upscaleSourceOf(draft, target)
      if (!from) {
        return target.target === "source"
          ? err(reply, 409, "source_missing", "Add a source clip and save the draft first.")
          : err(reply, 404, "not_found", "Example not found")
      }
      if (!offersUpscale(from.width, from.height)) {
        return err(reply, 409, "above_1080p", `The video of ${targetName(target)} is above 1080p: a 1080p upscale would shrink it.`)
      }
      // One upscale of a video at a time: a second click would pay twice for the same result.
      const same = draft.upscaleJobs?.find((j) => j.target === target.target && j.fromUrl === from.fromUrl)
      if (same && isApplying(same)) return applyInProgress(reply)
      if (same && JOB_IN_FLIGHT.has((await jobStatus(same.jobId)) ?? "")) {
        return err(reply, 409, "upscale_in_progress", `An upscale of ${targetName(target)} is already running. Wait for it, or discard it first.`)
      }
      // The job is paid for once Video Upscale is asked: the draft that records it must save, so it
      // is checked first (with a stand-in job), and a draft that cannot is refused before anything is paid.
      const placeholder: TrendUpscaleJob = {
        jobId: "00000000-0000-4000-8000-000000000000",
        target: target.target,
        fromUrl: from.fromUrl,
        startedAt: new Date().toISOString(),
      }
      const valid = trendVersionDataSchema.safeParse({ ...draft, upscaleJobs: withUpscaleJob(draft, placeholder) })
      if (!valid.success) return deps.badRequest(reply, valid.error)
      const key = req.headers["idempotency-key"]
      // Topaz's own target: 1080p is the short side, a portrait clip stays portrait; the frame rate is
      // the clip's own. A clip Topaz cannot take is refused by the core route before anything is held.
      const res = await engineRequest(
        app,
        req,
        "/v1/video-upscale",
        { videoUrl: from.fromUrl, provider: "topaz", targetResolution: UPSCALE_TOPAZ_RESOLUTION },
        typeof key === "string" && key ? { "idempotency-key": key } : {},
        { origin: "trends-admin", source: deriveJobSource(req) },
      )
      if (res.statusCode < 200 || res.statusCode >= 300) return relay(reply, res)
      jobId = jobIdOf(res.body)
      if (!jobId) return err(reply, 502, "upscale_error", "Video Upscale did not return a job id.")
      await audit(req, "upscale_trend_video", "trend", trend.id, { slug: trend.slug, jobId, target: target.target, fromUrl: from.fromUrl })

      // The job is paid for: record it on the draft even when another write
      // landed meanwhile (re-read, keep that write), and say so (`draftMoved`).
      // Should it never land, the job is still applicable: apply finds what it
      // was made from in the audit row written above (`recorded: false`).
      const job: TrendUpscaleJob = { ...placeholder, jobId, startedAt: new Date().toISOString() }
      let current = { data: draft, revision }
      try {
        for (let attempt = 0; attempt < RECORD_ATTEMPTS; attempt++) {
          if (attempt > 0) await pause(RECORD_BACKOFF_MS * 2 ** (attempt - 1))
          const parsed = trendVersionDataSchema.safeParse({ ...current.data, upscaleJobs: withUpscaleJob(current.data, job) })
          if (!parsed.success) break
          try {
            const saved = await saveDraft(trend.id, parsed.data, { expectedRevision: current.revision })
            return reply.status(202).send({ data: { jobId, ...saved, recorded: true, draftMoved: attempt > 0 } })
          } catch (e) {
            if (!(e instanceof DraftConflictError)) throw e
            const fresh = await getDraftState(trend.id)
            if (!fresh) break
            current = { data: fresh.data, revision: fresh.revision }
          }
        }
      } catch (e) {
        // Paid for: whatever failed here, the reply names the job.
        req.log.error({ err: e, jobId, trendId: trend.id }, "admin-trends: the upscale job started but recording it failed")
      }
      req.log.warn({ jobId, trendId: trend.id }, "admin-trends: the upscale job started but could not be recorded on the draft")
      return reply.status(202).send({ data: { jobId, recorded: false, draftMoved: true } })
    } catch (e) {
      // After the job was started, the reply names it whatever else failed.
      if (jobId) {
        req.log.error({ err: e, jobId }, "admin-trends: the upscale job started but the reply failed")
        return reply.status(202).send({ data: { jobId, recorded: false, draftMoved: true } })
      }
      return unavailableOrInternal(reply, req, e, "Failed to start the upscale")
    }
  })

  app.post("/v1/admin/trends/:id/upscale/apply", { preHandler: requireAdmin }, async (req, reply) => {
    const body = applyBody.safeParse(req.body)
    if (!body.success) return deps.badRequest(reply, body.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      if (revision !== body.data.revision) return deps.draftConflict(reply)
      const { jobId } = body.data
      // What the job was made from: the draft's record of it, else (a start that could not record
      // it, or one applied already) the caller's own audit row of that start for this trend.
      const record = draft.upscaleJobs?.find((j) => j.jobId === jobId)
      const made = record ?? (await auditedUpscale(trend.id, jobId, req.userId!))
      if (!made) return err(reply, 409, "not_pending_upscale", "That is not an upscale of this trend in the making. Start the upscale here.")
      const target = currentUpscaleTarget(draft, made)
      if (!target) {
        // Applied already (a click that came back late, a second tab): the draft holds its video. Success.
        const done = str((await auditedPayload("apply_trend_upscale", trend.id, jobId, req.userId!))?.url)
        const now = done ? holding(draft, made.target, done) : null
        if (now) {
          return {
            data: {
              version: trend.draftVersion,
              revision,
              applied: true,
              target: now.target,
              ...(now.target === "example" ? { index: now.index } : {}),
              upscaleJobs: pendingUpscaleJobs(draft),
            },
          }
        }
        return err(reply, 409, "upscale_target_changed", "The video this upscale was made from was replaced or removed since. Discard it, and upscale the new one.")
      }
      if (record && isApplying(record)) return applyInProgress(reply)

      const job = await ownJob(jobId, req.userId!)
      if (!job) return err(reply, 404, "not_found", "Upscale job not found")
      const input = isRec(job.input_data) ? job.input_data : {}
      if (input.type !== UPSCALE_JOB_TYPE || (input.provider ?? "topaz") !== "topaz" || input.videoUrl !== made.fromUrl) {
        return err(reply, 409, "not_an_upscale", "That job is not a Topaz upscale of this video.")
      }
      if (job.status !== "completed") return err(reply, 409, "not_completed", "Only a finished upscale can be used.")
      if (job.should_watermark === true) {
        return err(reply, 409, "watermarked", "This upscale carries a watermark, so it can't go into a trend.")
      }
      const output = isRec(job.output_data) ? job.output_data : {}
      const upscaledUrl = str(output.videoUrl)
      if (!upscaledUrl) return err(reply, 409, "no_video", "This upscale has no video.")
      const from = upscaleSourceOf(draft, target)!
      // How the original is SHOWN (its rotation applied): the source's display copy, an example's own size.
      const shownAs =
        target.target === "source"
          ? draft.source?.display && { width: draft.source.display.width, height: draft.source.display.height }
          : from.width && from.height ? { width: from.width, height: from.height } : undefined

      // Marked on the draft first (a record the start could not write is written now), so a reload
      // follows it and a second click is refused; the work then runs in the background.
      const mark = new Date().toISOString()
      const marked: TrendUpscaleJob = {
        jobId,
        target: made.target,
        fromUrl: made.fromUrl,
        startedAt: record?.startedAt ?? mark,
        applying: { startedAt: mark, by: req.userId! },
      }
      const next = record
        ? withRecord(draft, jobId, () => marked)
        : { ...draft, upscaleJobs: withUpscaleJob(draft, marked) }
      const saved = await deps.saveValidDraft(reply, trend.id, next, revision)
      if (!saved) return reply
      const run: ApplyRun = { req, trend, jobId, made, mark, upscaledUrl, durationSec: from.durationSec, ...(shownAs ? { shownAs } : {}) }
      const work = finishApply(run).finally(() => inFlight.delete(work))
      inFlight.add(work)
      return reply.status(202).send({ data: { jobId, ...saved, applying: true, upscaleJobs: pendingUpscaleJobs(next) } })
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to use the upscale")
    }
  })

  app.delete("/v1/admin/trends/:id/upscale/:jobId", { preHandler: requireAdmin }, async (req, reply) => {
    const query = revisionQuery.safeParse(req.query)
    if (!query.success) return deps.badRequest(reply, query.error)
    const { jobId } = req.params as { jobId: string }
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      if (revision !== query.data.revision) return deps.draftConflict(reply)
      const pending = draft.upscaleJobs?.find((j) => j.jobId === jobId)
      if (!pending) return { data: { version: trend.draftVersion, revision, upscaleJobs: pendingUpscaleJobs(draft) } }
      if (isApplying(pending)) return applyInProgress(reply)
      // The record only: the job (and its video, in the admin's library) stays.
      const next = withoutUpscaleJob(draft, jobId)
      const saved = await deps.saveValidDraft(reply, trend.id, next, revision)
      if (!saved) return reply
      await audit(req, "discard_trend_upscale", "trend", trend.id, { slug: trend.slug, jobId, target: pending.target, fromUrl: pending.fromUrl })
      return { data: { ...saved, upscaleJobs: pendingUpscaleJobs(next) } }
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to discard the upscale")
    }
  })
}
