import type { FastifyInstance } from "fastify"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertSyncJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../ee/billing/credits.js"
import { SCENE_GRAPH_SYSTEM_PROMPT } from "../prompts/scene-graph-system.js"
import { validateSceneGraph } from "../lib/scene-graph-validator.js"
import { extractJsonFromAIResponse } from "../lib/json-utils.js"
import { llmComplete, type LlmRequest } from "../lib/llm-client.js"
import { LlmSpend, reserveLlmCall, stampSyncLlmCallStart } from "../lib/llm-billing.js"
import { finishMeteredSyncLlmJob, llmGuardPrecheck, spendLlmCall } from "../lib/meter-sync-llm.js"
import { LLM_ROUTE_DEFAULTS, LLM_MODEL_IDS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { LLM_ADVANCED_SHAPE, advancedModeError, resolveLlmParams } from "../lib/llm-advanced-mode.js"
import { ASPECT_DIMENSIONS } from "../lib/aspect-dimensions.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { completedJobColumns } from "../lib/job-status.js"
import { markJobFailed } from "../lib/job-failure.js"
import { llmErrorCode, userFacingMessage } from "../lib/user-facing-error.js"
import { extendSocketTimeout } from "../lib/llm-route-timeout.js"

const generateBody = z.object({
  prompt: z.string().min(1).max(2000),
  userPrompt: z.string().max(8000).optional(),
  assets: z.array(z.object({
    id: z.string(),
    type: z.enum(["image", "video", "audio"]),
    url: z.string(),
    label: z.string().optional(),
    durationSeconds: z.number().optional(),
  })).min(1),
  fps: z.number().min(15).max(60).default(30),
  aspectRatio: z.string().default("16:9"),
  durationSeconds: z.number().min(1).max(300).default(30),
  userId: z.string().uuid(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  ...LLM_ADVANCED_SHAPE,
})

export async function sceneGraphAIRoutes(app: FastifyInstance) {
  app.post(
    "/v1/scene-graph/generate",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("scene-graph-ai", req.body), {
        // Metered (D1): the pre-check is the call's 1-attempt hold; undefined under the rollback.
        computeCredits: (body) => llmGuardPrecheck("scene-graph-ai", body),
      }),
      config: { requestTimeout: 60000 } as Record<string, unknown>,
    },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/scene-graph/generate", "scene-graph-ai")) return

      extendSocketTimeout(req, reply, 60000)

      const parsed = generateBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { prompt, assets, fps, aspectRatio, durationSeconds } = parsed.data
      const userId = req.userId

      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "LLM API key not configured",
          },
        })
      }

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["scene-graph-ai"]

      const dimensions = ASPECT_DIMENSIONS[aspectRatio] ?? ASPECT_DIMENSIONS["16:9"]
      const durationInFrames = Math.round(durationSeconds * fps)

      // Create job record
      // Reject BEFORE the jobs row exists — a 400 after the insert leaves an
      // orphan `pending` row with no reservation and no queue entry.
      const advancedError = advancedModeError(parsed.data, llmModel)
      if (advancedError) return reply.status(400).send({ error: advancedError })

      const { data: job, error: jobError } = await insertSyncJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: { ...buildJobInputData(parsed.data, "scene-graph-ai"), assetCount: assets.length },
        })

      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      // Build user message with asset list — the request as it is sent, so the
      // metered hold is sized from it.
      const assetList = assets.map((a, i) => {
        const label = a.label || `Asset ${i + 1}`
        const duration = a.durationSeconds ? ` (${a.durationSeconds}s)` : ""
        return `- ${label} [${a.type}]${duration}: ${a.url}`
      }).join("\n")

      const userMessage = `Create a video composition with these settings:
- FPS: ${fps}
- Resolution: ${dimensions.width}x${dimensions.height} (${aspectRatio})
- Total duration: ${durationSeconds} seconds (${durationInFrames} frames)

Available media assets:
${assetList}

Composition style: ${prompt}`

      const request: LlmRequest = {
        modelId: llmModel,
        system: SCENE_GRAPH_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        ...resolveLlmParams(parsed.data, LLM_ROUTE_DEFAULTS["scene-graph-ai"]),
        reasoningEffort: parsed.data.reasoningEffort,
      }

      // Reserve credits: metered (the call's 1-attempt hold), else the tier id as before.
      const reserve = await reserveLlmCall(req, reply, job.id, { feature: "scene-graph-ai", calls: [{ modelId: llmModel, request }] })
      if (!reserve) return
      const spend = new LlmSpend()
      let usageLogId: string | undefined
      if (!reserve.metered) {
        const modelIdentifier = buildLlmCreditIdentifier("scene-graph-ai", llmModel, parsed.data.reasoningEffort, parsed.data.advancedMode)
        const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
        if (reply.sent) return
        usageLogId = reservation?.usageLogId
      }

      // Reconciliation: mark this job inflight before invoking the LLM. The
      // sync-sweep cron uses this to detect stuck rows that the route
      // handler never completed. Best-effort — never throws.
      if (!(await stampSyncLlmCallStart(job.id, reserve, reply))) return

      try {
        console.log(`[scene-graph-ai] Generating for job ${job.id}, ${assets.length} assets, ${durationSeconds}s`)

        const response = await spendLlmCall(reserve.metered ? spend : undefined, llmModel, request, () => llmComplete(request))

        const rawText = response.text

        // Parse JSON from response (handle potential markdown wrapping)
        let rawJson: unknown
        try {
          rawJson = JSON.parse(extractJsonFromAIResponse(rawText))
        } catch {
          console.error(`[scene-graph-ai] Failed to parse JSON for job ${job.id}`)
          throw new Error("AI returned invalid JSON. Please try again with a different prompt.")
        }

        // Validate and auto-fix
        const assetUrls = assets.map((a) => a.url)
        const validation = validateSceneGraph(rawJson, assetUrls, durationInFrames, fps)

        if (validation.autoFixed.length > 0) {
          console.log(`[scene-graph-ai] Auto-fixed ${validation.autoFixed.length} issues for job ${job.id}`)
        }

        if (!validation.valid) {
          console.error(`[scene-graph-ai] Validation errors for job ${job.id}:`, validation.errors)
          // Still return the scene graph with warnings — let the user decide
        }

        const sceneGraph = validation.sceneGraph ?? rawJson

        const outputData = {
          sceneGraph,
          validationErrors: validation.errors,
          autoFixes: validation.autoFixed,
          usage: response.usage,
        }
        if (reserve.metered) {
          // Result first, then the settle (what the call cost), then the terminal write.
          await finishMeteredSyncLlmJob(job.id, reserve, spend, { status: "completed", outputData })
        } else {
          // Finalize job
          await supabase
            .from("jobs") // tenant-scope-ignore: job.id is server-generated in this request
            .update({
              status: "completed",
              ...completedJobColumns(),
              output_data: outputData,
              provider_cost: response.providerCost ?? null,
            })
            .eq("id", job.id)

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
          }
        }

        console.log(`[scene-graph-ai] Job ${job.id} completed, tokens: ${response.usage?.outputTokens}`)

        return reply.send({
          jobId: job.id,
          sceneGraph,
          validationErrors: validation.errors,
          autoFixes: validation.autoFixed,
        })
      } catch (err) {
        const message = userFacingMessage(err, "Scene graph generation failed")
        console.error(`[scene-graph-ai] Error for job ${job.id}:`, message)

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
