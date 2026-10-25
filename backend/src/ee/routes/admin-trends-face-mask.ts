/**
 * A trend's stored face mask (decided 2026-10-25). Registered by
 * `adminTrendsRoutes` (admin-trends.ts), so it shares its `requireAdmin` door
 * and its edition gate; every route here is admin-only.
 *
 *   POST   /v1/admin/trends/:id/face-mask            { revision }: mask the draft's whole source clip once → 202
 *   POST   /v1/admin/trends/:id/face-mask/approve    { jobId, revision }: store that mask on the draft
 *   DELETE /v1/admin/trends/:id/face-mask?revision=  clear the draft's face mask
 *
 * Making one asks the Cast Swap engine (`POST /v1/cast-swap/face-mask`, an
 * internal-only plugin route, reached as the admin through `engineRequest`)
 * with the saved draft's source clip and masking settings as a run sends them.
 * The job is the admin's, and its steps bill the admin. The job is written
 * onto the draft (`faceMaskJob`: its id and the settings key it was made
 * from), so the editor follows it across a reload, and approving trusts the
 * key recorded here rather than the engine's stored copy of the request (the
 * engine fills in its defaults there).
 *
 * Approving takes the draft's own pending job only: the caller's, a finished
 * `cast-swap-face-mask` job with a masked clip, made from the draft's CURRENT
 * source and settings, and not out of date on arrival (Video Mask's recipe,
 * every known environment's engine recipe). It copies the masked clip into the
 * trend's storage, writes `data.faceMask` and clears `faceMaskJob` (guarded on
 * the draft's revision). Clearing removes the pointer only: the stored file
 * stays, since a published version may still point at it.
 *
 * Each action writes an `admin_actions` row.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { deriveJobSource } from "../../lib/job-source.js"
import { faceMaskTargetOf, faceMaskingOn, loadedEngineMasksTarget, withResolvedZone } from "../../lib/cast-swap-face-masking.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { TREND_PUBLISH_ENVIRONMENTS, listEngineEnvironments, type EngineEnvironment } from "../lib/engine-environments.js"
import { DraftConflictError, getDraftState, saveDraft } from "../lib/trends/store.js"
import { trendVersionDataSchema } from "../lib/trends/schemas.js"
import { TrendMediaError, copyToTrendStorage } from "../lib/trends/media.js"
import {
  FACE_MASK_JOB_TYPE,
  faceMaskSettingsKey,
  faceMaskState,
  faceMaskStats,
  type FaceMaskState,
} from "../lib/trends/face-mask.js"
import { engineRequest, isRec, jobIdOf, relay, str, unavailableOrInternal } from "../lib/trends/run-helpers.js"
import type { TrendFaceMask, TrendRow, TrendVersionData } from "../lib/trends/types.js"
import { audit } from "./admin-trends-lifecycle.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const revisionSchema = z.string().min(1).max(100)
const startBody = z.strictObject({ revision: revisionSchema })
const approveBody = z.strictObject({ jobId: z.string().regex(UUID_RE, "Not a job id."), revision: revisionSchema })
const revisionQuery = z.object({ revision: revisionSchema })
/**
 * Recording a started job re-reads the draft and tries again this often when
 * another write wins, waiting a little longer each time (25 ms, doubling).
 */
const RECORD_ATTEMPTS = 6
const RECORD_BACKOFF_MS = 25
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface TrendFaceMaskDeps {
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

/** Every recorded environment, or null (logged) when they cannot be read. */
async function environmentsOrNull(req: FastifyRequest): Promise<EngineEnvironment[] | null> {
  try {
    return await listEngineEnvironments()
  } catch (e) {
    req.log.warn({ err: e }, "admin-trends: could not read the engine environments; face mask recipes unchecked")
    return null
  }
}

/**
 * The draft's face mask state, against every environment's engine. A failed
 * read of the environments leaves their recipes unchecked (logged): the
 * editor still opens, and publishing reads them again and refuses on an outage.
 */
export async function draftFaceMaskState(req: FastifyRequest, draft: TrendVersionData): Promise<FaceMaskState> {
  return faceMaskState(draft, await environmentsOrNull(req), TREND_PUBLISH_ENVIRONMENTS)
}

/** The caller's own job `jobId`, or null. Throws on a database error. */
async function ownJob(jobId: string, userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, user_id, status, input_data, output_data")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Could not read job ${jobId}: ${error.message}`)
  return isRec(data) && data.user_id === userId ? data : null
}

/**
 * The settings key a face mask job of trend `trendId` was started for, from
 * the caller's own `make_trend_face_mask` audit row of it, or null. Only for
 * a job the draft could not record (`recorded: false`). Throws on a database error.
 */
async function auditedSettingsKey(trendId: string, jobId: string, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("admin_actions")
    .select("payload")
    .eq("action", "make_trend_face_mask")
    .eq("target_type", "trend")
    .eq("target_id", trendId)
    .eq("admin_user_id", userId)
    .filter("payload->>jobId", "eq", jobId)
    .limit(1)
  if (error) throw new Error(`Could not read the face mask's start: ${error.message}`)
  const payload = (data as Array<{ payload?: unknown }> | null)?.[0]?.payload
  return isRec(payload) && payload.jobId === jobId ? str(payload.settingsKey) : null
}

export function registerTrendFaceMaskRoutes(app: FastifyInstance, deps: TrendFaceMaskDeps): void {
  app.post("/v1/admin/trends/:id/face-mask", { preHandler: requireAdmin }, async (req, reply) => {
    const body = startBody.safeParse(req.body)
    if (!body.success) return deps.badRequest(reply, body.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      // Before anything is paid for: a stale screen reloads first.
      if (revision !== body.data.revision) return deps.draftConflict(reply)
      if (!draft.source) return err(reply, 409, "source_missing", "Add a source clip and save the draft first.")
      if (!faceMaskingOn(draft.faceMasking)) {
        return err(reply, 409, "face_masking_off", "This trend does not mask faces: turn face masking on and save the draft first.")
      }
      if (getPluginSupports().castSwap?.storedFaceMask !== true) {
        return err(reply, 503, "engine_unsupported", "This environment's Cast Swap engine cannot make a stored face mask yet.")
      }
      // An engine that does not declare the target strips it and masks heads: a face-only mask made
      // there would be stored under the face-only settings key, so it is refused before anything is paid.
      if (!loadedEngineMasksTarget(faceMaskTargetOf(draft.faceMasking))) {
        return err(reply, 503, "engine_unsupported", "This environment's Cast Swap engine cannot mask the face alone yet: choose Head, or wait for the engine.")
      }
      const settingsKey = faceMaskSettingsKey(draft)!
      // The job is paid for once the engine is asked: the draft that records it must save, so it is
      // checked first (with a stand-in job), and a draft that cannot is refused before anything is paid.
      const placeholder = { jobId: "00000000-0000-4000-8000-000000000000", settingsKey, startedAt: new Date().toISOString() }
      const valid = trendVersionDataSchema.safeParse({ ...draft, faceMaskJob: placeholder })
      if (!valid.success) return deps.badRequest(reply, valid.error)
      const key = req.headers["idempotency-key"]
      const res = await engineRequest(
        app,
        req,
        "/v1/cast-swap/face-mask",
        // The settings as a run sends them, so the mask is the one a run would make.
        { videoUrl: draft.source.videoUrl, faceMasking: withResolvedZone(draft.faceMasking) },
        typeof key === "string" && key ? { "idempotency-key": key } : {},
        { origin: "trends-admin", source: deriveJobSource(req) },
      )
      if (res.statusCode < 200 || res.statusCode >= 300) return relay(reply, res)
      const jobId = jobIdOf(res.body)
      if (!jobId) return err(reply, 502, "engine_error", "Nodaro Motion did not return a job id.")
      await audit(req, "make_trend_face_mask", "trend", trend.id, { slug: trend.slug, jobId, settingsKey })

      // The job is paid for: record it on the draft even when another write
      // landed meanwhile (re-read, keep that write), and say so (`draftMoved`).
      // Should it never land, the job is still approvable: approve finds its
      // settings key in the audit row written above (`recorded: false`).
      const faceMaskJob = { ...placeholder, jobId, startedAt: new Date().toISOString() }
      let current = { data: draft, revision }
      for (let attempt = 0; attempt < RECORD_ATTEMPTS; attempt++) {
        if (attempt > 0) await pause(RECORD_BACKOFF_MS * 2 ** (attempt - 1))
        const parsed = trendVersionDataSchema.safeParse({ ...current.data, faceMaskJob })
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
      req.log.warn({ jobId, trendId: trend.id }, "admin-trends: the face mask job started but could not be recorded on the draft")
      return reply.status(202).send({ data: { jobId, recorded: false, draftMoved: true } })
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to start the face mask")
    }
  })

  app.post("/v1/admin/trends/:id/face-mask/approve", { preHandler: requireAdmin }, async (req, reply) => {
    const body = approveBody.safeParse(req.body)
    if (!body.success) return deps.badRequest(reply, body.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      if (revision !== body.data.revision) return deps.draftConflict(reply)
      // What the job was made from: the draft's record of it, else (a start that could not record
      // it) the caller's own audit row of that start for this trend.
      const pending = draft.faceMaskJob
      const madeFrom =
        pending && pending.jobId === body.data.jobId ? pending.settingsKey : await auditedSettingsKey(trend.id, body.data.jobId, req.userId!)
      if (madeFrom === null) {
        return err(reply, 409, "not_pending_face_mask", "That is not this trend's face mask in the making. Make the face mask here.")
      }
      const settingsKey = faceMaskSettingsKey(draft)
      if (settingsKey === null || madeFrom !== settingsKey) {
        return err(reply, 409, "face_mask_settings_changed", "This mask was made from another source clip or other face masking settings. Make it again.")
      }

      const job = await ownJob(body.data.jobId, req.userId!)
      if (!job) return err(reply, 404, "not_found", "Face mask job not found")
      const input = isRec(job.input_data) ? job.input_data : {}
      if (input.type !== FACE_MASK_JOB_TYPE) return err(reply, 409, "not_a_face_mask", "That job is not a face mask.")
      if (job.status !== "completed") return err(reply, 409, "not_completed", "Only a finished face mask can be approved.")
      const output = isRec(job.output_data) ? job.output_data : {}
      const maskedUrl = str(output.maskedUrl)
      if (!maskedUrl) {
        return err(reply, 409, "no_mask", output.reason === "no_faces" ? "No face was found to cover, so there is no mask to approve." : "This job has no masked clip.")
      }
      const frames = output.frames
      const recipe = isRec(output.recipe) ? output.recipe : {}
      const plugin = str(recipe.plugin)
      if (typeof frames !== "number" || !Number.isInteger(frames) || frames <= 0 || !plugin) {
        return err(reply, 409, "no_mask", "This job's result is incomplete.")
      }
      const candidate: TrendFaceMask = {
        url: maskedUrl,
        frames,
        // A mask whose Video Mask step reported no recipe is null: out of date, refused below.
        recipe: { core: str(recipe.core), plugin },
        settingsKey,
        jobId: str(job.id) ?? body.data.jobId,
        stats: faceMaskStats(output.stats),
        approvedAt: new Date().toISOString(),
        approvedBy: req.userId!,
      }
      // Stale on arrival helps no one: the recipes are checked before anything is stored.
      const environments = await environmentsOrNull(req)
      const arriving = faceMaskState({ ...draft, faceMask: candidate }, environments, TREND_PUBLISH_ENVIRONMENTS)
      if (arriving.status === "out_of_date") {
        return err(reply, 409, "face_mask_out_of_date", "This mask was made by an older way of masking faces. Make it again.")
      }

      const stored = await copyToTrendStorage(trend.id, maskedUrl, "video")
      const faceMask: TrendFaceMask = { ...candidate, url: stored.url }
      // The pending job is done once approved; another (newer) pending job stays.
      const { faceMaskJob: _done, ...rest } = draft
      const next: TrendVersionData = { ...(pending && pending.jobId !== faceMask.jobId ? draft : rest), faceMask }
      const saved = await deps.saveValidDraft(reply, trend.id, next, revision)
      if (!saved) return reply
      await audit(req, "approve_trend_face_mask", "trend", trend.id, { slug: trend.slug, jobId: faceMask.jobId, url: faceMask.url })
      return { data: { ...saved, faceMask, faceMaskState: faceMaskState(next, environments, TREND_PUBLISH_ENVIRONMENTS) } }
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      if (e instanceof TrendMediaError) return err(reply, 400, e.code, e.message)
      return unavailableOrInternal(reply, req, e, "Failed to approve the face mask")
    }
  })

  app.delete("/v1/admin/trends/:id/face-mask", { preHandler: requireAdmin }, async (req, reply) => {
    const query = revisionQuery.safeParse(req.query)
    if (!query.success) return deps.badRequest(reply, query.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      if (revision !== query.data.revision) return deps.draftConflict(reply)
      if (!draft.faceMask) return { data: { version: trend.draftVersion, revision, faceMaskState: faceMaskState(draft, null, []) } }
      // The pointer only: the file stays, a published version may still point at it.
      const { faceMask: removed, ...rest } = draft
      const saved = await deps.saveValidDraft(reply, trend.id, rest, revision)
      if (!saved) return reply
      await audit(req, "clear_trend_face_mask", "trend", trend.id, { slug: trend.slug, jobId: removed.jobId, url: removed.url })
      return { data: { ...saved, faceMaskState: faceMaskState(rest, null, []) } }
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to clear the face mask")
    }
  })
}
