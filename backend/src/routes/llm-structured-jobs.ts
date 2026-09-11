import type { FastifyInstance, FastifyRequest, LightMyRequestResponse } from "fastify"
import { z } from "zod"
import { resolveLlmCreditId, videoAnalysisResultSchema, WORKSPACE_HEADER_LOWER } from "@nodaro/shared"
import { shouldProxyLlmToCloud } from "../lib/cloud-llm-proxy.js"
import { insertJob } from "../lib/insert-job.js"
import { stampAnalysisChild, discardUnstartedJob, readOwnAnalysisChild } from "../lib/llm-structured-job-row.js"
import { config } from "../lib/config.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  llmStructuredBody,
  prepareStructuredRequest,
  structuredJobInputData,
} from "../lib/llm-structured-request.js"
import type { LlmStructuredJobPayload } from "../workers/handlers/llm-structured.js"

/**
 * POST /v1/llm/structured/jobs — the synchronous structured route as a JOB.
 *
 * Same body, same pre-flight, same credit id; the answer is `{ jobId }` at
 * once and the result lands on the row (`output_data.output`), which the
 * caller — or a client that left and came back — reads through the jobs
 * routes. A sibling route, not a flag on the sync one: an older platform
 * answers it with a clean 404, and a flag stripped by an older Zod would have
 * silently run the sync path (spec D2).
 *
 * With `videoUrl` the platform analyzes the video FIRST and the worker drafts
 * from the analysis. The analysis is a separate `video-analysis` job the
 * caller owns, created HERE through the analysis route itself — `app.inject`
 * with the caller's auth, the recast create route's idiom — so the probe,
 * the duration policy, the tier vocabulary and the analysis price live in
 * exactly one place (the plugin) and its refusals (422 too long / live, 402)
 * reach the caller synchronously, verbatim (spec D16). Order is load-bearing:
 * the parent row and its LLM reservation exist BEFORE the child is created,
 * so a refused child has one thing to undo and an unreserved parent never
 * spawns a paid analysis.
 *
 * With `analysisJobId` the run drafts FROM A FINISHED ANALYSIS the caller
 * already owns — a retry after a failed draft, another model, a re-run with
 * different notes — and buys no second one (the Director spec's §13 / P3).
 * The child is admitted BEFORE any row exists (the recast create route's
 * precheck: missing and foreign are the same 404, a failed or still-running
 * analysis is a 422, an unreadable result is a 422) and stamped on the parent
 * as reused, so the worker's wait returns at once and the row's price is
 * the plan's alone. `videoUrl` may ride beside it as the record of what was
 * analyzed; nothing is fetched from it.
 *
 * Keyless installs that proxy their LLM calls to nodaro.ai get 503 (spec
 * D17): the sync proxy forwards before any local row; an async parent is
 * reserved locally at create, so mirroring a cloud job into it would
 * double-book. The relay is a tracked follow-up.
 */
export const LLM_STRUCTURED_JOB_TYPE = "llm-structured"

export const llmStructuredJobBody = llmStructuredBody
  .extend({
    /** Display label stored on the job (attribution only, like `origin`) —
     *  a run list's row title. */
    label: z.string().trim().min(1).max(120).optional(),
    /** Draft FROM this video: the analysis pre-step (spec §3.1). */
    videoUrl: safeUrlSchema.optional(),
    /** Passed to POST /v1/video-analysis unchanged — its vocabulary, its
     *  validation (a bad tier is ITS 400, propagated). */
    videoAnalysis: z
      .object({
        llmModel: z.string().max(64).optional(),
        selectionMode: z.enum(["choose", "combine"]).optional(),
      })
      .strict()
      .optional(),
    /** Draft from THIS finished `video-analysis` job of the caller's instead
     *  of analyzing `videoUrl` again — no child is created, nothing more is
     *  reserved for analysis. */
    analysisJobId: z.uuid().optional(),
  })
  .refine((b) => !b.videoAnalysis || Boolean(b.videoUrl), {
    message: "videoAnalysis requires videoUrl",
    path: ["videoAnalysis"],
  })
  .refine((b) => !(b.videoAnalysis && b.analysisJobId), {
    message: "videoAnalysis has no effect with analysisJobId — the analysis already ran",
    path: ["videoAnalysis"],
  })

export type LlmStructuredJobBody = z.infer<typeof llmStructuredJobBody>

type ChildResult = { ok: true; jobId: string } | { ok: false; status: number; body: unknown }

function injectedJson(res: LightMyRequestResponse): unknown {
  try {
    return res.json()
  } catch {
    return { error: { code: "analysis_unavailable", message: res.body || "Video analysis returned no answer" } }
  }
}

/** Create the analysis child THROUGH the analysis route, as the caller. */
async function createAnalysisChild(app: FastifyInstance, req: FastifyRequest, body: LlmStructuredJobBody): Promise<ChildResult> {
  const headers: Record<string, string> = {}
  const auth = req.headers.authorization
  if (typeof auth === "string") headers.authorization = auth
  // The workspace/billing context rides a header; forward it so the child
  // bills the same payer the parent does.
  const workspace = req.headers[WORKSPACE_HEADER_LOWER]
  if (typeof workspace === "string") headers[WORKSPACE_HEADER_LOWER] = workspace

  const injected = await app.inject({
    method: "POST",
    url: "/v1/video-analysis",
    headers,
    payload: { videoUrl: body.videoUrl, ...(body.videoAnalysis ?? {}) },
  })
  if (injected.statusCode < 200 || injected.statusCode >= 300) {
    return { ok: false, status: injected.statusCode, body: injectedJson(injected) }
  }
  const jobId = (injectedJson(injected) as { jobId?: unknown } | null)?.jobId
  if (typeof jobId !== "string" || jobId.length === 0) {
    return {
      ok: false,
      status: 502,
      body: { error: { code: "analysis_unavailable", message: "Video analysis did not return a job id" } },
    }
  }
  return { ok: true, jobId }
}

type ReuseResult = { ok: true; credits: number | null } | { ok: false; status: number; body: unknown }

/**
 * Admit a CLIENT-SUPPLIED analysis (the recast create route's precheck, on
 * the caller's own rows): missing and foreign answer the same 404 (no
 * ownership oracle), a job of another type or a terminal failure is a 422,
 * a still-running one is a 422 the caller retries later, and the result is
 * parsed against the shared schema so the worker cannot fail on it after the
 * reservation. Runs BEFORE any row exists — a refusal here costs nothing.
 */
async function precheckReusedAnalysis(analysisJobId: string, userId: string): Promise<ReuseResult> {
  const row = await readOwnAnalysisChild(analysisJobId, userId)
  const refuse = (status: number, code: string, message: string): ReuseResult => ({
    ok: false,
    status,
    body: { error: { code, message } },
  })
  if (!row) return refuse(404, "not_found", "analysis job not found")
  if (row.job_type !== "video-analysis") return refuse(422, "not_analysis", "That job isn't a video analysis.")
  if (row.status === "failed" || row.status === "cancelled") {
    return refuse(422, "analysis_failed", "The source analysis failed.")
  }
  if (row.status !== "completed") {
    return refuse(422, "analysis_not_ready", "The source analysis is still processing. Retry once it completes.")
  }
  const json = (row.output_data as Record<string, unknown> | null)?.json
  if (!videoAnalysisResultSchema.safeParse(json).success) {
    return refuse(422, "invalid_analysis", "The source analysis output is invalid.")
  }
  return { ok: true, credits: row.credits }
}

/** The enqueue payload: the body the worker needs, minus the create-time-only
 *  fields (the child is already made — or admitted; the label lives on the row). */
function workerPayload(body: LlmStructuredJobBody): Omit<LlmStructuredJobPayload, "jobId" | "usageLogId" | "analysisJobId" | "analysisReused"> {
  const { videoUrl: _videoUrl, videoAnalysis: _videoAnalysis, label: _label, analysisJobId: _analysisJobId, ...rest } = body
  return rest
}

export async function llmStructuredJobsRoutes(app: FastifyInstance) {
  app.post(
    "/v1/llm/structured/jobs",
    { preHandler: creditGuard((req) => resolveLlmCreditId("llm-structured", req.body)) },
    async (req, reply) => {
      if (await shouldProxyLlmToCloud()) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "Async structured drafts run on this instance's own LLM key. Configure one, or use POST /v1/llm/structured.",
          },
        })
      }
      const parsed = llmStructuredJobBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({ error: { code: "provider_unavailable", message: "LLM API key not configured" } })
      }
      const prepared = prepareStructuredRequest(parsed.data)
      if (!prepared.ok) return reply.status(prepared.status).send({ error: prepared.error })

      // A reused analysis is admitted BEFORE the row exists: a refusal here
      // is one more that costs nothing.
      if (parsed.data.analysisJobId) {
        const admitted = await precheckReusedAnalysis(parsed.data.analysisJobId, userId)
        if (!admitted.ok) return reply.status(admitted.status).send(admitted.body)
      }

      // Derived ONCE: the row's projection and the analysis stamp below are
      // the same object, so the two cannot drift.
      const inputData = structuredJobInputData(parsed.data, LLM_STRUCTURED_JOB_TYPE)
      const { data: job, error: jobError } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: inputData,
      })
      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, prepared.modelIdentifier)
      if (reply.sent) return

      let analysisJobId: string | undefined
      const analysisReused = Boolean(parsed.data.analysisJobId)
      if (parsed.data.analysisJobId) {
        // Admitted above; it costs this run nothing, so no price is stamped.
        analysisJobId = parsed.data.analysisJobId
        await stampAnalysisChild(job.id, userId, inputData, { analysisJobId, reused: true })
      } else if (parsed.data.videoUrl) {
        const child = await createAnalysisChild(app, req, parsed.data)
        if (!child.ok) {
          // The analysis route refused: nothing has run, so the parent goes
          // away with its reservation.
          await discardUnstartedJob(job.id, userId)
          return reply.status(child.status).send(child.body)
        }
        analysisJobId = child.jobId
        // The child's price is on its row from its own reservation; stamped
        // now so a run list shows the whole cost from the first read.
        const analysisCredits = (await readOwnAnalysisChild(analysisJobId, userId))?.credits ?? null
        await stampAnalysisChild(job.id, userId, inputData, { analysisJobId, analysisCredits })
      }

      // attempts: 1 — the LLM call is the paid step; a BullMQ re-run after a
      // crash mid-call would bill the provider twice for one reservation.
      // The reconcile sweep (worker heartbeat "pre-task") owns crash recovery.
      const payload: LlmStructuredJobPayload = {
        jobId: job.id,
        usageLogId: reservation?.usageLogId,
        ...workerPayload(parsed.data),
        ...(analysisJobId ? { analysisJobId } : {}),
        ...(analysisReused ? { analysisReused: true } : {}),
      }
      // A tighter fail window than the shared queue's 5000: the full system
      // prompt (≤ 100k chars) + jsonSchema (≤ 64 KB) ride job.data into Redis.
      await videoQueue.add(LLM_STRUCTURED_JOB_TYPE, payload as unknown as Record<string, unknown>, {
        attempts: 1,
        removeOnFail: { count: 200 },
      })

      return { jobId: job.id }
    },
  )
}
