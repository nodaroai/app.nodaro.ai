/**
 * A trend's per-person face mask variants (decided 2026-10-27;
 * face-mask-variants.ts). Registered by `registerTrendFaceMaskRoutes`, so it
 * shares its `requireAdmin` door and its edition gate; admin-only.
 *
 *   POST /v1/admin/trends/:id/face-mask/variants          { revision }: make every variant not yet made → 202
 *   POST /v1/admin/trends/:id/face-mask/variants/advance  { revision }: move each one in the making on
 *
 * Making one: the variant's own job (`trend-face-mask-variant`, the admin's,
 * private, never queued: its steps are its children) is written and RECORDED
 * on the draft before anything is paid (a set already in the making is never
 * started again, so a double click pays once), then the core `mask-erase` job
 * is asked for as its CHILD (internal, the variant's job in the server-only
 * scope, as the mask-erase door requires) on the approved mask's raw mask with
 * the variant's eraseAlways, erase and keep boxes. Advancing reads the
 * steps (`nextVariantStep`): once the erase is done, the engine's face-mask
 * make (`POST /v1/cast-swap/face-mask`, `fromMask` = the erased mask, no
 * marks) fills it exactly as the base was filled; once that is done, the clip
 * is copied into the trend's storage and the variant is stored on the face
 * mask, APPROVED as it finishes (the admin can still play it). Every step
 * bills the admin, as the base make's do; a step is asked for with an
 * idempotency key of the variant's job, so a repeated advance pays once. The
 * editor advances while any is in the making. The steps are read as the
 * variant job's OWNER (the admin who started it): only the owner asks for a
 * paid step; any admin may record a finished or failed one. A variant's job
 * that is no longer followed (replaced, made for older marks, its face mask
 * gone, never recorded) is closed as failed. Each advance touches a variant
 * job's idle clock, and only one nobody advanced for a day is closed by
 * reconcile (trend-variant-anchor-sweep.ts): an admin away for hours loses no
 * paid step.
 *
 * Only a trend whose runs can leave a marked person empty needs variants (no
 * examples), at most `MAX_MARKED_PEOPLE` marked people, and an approved,
 * up-to-date face mask that kept its raw mask. Each action writes an
 * `admin_actions` row.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { WORKSPACE_HEADER_LOWER } from "@nodaro/shared/organizations"
import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { deriveJobSource } from "../../lib/job-source.js"
import { insertSyncJob } from "../../lib/insert-job.js"
import { buildJobInputData } from "../../lib/job-input-data.js"
import { markJobFailed } from "../../lib/job-failure.js"
import { markJobCompleted } from "../../workers/shared.js"
import { TREND_VARIANT_ANCHOR_TYPE, touchTrendVariantAnchor } from "../../lib/reconcile/trend-variant-anchor-sweep.js"
import { withJobSubmissionContext } from "../../lib/job-submission-context.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { withResolvedZone, withoutMarks } from "../../lib/cast-swap-face-masking.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { TREND_PUBLISH_ENVIRONMENTS, listEngineEnvironments } from "../lib/engine-environments.js"
import { DraftConflictError, getDraftState, saveDraft } from "../lib/trends/store.js"
import { trendVersionDataSchema } from "../lib/trends/schemas.js"
import { TrendMediaError, copyToTrendStorage } from "../lib/trends/media.js"
import { faceMaskState, reusableFaceMaskBase } from "../lib/trends/face-mask.js"
import {
  MAX_MARKED_PEOPLE,
  faceMaskVariantBoxes,
  faceMaskVariantKey,
  faceMaskVariantsState,
  sameSlots,
  withCurrentVariants,
} from "../lib/trends/face-mask-variants.js"
import { eraseStatsOf, nextVariantStep, type VariantStepJob } from "../lib/trends/face-mask-variant-steps.js"
import { engineRequest, isRec, jobIdOf, unavailableOrInternal } from "../lib/trends/run-helpers.js"
import type { TrendFaceMask, TrendFaceMaskVariant, TrendFaceMaskVariantJob, TrendVersionData } from "../lib/trends/types.js"
import { audit } from "./admin-trends-lifecycle.js"
import type { TrendFaceMaskDeps } from "./admin-trends-face-mask.js"

/** The variant's own job type (`input_data.type`): an anchor for its steps, never queued. */
export const FACE_MASK_VARIANT_JOB_TYPE = TREND_VARIANT_ANCHOR_TYPE

const revisionBody = z.strictObject({ revision: z.string().min(1).max(100) })
const SAVE_ATTEMPTS = 6
const SAVE_BACKOFF_MS = 25
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const TERMINAL_FAILED = new Set(["failed", "cancelled"])

function err(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } })
}

type JobRow = VariantStepJob & { id: string; user_id: string }

/** Job `jobId` (owner, status, output, error) — of `ownerId` when given — or null. Throws on a database error. */
async function jobRow(jobId: string | undefined, ownerId?: string): Promise<JobRow | null> {
  if (!jobId) return null
  let query = supabase.from("jobs").select("id, user_id, status, output_data, error_message").eq("id", jobId)
  if (ownerId) query = query.eq("user_id", ownerId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`Could not read job ${jobId}: ${error.message}`)
  if (!isRec(data) || typeof data.status !== "string" || typeof data.user_id !== "string") return null
  return ownerId && data.user_id !== ownerId ? null : (data as unknown as JobRow)
}

/**
 * A core route reached as a CHILD of `parentJobId`, as the caller: internal
 * auth, the parent in the server-only submission scope (never a header or
 * the body), the caller's workspace as the payer.
 */
function childRequest(app: FastifyInstance, req: FastifyRequest, url: string, payload: object, parentJobId: string, idempotencyKey: string) {
  const userId = req.userId!
  return withJobSubmissionContext({ userId, method: "POST", url, parentJobId }, () =>
    app.inject({
      method: "POST",
      url,
      headers: {
        "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        "x-internal-user-id": userId,
        ...(req.workspaceId ? { [WORKSPACE_HEADER_LOWER]: req.workspaceId } : {}),
        "idempotency-key": idempotencyKey,
        "content-type": "application/json",
      },
      payload: payload as Record<string, unknown>,
    }),
  )
}

/** The variant's mask erase, asked as a child of its own job (keyed by it: asking again returns the same job). */
async function askErase(app: FastifyInstance, req: FastifyRequest, draft: TrendVersionData, job: TrendFaceMaskVariantJob) {
  const { eraseAlways, erase, keep } = faceMaskVariantBoxes(draft, job.emptySlots)
  const payload = {
    maskUrl: draft.faceMask!.rawMaskUrl,
    erase,
    ...(keep.length > 0 ? { keep } : {}),
    ...(eraseAlways.length > 0 ? { eraseAlways } : {}),
    forcePrivate: true,
  }
  const res = await childRequest(app, req, "/v1/mask-erase", payload, job.jobId, `${FACE_MASK_VARIANT_JOB_TYPE}:${job.jobId}:erase`)
  return { res, eraseJobId: res.statusCode >= 200 && res.statusCode < 300 ? jobIdOf(res.body) : null }
}

/** The draft's face mask state with its variants, against every environment's engine (a failed read: recipes unchecked). */
export async function faceMaskStateWithVariants(req: FastifyRequest, draft: TrendVersionData) {
  let environments = null
  try {
    environments = await listEngineEnvironments()
  } catch (e) {
    req.log.warn({ err: e }, "admin-trends: could not read the engine environments; face mask recipes unchecked")
  }
  return withVariantsState(draft, faceMaskState(draft, environments, TREND_PUBLISH_ENVIRONMENTS))
}

/** `state` plus the draft's person variants, when it has marked people. */
export function withVariantsState<T extends object>(draft: TrendVersionData, state: T): T & { variants?: ReturnType<typeof faceMaskVariantsState> } {
  const variants = faceMaskVariantsState(draft)
  return variants.people.length > 0 ? { ...state, variants } : state
}

/**
 * Close the own jobs of person masks no longer followed (made for older marks
 * or another face mask, or the face mask cleared): failed with `why`, so none
 * stays `processing` for good (no worker ever picks such a job up). One
 * already ended is left as it is. Their steps already paid stay paid.
 */
export async function closeAbandonedVariantJobs(jobs: readonly Pick<TrendFaceMaskVariantJob, "jobId" | "error">[], why: string): Promise<void> {
  for (const job of jobs) {
    if (!job.error) await markJobFailed(job.jobId, { error_message: why })
  }
}

/** Why a person mask in the making is no longer followed. */
export const SUPERSEDED = "This person mask was made for older face marks or another face mask: it was replaced."
const NOT_RECORDED = "This person mask was not recorded on the trend (another start made it, or the trend changed): nothing was asked for."

/**
 * Save `edit(faceMask, draft)` on the draft at `revision`, re-reading and
 * applying it again when another write wins, as long as the draft still holds
 * the same approved mask (`baseJobId`). The variants are then held to the
 * sets a run can leave empty (`withCurrentVariants`), and the jobs that drops
 * are closed. Null when the mask changed under it.
 */
async function saveFaceMaskEdit(
  trendId: string,
  start: { data: TrendVersionData; revision: string },
  baseJobId: string,
  edit: (mask: TrendFaceMask, draft: TrendVersionData) => TrendFaceMask,
): Promise<{ data: TrendVersionData; saved: { version: number; revision: string } } | null> {
  let current = start
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    if (attempt > 0) await pause(SAVE_BACKOFF_MS * 2 ** (attempt - 1))
    const mask = current.data.faceMask
    if (!mask || mask.jobId !== baseJobId) return null
    // Held to the current sets before the edit (so it never replaces a record it would not see) and after.
    const before = withCurrentVariants(current.data)
    const next = withCurrentVariants({ ...before.data, faceMask: edit(before.data.faceMask!, before.data) })
    const parsed = trendVersionDataSchema.safeParse(next.data)
    if (!parsed.success) throw new Error(`A face mask variant edit does not validate: ${parsed.error.issues[0]?.message ?? "invalid"}`)
    try {
      const saved = await saveDraft(trendId, parsed.data, { expectedRevision: current.revision })
      await closeAbandonedVariantJobs([...before.abandoned, ...next.abandoned], SUPERSEDED)
      return { data: parsed.data, saved }
    } catch (e) {
      if (!(e instanceof DraftConflictError)) throw e
      const fresh = await getDraftState(trendId)
      if (!fresh) return null
      current = { data: fresh.data, revision: fresh.revision }
    }
  }
  throw new DraftConflictError(trendId)
}

/** `list` with the entry for `set` replaced by `entry` (or removed when null). A new array; absent when empty. */
function replaceFor<T extends { emptySlots: string[] }>(list: readonly T[] | undefined, set: readonly string[], entry: T | null): T[] | undefined {
  const next = [...(list ?? []).filter((x) => !sameSlots(x.emptySlots, set)), ...(entry ? [entry] : [])]
  return next.length > 0 ? next : undefined
}

function withLists(mask: TrendFaceMask, variants: TrendFaceMaskVariant[] | undefined, variantJobs: TrendFaceMaskVariantJob[] | undefined): TrendFaceMask {
  const { variants: _v, variantJobs: _j, ...rest } = mask
  return { ...rest, ...(variants ? { variants } : {}), ...(variantJobs ? { variantJobs } : {}) }
}

/** `list` with the record of job `jobId` replaced by `fn(record)` (absent: left as it is). */
function updateRecord(list: TrendFaceMaskVariantJob[] | undefined, jobId: string, fn: (j: TrendFaceMaskVariantJob) => TrendFaceMaskVariantJob | null) {
  const next = (list ?? []).flatMap((j) => (j.jobId === jobId ? (fn(j) ?? []) : [j]))
  return next.length > 0 ? next : undefined
}

/** A stored variant read back from its finished job (`output_data.variant`), or null. */
function variantFromJob(row: JobRow, job: TrendFaceMaskVariantJob): TrendFaceMaskVariant | null {
  const v = isRec(row.output_data) ? row.output_data.variant : undefined
  if (!isRec(v) || v.key !== job.key || !Array.isArray(v.emptySlots) || !sameSlots(v.emptySlots as string[], job.emptySlots)) return null
  return v as unknown as TrendFaceMaskVariant
}

export function registerTrendFaceMaskVariantRoutes(app: FastifyInstance, deps: TrendFaceMaskDeps): void {
  app.post("/v1/admin/trends/:id/face-mask/variants", { preHandler: requireAdmin }, async (req, reply) => {
    const body = revisionBody.safeParse(req.body)
    if (!body.success) return deps.badRequest(reply, body.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      if (revision !== body.data.revision) return deps.draftConflict(reply)
      const state = faceMaskVariantsState(draft)
      if (state.people.length === 0) return err(reply, 409, "no_person_marks", "No optional person has face marks: there is no person mask to make.")
      if (state.overCap) {
        return err(reply, 409, "face_mask_people_over_cap", `At most ${MAX_MARKED_PEOPLE} optional people may have face marks. Remove some of their marks first.`)
      }
      if (!state.applies) {
        return err(reply, 409, "person_masks_not_needed", "This trend has examples: an optional person left empty takes an example's person, so no person mask is needed.")
      }
      const base = await faceMaskStateWithVariants(req, draft)
      if (base.status !== "approved" || state.baseProblem === "no_base" || state.baseProblem === "base_out_of_date") {
        return err(reply, 409, "face_mask_not_approved", "Approve an up-to-date face mask first: the person masks are made from it.")
      }
      const castSwap = getPluginSupports().castSwap
      if (castSwap?.storedFaceMask !== true || castSwap.faceMaskErase !== true) {
        return err(reply, 503, "engine_unsupported", "This environment's Cast Swap engine cannot make person masks yet.")
      }
      if (state.baseProblem === "no_raw_mask" || !reusableFaceMaskBase(draft, castSwap.faceMaskRecipe)) {
        return err(reply, 409, "no_raw_mask", "The approved face mask kept no copy from before its marks: make the face mask again first.")
      }
      const mask = draft.faceMask!
      // A set in the making ("making") is never started again: a repeated start pays nothing twice.
      const todo = state.variants.filter((v) => v.status === "missing" || v.status === "out_of_date" || v.status === "failed")
      if (todo.length === 0) return { data: { started: 0, revision, faceMaskState: base } }

      // 1. Each variant's own job, RECORDED on the draft before anything is paid. A record another
      //    start beat (the set already in the making) or the marks moved past is not written, and its
      //    job is closed; so is every job of a start that could not record any.
      const anchors: TrendFaceMaskVariantJob[] = []
      let recorded: TrendFaceMaskVariantJob[] = []
      let result: Awaited<ReturnType<typeof saveFaceMaskEdit>> = null
      try {
        for (const v of todo) {
          const key = faceMaskVariantKey(draft, v.emptySlots)!
          // A job no worker picks up (its steps are its children): written as a settled-in-route row.
          const { data: anchor, error } = await insertSyncJob(req, {
            user_id: req.userId!,
            status: "processing",
            force_private: true,
            input_data: buildJobInputData({ trendId: trend.id, emptySlots: v.emptySlots, key, baseJobId: mask.jobId }, FACE_MASK_VARIANT_JOB_TYPE),
          })
          if (error || !anchor) throw error ?? new Error("Could not write the person mask's job")
          anchors.push({ emptySlots: v.emptySlots, key, jobId: anchor.id, startedAt: new Date().toISOString() })
        }
        result = await saveFaceMaskEdit(trend.id, { data: draft, revision }, mask.jobId, (m, data) => {
          recorded = []
          let jobs = m.variantJobs
          for (const a of anchors) {
            const key = faceMaskVariantKey(data, a.emptySlots)
            const live = jobs?.some((j) => sameSlots(j.emptySlots, a.emptySlots) && !j.error && j.key === key)
            if (live || key !== a.key) continue
            jobs = replaceFor(jobs, a.emptySlots, a)
            recorded.push(a)
          }
          return withLists(m, m.variants, jobs)
        })
      } finally {
        const kept = new Set((result ? recorded : []).map((j) => j.jobId))
        await closeAbandonedVariantJobs(anchors.filter((a) => !kept.has(a.jobId)), NOT_RECORDED)
      }
      if (!result) {
        req.log.warn({ trendId: trend.id }, "admin-trends: the face mask changed before the person masks were recorded; nothing was asked for")
        return reply.status(409).send({ error: { code: "draft_conflict", message: "The face mask changed meanwhile. Reload and try again." } })
      }
      await audit(req, "make_trend_face_mask_variants", "trend", trend.id, { slug: trend.slug, jobIds: recorded.map((j) => j.jobId), sets: recorded.map((j) => j.emptySlots) })

      // 2. Paid from here on: each recorded one's mask erase (keyed by its job: a retry, here or in
      //    advance, gets the same job back).
      const asked: Array<{ jobId: string; eraseJobId: string | null; status: number }> = []
      for (const j of recorded) {
        const { res, eraseJobId } = await askErase(app, req, result.data, j)
        asked.push({ jobId: j.jobId, eraseJobId, status: res.statusCode })
        if (!eraseJobId) await markJobFailed(j.jobId, { error_message: "The mask erase could not be started." })
      }
      const at = new Date().toISOString()
      const second = await saveFaceMaskEdit(trend.id, { data: result.data, revision: result.saved.revision }, mask.jobId, (m) => {
        let jobs = m.variantJobs
        for (const a of asked) {
          jobs = updateRecord(jobs, a.jobId, (j) =>
            a.eraseJobId ? { ...j, eraseJobId: a.eraseJobId } : { ...j, error: { message: `The mask erase could not be started (${a.status}).`, at } },
          )
        }
        return withLists(m, m.variants, jobs)
      }).catch((e: unknown) => {
        // The records stand: advance asks each erase again (the same job) and records it.
        req.log.warn({ err: e, trendId: trend.id }, "admin-trends: the person masks' erases were asked for but not recorded yet")
        return null
      })
      const final = second ?? result
      return reply.status(202).send({
        data: { started: asked.filter((a) => a.eraseJobId).length, recorded: true, ...final.saved, faceMaskState: await faceMaskStateWithVariants(req, final.data) },
      })
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      return unavailableOrInternal(reply, req, e, "Failed to start the person masks")
    }
  })

  app.post("/v1/admin/trends/:id/face-mask/variants/advance", { preHandler: requireAdmin }, async (req, reply) => {
    const body = revisionBody.safeParse(req.body)
    if (!body.success) return deps.badRequest(reply, body.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft, revision } = loaded
      // Records no run can use any more (another set, older marks) are dropped on the save below.
      const pruned = withCurrentVariants(draft)
      const mask = pruned.data.faceMask
      const jobs = mask?.variantJobs ?? []
      const unchanged = { data: { revision, changed: false, faceMaskState: await faceMaskStateWithVariants(req, draft) } }
      if (!mask || (pruned.abandoned.length === 0 && jobs.every((j) => j.error))) return unchanged
      const frames = mask.frames
      const castSwap = getPluginSupports().castSwap
      const from = reusableFaceMaskBase(pruned.data, castSwap?.faceMaskRecipe)

      // What changes, per record (by its job): the record (or none) and, once done, the variant.
      const updates: Array<{ jobId: string; job: TrendFaceMaskVariantJob | null; variant?: TrendFaceMaskVariant }> = []
      const fail = async (job: TrendFaceMaskVariantJob, message: string) => {
        await markJobFailed(job.jobId, { error_message: message })
        updates.push({ jobId: job.jobId, job: { ...job, error: { message, at: new Date().toISOString() } } })
      }
      for (const job of jobs) {
        if (job.error) continue
        // Read as the job's owner: another admin's poll never misreads its steps as gone.
        const anchor = await jobRow(job.jobId)
        if (!anchor) {
          updates.push({ jobId: job.jobId, job: { ...job, error: { message: "The person mask's own job is gone.", at: new Date().toISOString() } } })
          continue
        }
        const owner = anchor.user_id
        const mine = owner === req.userId
        if (anchor.status === "completed") {
          // Finished by an earlier advance whose save did not land: recorded from the job, nothing redone.
          const variant = variantFromJob(anchor, job)
          if (variant) updates.push({ jobId: job.jobId, job: null, variant })
          else updates.push({ jobId: job.jobId, job: { ...job, error: { message: "The person mask finished without a result.", at: new Date().toISOString() } } })
          continue
        }
        if (TERMINAL_FAILED.has(anchor.status)) {
          const message = typeof anchor.error_message === "string" && anchor.error_message ? anchor.error_message : `The person mask ${anchor.status}.`
          updates.push({ jobId: job.jobId, job: { ...job, error: { message, at: new Date().toISOString() } } })
          continue
        }
        // Followed: its idle clock restarts, so reconcile never closes a mask someone is making.
        await touchTrendVariantAnchor(job.jobId)
        const { eraseAlways, keep } = faceMaskVariantBoxes(pruned.data, job.emptySlots)
        const erase = await jobRow(job.eraseJobId, owner)
        const make = await jobRow(job.makeJobId, owner)
        const step = nextVariantStep(job, erase, make, frames, eraseAlways.length > 0 || keep.length > 0)
        if (step.kind === "wait") continue
        if (step.kind === "fail") {
          await fail(job, step.message)
        } else if (step.kind === "erase" || step.kind === "make") {
          // A paid step: asked by the job's owner only (billed to them, as the start was).
          if (!mine) continue
          if (step.kind === "erase") {
            const asked = await askErase(app, req, pruned.data, job)
            if (asked.eraseJobId) updates.push({ jobId: job.jobId, job: { ...job, eraseJobId: asked.eraseJobId } })
            else await fail(job, `The mask erase could not be started (${asked.res.statusCode}).`)
            continue
          }
          if (!from) {
            await fail(job, "The approved face mask can no longer be reused: make the face mask again.")
            continue
          }
          const res = await engineRequest(
            app,
            req,
            "/v1/cast-swap/face-mask",
            { videoUrl: pruned.data.source!.videoUrl, faceMasking: withResolvedZone(withoutMarks(pruned.data.faceMasking!)), fromMask: { ...from, maskUrl: step.maskUrl } },
            { "idempotency-key": `${FACE_MASK_VARIANT_JOB_TYPE}:${job.jobId}:make` },
            { origin: "trends-admin", source: deriveJobSource(req) },
          )
          const makeJobId = res.statusCode >= 200 && res.statusCode < 300 ? jobIdOf(res.body) : null
          if (makeJobId) updates.push({ jobId: job.jobId, job: { ...job, makeJobId } })
          else await fail(job, `Nodaro Motion did not start the person mask's fill (${res.statusCode}).`)
        } else {
          const url = step.kind === "done" ? (await copyToTrendStorage(trend.id, step.maskedUrl, "video")).url : undefined
          const variant: TrendFaceMaskVariant = {
            emptySlots: job.emptySlots,
            key: job.key,
            ...(url ? { url } : {}),
            frames,
            jobId: job.jobId,
            stats: step.kind === "done" ? step.stats : eraseStatsOf(erase),
            approvedAt: new Date().toISOString(),
          }
          // The variant rides on its finished job, so a save that does not land is recovered from it, never redone.
          await markJobCompleted(job.jobId, { output_data: { maskedUrl: url ?? null, frames, variant, ...(job.eraseJobId ? { eraseJobId: job.eraseJobId } : {}), ...(job.makeJobId ? { makeJobId: job.makeJobId } : {}) } })
          updates.push({ jobId: job.jobId, job: null, variant })
        }
      }
      if (updates.length === 0 && pruned.abandoned.length === 0) return unchanged

      const result = await saveFaceMaskEdit(trend.id, { data: draft, revision }, mask.jobId, (m) => {
        let variants = m.variants
        let variantJobs = m.variantJobs
        for (const u of updates) {
          // Only the record this advance read: a newer start for the same set replaced it meanwhile, and wins.
          const record = variantJobs?.find((j) => j.jobId === u.jobId)
          if (!record) continue
          if (u.variant) variants = replaceFor(variants, u.variant.emptySlots, u.variant)
          variantJobs = updateRecord(variantJobs, u.jobId, () => u.job)
        }
        return withLists(m, variants, variantJobs)
      })
      if (!result) return unchanged
      const approved = updates.filter((u) => u.variant).map((u) => u.variant!.emptySlots)
      if (approved.length > 0) await audit(req, "approve_trend_face_mask_variants", "trend", trend.id, { slug: trend.slug, sets: approved })
      return { data: { ...result.saved, changed: true, faceMaskState: await faceMaskStateWithVariants(req, result.data) } }
    } catch (e) {
      if (e instanceof DraftConflictError) return deps.draftConflict(reply)
      if (e instanceof TrendMediaError) return err(reply, 400, e.code, e.message)
      return unavailableOrInternal(reply, req, e, "Failed to advance the person masks")
    }
  })
}
