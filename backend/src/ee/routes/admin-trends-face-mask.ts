/**
 * A trend's stored face mask (decided 2026-10-25). Registered by
 * `adminTrendsRoutes` (admin-trends.ts), so it shares its `requireAdmin` door
 * and its edition gate; every route here is admin-only.
 *
 *   POST   /v1/admin/trends/:id/face-mask            { revision }: mask the draft's whole source clip once → 202
 *   POST   /v1/admin/trends/:id/face-mask/approve    { jobId, revision }: store that mask on the draft
 *   DELETE /v1/admin/trends/:id/face-mask?revision=  clear the draft's face mask
 *   PUT    /v1/admin/trends/:id/face-mask/scene-description  edit a full-depth clip's stored description
 *          (admin-trends-face-mask-scene.ts)
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
 * Source modes (`faceMasking.source`): a full-depth or keep-people clip is made
 * the same way (one make, approved and stored), sent as that mode reads it
 * (`faceMaskingSent`) with its make's marks (keep people: erased and main,
 * `makeMarksOf`), and held back unless the loaded engine declares the mode
 * (`castSwap.sourceModes`), its target (`faceMaskTargets`, keep people's
 * `"body"`) and a main mark's label (`faceMaskMarkLabels`). A face mask
 * (absent or `"faces"`) needs none of them.
 *
 * Marks (`faceMasking.marks`, decided 2026-10-26): a make sends the `"erased"`
 * ones to the engine, which leaves their faces out of the mask; slot marks
 * (`{ slot }`, decided 2026-10-27) are never sent — they shape the per-person
 * variants only (admin-trends-face-mask-variants.ts, registered here). One
 * with erased marks is held back unless the loaded engine declares
 * `castSwap.faceMaskErase`. When the approved mask is a reusable base
 * (`reusableFaceMaskBase`: made from the draft's current settings without the
 * marks, by the masking that runs now, with its raw mask kept), the make
 * sends it as `fromMask` and the engine skips finding the faces again.
 * Approving keeps the job's raw mask (`maskUrl`) and depth view (`depthUrl`)
 * in the trend's storage, with the base key they were made from.
 *
 * Approving takes the draft's own pending job only: the caller's, a finished
 * `cast-swap-face-mask` job with a masked clip, made from the draft's CURRENT
 * source and settings, and not out of date on arrival (Video Mask's recipe,
 * every known environment's engine recipe). It copies the masked clip into the
 * trend's storage, writes `data.faceMask` and clears `faceMaskJob` (guarded on
 * the draft's revision). Clearing removes the pointer only: the stored file
 * stays, since a published version may still point at it. Both cut the
 * preview's input clip again (`ensurePreviewClip`): approving adds the
 * mask's matching cut to it, clearing takes it away.
 *
 * Each action writes an `admin_actions` row.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { deriveJobSource } from "../../lib/job-source.js"
import { faceMaskMarksOf, faceMaskTargetOf, faceMaskingOn, faceMaskingSent, faceMaskingSourceOf, loadedEngineMasksTarget, makeMarksOf, withoutMarks } from "../../lib/cast-swap-face-masking.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { TREND_PUBLISH_ENVIRONMENTS, listEngineEnvironments, type EngineEnvironment } from "../lib/engine-environments.js"
import { DraftConflictError, getDraftState, saveDraft } from "../lib/trends/store.js"
import { trendVersionDataSchema } from "../lib/trends/schemas.js"
import { TrendMediaError, copyToTrendStorage, isTransientMediaFailure } from "../lib/trends/media.js"
import { ensurePreviewClip } from "../lib/trends/preview-clip-media.js"
import {
  FACE_MASK_JOB_TYPE,
  faceMaskBaseKey,
  faceMaskHasErasedMarks,
  faceMaskMarksMatch,
  faceMaskSettingsKey,
  faceMaskState,
  faceMaskBaseStats,
  faceMaskStats,
  reusableFaceMaskBase,
  type FaceMaskState,
} from "../lib/trends/face-mask.js"
import { engineRequest, isRec, jobIdOf, relay, str, unavailableOrInternal } from "../lib/trends/run-helpers.js"
import type { TrendFaceMask, TrendFaceMaskVariantJob, TrendRow, TrendVersionData } from "../lib/trends/types.js"
import { keptVariantsFor, withCurrentVariants, type FaceMaskVariantsState } from "../lib/trends/face-mask-variants.js"
import { sceneDescriptionsOf, sceneMakeFields } from "../lib/trends/scene-description.js"
import { audit } from "./admin-trends-lifecycle.js"
import { registerTrendSceneDescriptionRoutes } from "./admin-trends-face-mask-scene.js"
import { SUPERSEDED, closeAbandonedVariantJobs, registerTrendFaceMaskVariantRoutes, withVariantsState } from "./admin-trends-face-mask-variants.js"

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
export async function draftFaceMaskState(req: FastifyRequest, draft: TrendVersionData): Promise<FaceMaskState & { variants?: FaceMaskVariantsState }> {
  return withVariantsState(draft, faceMaskState(draft, await environmentsOrNull(req), TREND_PUBLISH_ENVIRONMENTS))
}

/** Whether this environment's Cast Swap engine makes a stored face mask with marks (the editor offers them only then). */
export function loadedEngineMakesMarks(): boolean {
  const cs = getPluginSupports().castSwap
  return cs?.storedFaceMask === true && cs.faceMaskErase === true
}

/**
 * `data` with its face mask marks dropped when its source clip is not the
 * stored draft's (decided 2026-10-26): a mark's frames and box belong to the
 * clip it was drawn on. `cleared` when there were marks to drop. A 1080p
 * upscale of the same clip keeps them: it is applied by the upscale routes
 * (same frames, same picture), never through a draft save.
 *
 * Its person variants are then held to the sets a run can leave empty now
 * (`withCurrentVariants`, decided 2026-10-27): a draft save that changes the
 * marks, the slots or the examples drops the variants no run can use and the
 * jobs in the making for them or for older marks. `abandoned`: those jobs,
 * which the caller closes once the save lands (`closeAbandonedVariantJobs`).
 */
export function withMarksForSource(data: TrendVersionData, stored: TrendVersionData): { data: TrendVersionData; cleared: boolean; abandoned: TrendFaceMaskVariantJob[] } {
  const masking = data.faceMasking
  const cleared = !!masking && faceMaskMarksOf(masking).length > 0 && data.source?.videoUrl !== stored.source?.videoUrl
  const marked = cleared ? { ...data, faceMasking: withoutMarks(masking!) } : data
  const { data: next, abandoned } = withCurrentVariants(marked)
  return { data: next, cleared, abandoned }
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
  registerTrendFaceMaskVariantRoutes(app, deps)
  registerTrendSceneDescriptionRoutes(app, deps)
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
      const castSwap = getPluginSupports().castSwap
      if (castSwap?.storedFaceMask !== true) {
        return err(reply, 503, "engine_unsupported", "This environment's Cast Swap engine cannot make a stored face mask yet.")
      }
      // A depth mode an engine does not declare: it would strip `source` and make a face mask, stored
      // under the depth mode's settings key. Refused before anything is paid (a face mask needs nothing).
      const source = faceMaskingSourceOf(draft.faceMasking)
      if (source !== "faces" && !(castSwap.sourceModes ?? []).includes(source)) {
        return err(reply, 503, "engine_unsupported", "This environment's Cast Swap engine cannot prepare the clip this way yet: choose Faces hidden, or wait for the engine.")
      }
      // An engine that does not declare marks strips them and masks every face: refused before anything is paid.
      const takesMarks = castSwap.faceMaskErase === true
      const marks = makeMarksOf(draft.faceMasking)
      if (marks.length > 0 && !takesMarks) {
        return err(reply, 503, "engine_unsupported", "This environment's Cast Swap engine cannot leave faces unmasked yet: remove the marks, or wait for the engine.")
      }
      // A main mark an engine does not declare it takes (absent = erased only): refused before anything is paid.
      if (marks.some((m) => m.label === "main") && !(castSwap.faceMaskMarkLabels ?? ["erased"]).includes("main")) {
        return err(reply, 503, "engine_unsupported", "This environment's Cast Swap engine cannot keep a main character yet: remove the main marks, or wait for the engine.")
      }
      // An engine that does not declare the target strips it and masks heads: a face-only (or whole-person)
      // mask made there would be stored under that target's settings key, so it is refused before anything is paid.
      const target = faceMaskTargetOf(draft.faceMasking)
      if (target !== null && !loadedEngineMasksTarget(target)) {
        return err(
          reply,
          503,
          "engine_unsupported",
          target === "body"
            ? "This environment's Cast Swap engine cannot keep whole people yet: choose Head or Face, or wait for the engine."
            : "This environment's Cast Swap engine cannot mask the face alone yet: choose Head, or wait for the engine.",
        )
      }
      const settingsKey = faceMaskSettingsKey(draft)!
      // The job is paid for once the engine is asked: the draft that records it must save, so it is
      // checked first (with a stand-in job), and a draft that cannot is refused before anything is paid.
      const placeholder = { jobId: "00000000-0000-4000-8000-000000000000", settingsKey, startedAt: new Date().toISOString() }
      const valid = trendVersionDataSchema.safeParse({ ...draft, faceMaskJob: placeholder })
      if (!valid.success) return deps.badRequest(reply, valid.error)
      const key = req.headers["idempotency-key"]
      // The settings as a run sends them (`faceMaskingSent`: a face mask exactly as before source modes
      // existed), so the mask is the one a run would make, plus the make's marks (only when there are
      // some: a setting without is sent exactly as before marks existed). Slot marks never reach a base
      // make: they never shape the base.
      const faceMasking = { ...faceMaskingSent(withoutMarks(draft.faceMasking)), ...(marks.length > 0 ? { marks: structuredClone([...marks]) } : {}) }
      // The approved mask's raw mask, when it is still the base of this one: no new face finding.
      const fromMask = takesMarks ? reusableFaceMaskBase(draft, castSwap.faceMaskRecipe) : undefined
      // Full depth on an engine that describes the original clip as it makes it: the roles to name
      // its people by, and the preview's start (scene-description.ts). Any other make is sent as before.
      const describe = source === "full-depth" && castSwap.storedSceneDescription === true ? sceneMakeFields(draft) : {}
      const res = await engineRequest(
        app,
        req,
        "/v1/cast-swap/face-mask",
        { videoUrl: draft.source.videoUrl, faceMasking, ...(fromMask ? { fromMask } : {}), ...describe },
        typeof key === "string" && key ? { "idempotency-key": key } : {},
        { origin: "trends-admin", source: deriveJobSource(req) },
      )
      if (res.statusCode < 200 || res.statusCode >= 300) return relay(reply, res)
      const jobId = jobIdOf(res.body)
      if (!jobId) return err(reply, 502, "engine_error", "Nodaro Motion did not return a job id.")
      await audit(req, "make_trend_face_mask", "trend", trend.id, { slug: trend.slug, jobId, settingsKey, ...(fromMask ? { fromMask: true } : {}) })

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
      // Made with the draft's erased marks, as the engine recorded them: one that dropped them would cover
      // the faces they leave out (the settings key above is the platform's record, not the engine's).
      const madeWith = isRec(input.faceMasking) ? input.faceMasking.marks : undefined
      if (!faceMaskMarksMatch(madeWith, makeMarksOf(draft.faceMasking))) {
        return err(reply, 409, "face_mask_settings_changed", "This mask was not made with the trend's marks. Make it again.")
      }
      // Made in the trend's clip preparation, as the engine recorded it: an older engine strips a
      // `source` it does not know and makes a face mask, which must never be stored as a depth clip.
      const madeSource = isRec(input.faceMasking) ? (input.faceMasking.source ?? "faces") : "faces"
      const source = faceMaskingSourceOf(draft.faceMasking)
      if (madeSource !== source) {
        return err(reply, 409, "face_mask_source_mismatch", "This clip was not prepared the way the trend asks. Make it again.")
      }
      if (job.status !== "completed") return err(reply, 409, "not_completed", "Only a finished face mask can be approved.")
      const output = isRec(job.output_data) ? job.output_data : {}
      const maskedUrl = str(output.maskedUrl)
      if (!maskedUrl) {
        return err(reply, 409, "no_mask", output.reason === "no_faces" ? "No face was found to cover, so there is no mask to approve." : "This job has no masked clip.")
      }
      // With marks, a mask only an engine that erases makes: its raw mask and its count of faces left
      // unmasked (an older engine, mid-deploy, reports neither — its mask covers the faces the marks leave out).
      if (faceMaskHasErasedMarks(draft)) {
        const stats = isRec(output.stats) ? output.stats : {}
        if (!str(output.maskUrl) || typeof stats.erasedRegions !== "number" || !Number.isFinite(stats.erasedRegions)) {
          return err(reply, 409, "face_mask_not_erased", "This mask was not made by an engine that leaves faces unmasked. Make it again.")
        }
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
        // Full depth: the make's descriptions of the original clip, trimmed and capped (scene-description.ts).
        ...(source === "full-depth" ? sceneDescriptionsOf(output, input) : {}),
      }
      // Stale on arrival helps no one: the recipes are checked before anything is stored.
      const environments = await environmentsOrNull(req)
      const arriving = faceMaskState({ ...draft, faceMask: candidate }, environments, TREND_PUBLISH_ENVIRONMENTS)
      if (arriving.status === "out_of_date") {
        return err(reply, 409, "face_mask_out_of_date", "This mask was made by an older way of masking faces. Make it again.")
      }

      const stored = await copyToTrendStorage(trend.id, maskedUrl, "video")
      // The raw mask (and depth view) the next edit of the marks starts from, kept beside it. One the
      // job re-used from the approved mask is already in the trend's storage: kept as it is.
      const kept = async (url: string | null, already: string | undefined): Promise<string | undefined> =>
        url === null ? undefined : url === already ? already : (await copyToTrendStorage(trend.id, url, "video")).url
      // A full-depth clip has no raw mask to start a later make from: it is always made whole.
      const rawMaskUrl = source === "full-depth" ? undefined : await kept(str(output.maskUrl), draft.faceMask?.rawMaskUrl)
      const depthUrl = rawMaskUrl ? await kept(str(output.depthUrl), draft.faceMask?.depthUrl) : undefined
      const baseKey = rawMaskUrl ? faceMaskBaseKey(draft) : null
      const baseStats = faceMaskBaseStats(output.baseStats)
      const made: TrendFaceMask = {
        ...candidate,
        url: stored.url,
        // The masked clip's video frame rate, as stored: what the editor counts a mark's frames on.
        ...(stored.fps ? { fps: stored.fps } : {}),
        ...(rawMaskUrl && baseKey ? { rawMaskUrl, baseKey, ...(depthUrl ? { depthUrl } : {}) } : {}),
        ...(rawMaskUrl && baseStats ? { baseStats } : {}),
      }
      // The person variants (and those in the making) still made from this very base and marks
      // stay; every other one was made from another mask (face-mask-variants.ts).
      const faceMask: TrendFaceMask = { ...made, ...keptVariantsFor({ ...draft, faceMask: made }, draft) }
      // The pending job is done once approved; another (newer) pending job stays.
      const { faceMaskJob: _done, ...rest } = draft
      const withMask: TrendVersionData = { ...(pending && pending.jobId !== faceMask.jobId ? draft : rest), faceMask }
      const valid = trendVersionDataSchema.safeParse(withMask)
      if (!valid.success) return deps.badRequest(reply, valid.error)
      // The preview's input clip, cut again with this mask's matching cut beside it.
      const next = await ensurePreviewClip(trend.id, valid.data)
      const saved = await deps.saveValidDraft(reply, trend.id, next, revision)
      if (!saved) return reply
      await audit(req, "approve_trend_face_mask", "trend", trend.id, { slug: trend.slug, jobId: faceMask.jobId, url: faceMask.url })
      // Person masks in the making for the mask this one replaced: no longer followed, so their jobs are closed.
      const followed = new Set((faceMask.variantJobs ?? []).map((j) => j.jobId))
      await closeAbandonedVariantJobs((draft.faceMask?.variantJobs ?? []).filter((j) => !followed.has(j.jobId)), SUPERSEDED)
      return { data: { ...saved, faceMask, faceMaskState: withVariantsState(next, faceMaskState(next, environments, TREND_PUBLISH_ENVIRONMENTS)) } }
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      if (e instanceof TrendMediaError) {
        if (e.cause !== undefined) req.log.warn({ err: e.cause, trendId: (req.params as { id: string }).id }, "admin-trends: the media could not be read or re-encoded")
        return err(reply, 400, e.code, e.message)
      }
      if (isTransientMediaFailure(e)) return err(reply, 503, "media_busy", "The video could not be processed right now. Try again in a moment.")
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
      // The preview's input clip, cut again without the mask's cut beside it.
      const next = await ensurePreviewClip(trend.id, rest)
      const saved = await deps.saveValidDraft(reply, trend.id, next, revision)
      if (!saved) return reply
      await audit(req, "clear_trend_face_mask", "trend", trend.id, { slug: trend.slug, jobId: removed.jobId, url: removed.url })
      await closeAbandonedVariantJobs(removed.variantJobs ?? [], "The face mask was removed, so this person mask was not finished.")
      return { data: { ...saved, faceMaskState: withVariantsState(next, faceMaskState(next, null, [])) } }
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      if (e instanceof TrendMediaError) {
        if (e.cause !== undefined) req.log.warn({ err: e.cause, trendId: (req.params as { id: string }).id }, "admin-trends: the media could not be read or re-encoded")
        return err(reply, 400, e.code, e.message)
      }
      if (isTransientMediaFailure(e)) return err(reply, 503, "media_busy", "The video could not be processed right now. Try again in a moment.")
      return unavailableOrInternal(reply, req, e, "Failed to clear the face mask")
    }
  })
}
