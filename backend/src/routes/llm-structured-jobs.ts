import type { FastifyInstance, FastifyRequest, LightMyRequestResponse } from "fastify"
import { z } from "zod"
import { resolveLlmCreditId, WORKSPACE_HEADER_LOWER } from "@nodaro/shared"
import { shouldProxyLlmToCloud } from "../lib/cloud-llm-proxy.js"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
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
  })
  .refine((b) => !b.videoAnalysis || Boolean(b.videoUrl), {
    message: "videoAnalysis requires videoUrl",
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

/** The enqueue payload: the body the worker needs, minus the create-time-only
 *  fields (the child is already made; the label lives on the row). */
function workerPayload(body: LlmStructuredJobBody): Omit<LlmStructuredJobPayload, "jobId" | "usageLogId" | "analysisJobId"> {
  const { videoUrl: _videoUrl, videoAnalysis: _videoAnalysis, label: _label, ...rest } = body
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

      const { data: job, error: jobError } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: structuredJobInputData(parsed.data, LLM_STRUCTURED_JOB_TYPE),
      })
      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, prepared.modelIdentifier)
      if (reply.sent) return

      let analysisJobId: string | undefined
      if (parsed.data.videoUrl) {
        const child = await createAnalysisChild(app, req, parsed.data)
        if (!child.ok) {
          // The analysis route refused: nothing has run. Undo the parent the
          // way the reserve path undoes its own orphan — refund, then delete —
          // so a run that never started never shows in a run list.
          await refundReservedCreditsForJob(job.id)
          await supabase.from("jobs").delete().eq("id", job.id).eq("user_id", userId)
          return reply.status(child.status).send(child.body)
        }
        analysisJobId = child.jobId
        await supabase
          .from("jobs")
          .update({
            input_data: { ...structuredJobInputData(parsed.data, LLM_STRUCTURED_JOB_TYPE), analysisJobId },
            output_data: { stage: "analyzing", analysisJobId },
          })
          .eq("id", job.id)
          .eq("user_id", userId)
      }

      // attempts: 1 — the LLM call is the paid step; a BullMQ re-run after a
      // crash mid-call would bill the provider twice for one reservation.
      // The reconcile sweep (worker heartbeat "pre-task") owns crash recovery.
      const payload: LlmStructuredJobPayload = {
        jobId: job.id,
        usageLogId: reservation?.usageLogId,
        ...workerPayload(parsed.data),
        ...(analysisJobId ? { analysisJobId } : {}),
      }
      await videoQueue.add(LLM_STRUCTURED_JOB_TYPE, payload as unknown as Record<string, unknown>, { attempts: 1 })

      return { jobId: job.id }
    },
  )
}
