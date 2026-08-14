import type { FastifyInstance } from "fastify"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../ee/billing/credits.js"
import { LLM_MODEL_IDS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { LLM_ADVANCED_SHAPE, advancedModeError } from "../lib/llm-advanced-mode.js"
import { describeImageWithLlm } from "../lib/image-describe.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { sendInternalError } from "../lib/http-errors.js"

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
})

export async function imageToTextRoutes(app: FastifyInstance) {
  app.post(
    "/v1/image-to-text/describe",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("image-to-text", req.body)),
    },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/image-to-text/describe")) return

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
      const { data: job, error: jobError } = await insertJob(req, {
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

      // Reserve credits
      const reservation = await reserveCreditsForJob(
        req,
        reply,
        job.id,
        modelIdentifier,
      )
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      // Reconciliation: mark this job inflight before invoking the LLM. The
      // sync-sweep cron uses this to detect stuck rows that the route
      // handler never completed. Best-effort — never throws.
      await markProviderCallStart(job.id, "anthropic-sync")

      try {
        // Shared describe core (lib/image-describe.ts) — same prompts, image
        // pre-fetch, and LLM params as always; extracted so in-process
        // composers reuse it without an HTTP self-call.
        const response = await describeImageWithLlm({
          imageUrl,
          llmModel,
          detailLevel,
          customPrompt,
          reasoningEffort: parsed.data.reasoningEffort,
          advanced: parsed.data,
        })

        const generatedText = response.text

        // Finalize job and credits
        try {
          await supabase
            .from("jobs")
            .update({
              status: "completed",
              output_data: {
                generatedText,
                detailLevel,
                usage: response.usage,
              },
              provider_cost: response.providerCost ?? null,
            })
            .eq("id", job.id)

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
          }
        } catch (postErr) {
          console.error("[image-to-text] Post-API error:", postErr)
        }

        return reply.send({ jobId: job.id, generatedText })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Claude API call failed"

        await supabase
          .from("jobs") // tenant-scope-ignore: job.id is server-generated in this request
          .update({ status: "failed", output_data: { error: message } })
          .eq("id", job.id)

        if (usageLogId) {
          await CreditsService.refundCredits(usageLogId)
        }

        return reply.status(502).send({
          error: { code: "llm_error", message },
        })
      }
    },
  )
}
