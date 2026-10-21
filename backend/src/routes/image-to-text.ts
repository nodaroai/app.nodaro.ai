import type { FastifyInstance } from "fastify"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertSyncJob } from "../lib/insert-job.js"
import { completedJobColumns } from "../lib/job-status.js"
import { markJobFailed } from "../lib/job-failure.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../ee/billing/credits.js"
import { LLM_MODEL_IDS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { LLM_ADVANCED_SHAPE, advancedModeError } from "../lib/llm-advanced-mode.js"
import { LLM_CHEAP_LANES_SHAPE } from "../lib/llm-cheap-lanes.js"
import { describeImageWithLlm, imageDescribeRequest, type ImageDescribeArgs } from "../lib/image-describe.js"
import { LlmSpend, reserveLlmCall, stampSyncLlmCallStart } from "../lib/llm-billing.js"
import { finishMeteredSyncLlmJob, llmGuardPrecheck, spendLlmCall } from "../lib/meter-sync-llm.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { llmErrorCode, userFacingMessage } from "../lib/user-facing-error.js"
import { describeErrorChain } from "../lib/llm-errors.js"

const imageToTextBody = z.object({
  imageUrl: safeUrlSchema,
  detailLevel: z
    .enum(["brief", "detailed", "structured"])
    .default("detailed"),
  customPrompt: z.string().max(2000).optional(),
  userPrompt: z.string().max(8000).optional(),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  ...LLM_ADVANCED_SHAPE,
  ...LLM_CHEAP_LANES_SHAPE,
})

export async function imageToTextRoutes(app: FastifyInstance) {
  app.post(
    "/v1/image-to-text/describe",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("image-to-text", req.body), {
        // Metered (D1): the pre-check is the call's 1-attempt hold (text only); undefined under the rollback.
        computeCredits: (body) => llmGuardPrecheck("image-to-text", body),
      }),
    },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/image-to-text/describe", "image-to-text")) return

      const parsed = imageToTextBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { imageUrl, detailLevel, customPrompt } = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "LLM API key not configured",
          },
        })
      }

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["image-to-text"]
      const advancedError = advancedModeError(parsed.data, llmModel)
      if (advancedError) return reply.status(400).send({ error: advancedError })
      const modelIdentifier = buildLlmCreditIdentifier("image-to-text", llmModel, parsed.data.reasoningEffort, parsed.data.advancedMode)
      const mcpClient = extractMcpClient(req.body)

      // Create a job record for audit trail
      const { data: job, error: jobError } = await insertSyncJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "image-to-text"),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })

      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      const describeArgs: ImageDescribeArgs = {
        imageUrl,
        llmModel,
        detailLevel,
        customPrompt,
        reasoningEffort: parsed.data.reasoningEffort,
        advanced: parsed.data,
        lanes: parsed.data,
      }
      // The request as it is sent (its URL form: an image is sized as an image
      // either way), so the metered hold and the spend are sized from it.
      const request = imageDescribeRequest(describeArgs)

      // Reserve credits: metered (the call's 1-attempt hold), else the tier id as before.
      const reserve = await reserveLlmCall(req, reply, job.id, {
        feature: "image-to-text",
        calls: [{ modelId: llmModel, request, cheapLanesOnly: parsed.data.cheapLanesOnly === true }],
      })
      if (!reserve) return
      const spend = new LlmSpend()
      let usageLogId: string | undefined
      if (!reserve.metered) {
        const reservation = await reserveCreditsForJob(
          req,
          reply,
          job.id,
          modelIdentifier,
        )
        if (reply.sent) return
        usageLogId = reservation?.usageLogId
      }

      // Reconciliation: mark this job inflight before invoking the LLM. The
      // sync-sweep cron uses this to detect stuck rows that the route
      // handler never completed. Best-effort — never throws.
      if (!(await stampSyncLlmCallStart(job.id, reserve, reply))) return

      try {
        // Shared describe core (lib/image-describe.ts) — same prompts, image
        // pre-fetch, and LLM params as always; extracted so in-process
        // composers reuse it without an HTTP self-call.
        const response = await spendLlmCall(reserve.metered ? spend : undefined, llmModel, request, () => describeImageWithLlm(describeArgs))

        const generatedText = response.text

        if (reserve.metered) {
          // Result first, then the settle (what the call cost), then the terminal write.
          // Which LLM lane served the answer rides `provider` (admin-only), never output_data.
          await finishMeteredSyncLlmJob(job.id, reserve, spend, {
            status: "completed",
            outputData: { generatedText, detailLevel, usage: response.usage },
            provider: response.lane,
          })
          return reply.send({ jobId: job.id, generatedText })
        }

        // Finalize job and credits
        try {
          await supabase
            .from("jobs")
            .update({
              status: "completed",
              ...completedJobColumns(),
              output_data: {
                generatedText,
                detailLevel,
                usage: response.usage,
              },
              provider_cost: response.providerCost ?? null,
              // Which LLM lane served the answer, a fallback included.
              // `provider` is admin-only — outside PUBLIC_JOB_KEYS (routes/jobs.ts) and
              // outside the browser's column grant on jobs (migration 347) — while
              // output_data is owner-readable through both, so the lane never rides there.
              provider: response.lane,
            })
            .eq("id", job.id)
            .eq("user_id", userId)

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
          }
        } catch (postErr) {
          console.error("[image-to-text] Post-API error:", postErr)
        }

        return reply.send({ jobId: job.id, generatedText })
      } catch (err) {
        // The person reads a model-lane failure's plain sentence; the full
        // diagnostic (it names the vendor and the step that failed) goes to
        // the log only.
        const message = userFacingMessage(err, "Image description failed")
        req.log.error({ err: describeErrorChain(err), jobId: job.id }, "[image-to-text] failed")

        if (reserve.metered) {
          // A billed failure is charged its usage (and says so); an unbilled one is refunded.
          const finished = await finishMeteredSyncLlmJob(job.id, reserve, spend, { status: "failed", errorMessage: message, outputData: { error: message } })
          return reply.status(502).send({
            error: { code: llmErrorCode(err), message: finished.errorMessage ?? message },
          })
        }

        await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message } } })

        if (usageLogId) {
          await CreditsService.refundCredits(usageLogId)
        }

        return reply.status(502).send({
          error: { code: llmErrorCode(err), message },
        })
      }
    },
  )
}
