/**
 * Video Remake's "Download side by side" (Cloud: registered under
 * `hasCredits()`, beside the product's other routes): one video of a finished
 * run's original clip and its result together, the result's sound, small
 * "Original" / "Remake" labels (providers/video/side-by-side.ts).
 *
 *   POST /v1/video-remake/:jobId/side-by-side   (also /v1/cast-swap/…)
 *     200 { data: { status: "ready", url, fileName, width, height, layout } }
 *     202 { data: { status: "making" | "waiting" } }   ask again in a moment
 *
 * The first ask starts the render in the background and answers 202; asking
 * again answers 202 until the file is there, then 200 with its address (a run
 * whose file is already made answers 200 at once). `waiting`: another of the
 * account's runs is being rendered, this one starts after it (one at a time
 * per account). Free: no credits, no job row.
 *
 * Who: the run's owner, or an administrator for any run (the admin job page;
 * a developer app's token never carries an administrator's reach). A
 * developer app needs `jobs:read` (the file shows the run) and a `:write` or
 * `:execute` scope (it makes a file on the account's behalf, the line the
 * run itself is held to): 403 `insufficient_scope` otherwise. First-party
 * sessions and personal API tokens are not scoped.
 * A trend run's side by side (an administrator's) is kept off the run's row,
 * which its runner can read (`keepOffRun`): it is never recorded there, nor
 * answered from there.
 * A run in the Trash, or restricted, reads as absent (404). Refusals (409
 * `side_by_side_unavailable`, `reason`): `not_video_remake`, `not_finished`
 * (running, failed, no video), `trend_run` (a trend run, for its runner: its
 * clip is the trend's), `no_clip` (no clip is known). A render that failed:
 * 500 `side_by_side_failed`, held for a few seconds; asking later tries again.
 * Rate-limited per account like the other polled reads (60 a minute).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { checkIsAdmin } from "../../lib/admin-check.js"
import { requireAppScope, requireAppWriteScope } from "../../lib/scope-prehandler.js"
import { TRASHED_JOB_COLUMN } from "../../lib/public-job-data.js"
import { RESTRICTED_JOB_COLUMN } from "../../lib/content-restrictions-column.js"
import {
  fullQualityDraftId,
  recordedSideBySide,
  sideBySideFileName,
  sideBySidePlan,
  type SideBySideRecord,
  type SideBySideRefusal,
  type SideBySideRun,
} from "../lib/video-remake-side-by-side.js"
import { createSideBySideJob, defaultSideBySideJobDeps, type SideBySideJob } from "../lib/video-remake-side-by-side-job.js"

const paramsSchema = z.object({ jobId: z.string().uuid() })

const RUN_COLUMNS = "id, user_id, status, job_type, input_data, output_data"

/** The sentence of each refusal (what the person can do about it, where there is anything). */
const REFUSAL_MESSAGES: Readonly<Record<SideBySideRefusal, string>> = {
  not_video_remake: "Only a Video Remake run has a side by side.",
  not_finished: "The side by side is ready once the run has finished.",
  trend_run: "A trend run has no side by side: its original is the trend's.",
  no_clip: "This run's original clip is not available.",
}

type RunRow = SideBySideRun & { readonly user_id: string }

/** One run by id, for its owner, or for any caller when `admin`: null when absent, in the Trash or restricted. */
async function readRun(jobId: string, callerId: string, admin: boolean): Promise<RunRow | null> {
  let query = supabase
    // tenant-scope-ignore: the owner's own run (user_id below), or an administrator's read of any run.
    .from("jobs")
    .select(RUN_COLUMNS)
    .eq("id", jobId)
    .is(TRASHED_JOB_COLUMN, null)
    .is(RESTRICTED_JOB_COLUMN, null)
  if (!admin) query = query.eq("user_id", callerId)
  const { data, error } = await query.maybeSingle()
  if (error?.code === "22P02") return null
  if (error) throw new Error(`Could not read the run: ${error.message}`)
  return (data as RunRow | null) ?? null
}

/** A Full Quality's draft, the same owner's: null when absent, in the Trash or restricted. */
async function readDraft(draftId: string, ownerId: string): Promise<SideBySideRun | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select(RUN_COLUMNS)
    .eq("id", draftId)
    .eq("user_id", ownerId)
    .is(TRASHED_JOB_COLUMN, null)
    .is(RESTRICTED_JOB_COLUMN, null)
    .maybeSingle()
  if (error?.code === "22P02") return null
  if (error) throw new Error(`Could not read the run's draft: ${error.message}`)
  return (data as SideBySideRun | null) ?? null
}

function ready(reply: FastifyReply, jobId: string, record: SideBySideRecord) {
  return reply.status(200).send({
    data: { status: "ready", url: record.url, fileName: sideBySideFileName(jobId), width: record.width, height: record.height, layout: record.layout },
  })
}

export function sideBySideHandler(job: SideBySideJob) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const params = paramsSchema.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: { code: "validation_error", message: "jobId must be a UUID" } })
    const { jobId } = params.data

    // An app acts for its user with the reach the user granted it, never an administrator's.
    const admin = !req.appAuthorization && (await checkIsAdmin(userId))
    const run = await readRun(jobId, userId, admin)
    if (!run) return reply.status(404).send({ error: { code: "not_found", message: "Run not found" } })

    // The plan first, even when the file is made: a file an administrator made of a trend run is never its runner's.
    const draftId = fullQualityDraftId(run)
    const draft = draftId ? await readDraft(draftId, run.user_id) : null
    const plan = sideBySidePlan(run, draft, { admin })
    if (!plan.ok) {
      return reply.status(409).send({ error: { code: "side_by_side_unavailable", reason: plan.refusal, message: REFUSAL_MESSAGES[plan.refusal] } })
    }

    // A run kept off its row is never answered from it (a record left there is not this file's): the job's marker holds it.
    const recorded = plan.keepOffRun ? null : recordedSideBySide(run.output_data)
    if (recorded) return ready(reply, jobId, recorded)

    const state = await job.start({ jobId, ownerId: run.user_id, resultUrl: plan.resultUrl, source: plan.source, keepOffRun: plan.keepOffRun })
    if (state.status === "ready") return ready(reply, jobId, state.record)
    if (state.status === "failed") {
      return reply.status(500).send({ error: { code: "side_by_side_failed", message: "Couldn't make the side by side. Try again in a moment." } })
    }
    return reply.status(202).send({ data: { status: state.status === "waiting" ? "waiting" : "making" } })
  }
}

/** Polled every few seconds while a render runs: room for that, and for a few runs at once. */
const RATE_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } }

/** A developer app: `jobs:read` to see the run, and a `:write` / `:execute` scope to have a file made for it. */
const APP_SCOPES = [requireAppScope("jobs:read"), requireAppWriteScope()]

export async function videoRemakeSideBySideRoutes(app: FastifyInstance, opts: { job?: SideBySideJob } = {}) {
  const handler = sideBySideHandler(opts.job ?? createSideBySideJob(defaultSideBySideJobDeps()))
  // Both prefixes, each written out so the route scans read them (lib/video-remake-paths.ts).
  app.post("/v1/video-remake/:jobId/side-by-side", { config: RATE_LIMIT, preHandler: APP_SCOPES }, handler)
  app.post("/v1/cast-swap/:jobId/side-by-side", { config: RATE_LIMIT, preHandler: APP_SCOPES }, handler)
}
