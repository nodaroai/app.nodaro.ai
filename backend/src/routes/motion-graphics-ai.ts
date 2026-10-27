import type { FastifyInstance } from "fastify"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertJob, insertSyncJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { formatZodError } from "../lib/zod-error.js"

const aiRateLimit = rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: "ai-mg" })
import { CreditsService } from "../ee/billing/credits.js"
import { MOTION_GRAPHICS_SYSTEM_PROMPT } from "../prompts/motion-graphics-system.js"
import { validateMotionGraphicsPlan } from "../lib/motion-graphics-validator.js"
import { extractJsonFromAIResponse } from "../lib/json-utils.js"
import { llmComplete } from "../lib/llm-client.js"
import { LLM_ROUTE_DEFAULTS, LLM_MODEL_IDS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS, motionGraphicsFeature } from "@nodaro/shared/llm-models"
import { ASPECT_DIMENSIONS } from "../lib/aspect-dimensions.js"
import { LLM_ADVANCED_SHAPE, advancedModeError, resolveLlmParams } from "../lib/llm-advanced-mode.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { sendInternalError } from "../lib/http-errors.js"
import { completedJobColumns } from "../lib/job-status.js"
import { markJobFailed } from "../lib/job-failure.js"
import { llmErrorCode, userFacingMessage } from "../lib/user-facing-error.js"
import { LlmSpend, llmPrecheckBaseCredits, reserveLlmCall, settleLlmJob, stampSyncLlmCallStart } from "../lib/llm-billing.js"
import type { LlmRequest } from "../lib/llm/types.js"
import { buildLottieRequest } from "../lib/lottie-request.js"
import { completeSettledSyncJob } from "../lib/metered-sync-completion.js"
import { extendSocketTimeout } from "../lib/llm-route-timeout.js"

const generateBody = z.object({
  prompt: z.string().min(1).max(2000),
  userPrompt: z.string().max(8000).optional(),
  fps: z.number().min(15).max(60).default(30),
  aspectRatio: z.string().optional(),
  width: z.number().min(100).max(3840).optional(),
  height: z.number().min(100).max(3840).optional(),
  durationSeconds: z.number().min(1).max(60),
  backgroundColor: z.string().optional(),
  userId: z.string().uuid(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  ...LLM_ADVANCED_SHAPE,
  engine: z.enum(["elements", "lottie"]).default("elements"),
  previousSids: z.array(z.string()).max(40).optional(),
})

export async function motionGraphicsAIRoutes(app: FastifyInstance) {
  app.post(
    "/v1/motion-graphics/generate",
    {
      preHandler: [
        aiRateLimit,
        creditGuard((req) => {
          const body = req.body as Record<string, unknown> | undefined
          const feature = motionGraphicsFeature(body?.engine as string | undefined)
          return resolveLlmCreditId(feature, req.body)
        }, {
          // Metered pre-check (a UX check — the reserve holds the real request);
          // undefined under the rollback, so the tier row prices it as before.
          computeCredits: (raw) => {
            const body = (raw ?? {}) as Record<string, unknown>
            return llmPrecheckBaseCredits(
              body.engine === "lottie" ? "motion-graphics-lottie" : "motion-graphics",
              {
                llmModel: typeof body.llmModel === "string" ? body.llmModel : undefined,
                reasoningEffort: typeof body.reasoningEffort === "string" ? body.reasoningEffort : undefined,
                advancedMode: body.advancedMode === true,
                maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
              },
              typeof body.prompt === "string" ? body.prompt.length : 0,
            )
          },
        }),
      ],
      config: { requestTimeout: 60000 } as Record<string, unknown>,
    },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back (the
      // sibling lottie / 3d-title routes do the same; this one was missed).
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/motion-graphics/generate", "motion-graphics")) return
      extendSocketTimeout(req, reply, 60000)

      const parsed = generateBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { prompt, fps, durationSeconds } = parsed.data
      const userId = req.userId

      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "LLM API key not configured",
          },
        })
      }

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["motion-graphics"]

      // Resolve dimensions from aspectRatio or explicit width/height
      let width = parsed.data.width ?? 1920
      let height = parsed.data.height ?? 1080
      if (parsed.data.aspectRatio && ASPECT_DIMENSIONS[parsed.data.aspectRatio]) {
        const dims = ASPECT_DIMENSIONS[parsed.data.aspectRatio]
        width = dims.width
        height = dims.height
      }

      const backgroundColor = parsed.data.backgroundColor ?? "#00000000"
      const durationInFrames = Math.round(durationSeconds * fps)

      // ── Lottie engine (async) ─────────────────────────────────────────────
      // The LLM authors a complete Lottie document; that work is bounded-retry
      // heavy, so it runs on the video worker (generate-script precedent) rather
      // than inline in the request. The route only inserts the job, reserves
      // credits, and enqueues — the worker calls the LLM + validator + finalizes.
      if (parsed.data.engine === "lottie") {
        const lottieLlmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["motion-graphics-lottie"]
        // Reject BEFORE the jobs row exists — a 400 after the insert leaves an
        // orphan `pending` row with no reservation and no queue entry.
        const advancedError = advancedModeError(parsed.data, lottieLlmModel)
        if (advancedError) return reply.status(400).send({ error: advancedError })

        const { data: lottieJob, error: lottieJobError } = await insertJob(req, {
            workflow_id: extractWorkflowId(req.body),
            node_id: extractNodeId(req.body),
            force_private: extractForcePrivate(req.body) || undefined,
            user_id: userId,
            status: "pending",
            input_data: {
              ...buildJobInputData(parsed.data, "motion-graphics"),
              width,
              height,
              backgroundColor,
              engine: "lottie",
            },
          })

        if (lottieJobError) {
          return sendInternalError(reply, req, lottieJobError, "Failed to create job")
        }

        const lottiePayload = {
          jobId: lottieJob.id,
          prompt,
          fps,
          width,
          height,
          durationInFrames,
          backgroundColor,
          llmModel: lottieLlmModel,
          reasoningEffort: parsed.data.reasoningEffort,
          // Rides the queue payload — the LLM call is in the worker.
          advanced: { advancedMode: parsed.data.advancedMode, temperature: parsed.data.temperature, maxTokens: parsed.data.maxTokens },
          previousSids: parsed.data.previousSids,
        }
        // Metered (D1): the hold of the worker's FIRST attempt (the repair
        // re-ask is collected at settle), under `motion-graphics-lottie:<model>`.
        // Under the rollback: the tier id, exactly as before.
        const lottieRequest = buildLottieRequest(lottiePayload)
        const meteredLottie = await reserveLlmCall(req, reply, lottieJob.id, {
          feature: "motion-graphics-lottie",
          calls: [{ modelId: lottieRequest.modelId, request: lottieRequest }],
        })
        if (!meteredLottie || reply.sent) return
        let usageLogId: string | undefined
        if (meteredLottie.metered) {
          usageLogId = meteredLottie.reservation.usageLogId
        } else {
          const modelIdentifier = buildLlmCreditIdentifier("motion-graphics-lottie", lottieLlmModel, parsed.data.reasoningEffort, parsed.data.advancedMode)
          const reservation = await reserveCreditsForJob(req, reply, lottieJob.id, modelIdentifier)
          if (reply.sent) return
          usageLogId = reservation?.usageLogId
        }

        await videoQueue.add("motion-graphics-lottie", { ...lottiePayload, usageLogId })

        return { jobId: lottieJob.id }
      }

      // Reject BEFORE the jobs row exists (see the lottie branch above).
      const advancedErrorElements = advancedModeError(parsed.data, llmModel)
      if (advancedErrorElements) return reply.status(400).send({ error: advancedErrorElements })

      // Create job record
      const { data: job, error: jobError } = await insertSyncJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: { ...buildJobInputData(parsed.data, "motion-graphics"), width, height, backgroundColor },
        })

      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      const userMessage = `Create motion graphics:
- FPS: ${fps}
- Resolution: ${width}x${height}
- Duration: ${durationSeconds} seconds (${durationInFrames} frames)
- Background color: ${backgroundColor}

Prompt: ${prompt}`
      const request: LlmRequest = {
        modelId: llmModel,
        system: MOTION_GRAPHICS_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        ...resolveLlmParams(parsed.data, LLM_ROUTE_DEFAULTS["motion-graphics"]),
        reasoningEffort: parsed.data.reasoningEffort,
      }

      // Reserve credits. Metered (D1): the hold of this request under
      // `motion-graphics:<model>`, settled at the actual below — BEFORE the
      // terminal write (C3). Under the rollback: the tier id, as before.
      const metered = await reserveLlmCall(req, reply, job.id, {
        feature: "motion-graphics",
        calls: [{ modelId: llmModel, request }],
      })
      if (!metered || reply.sent) return
      let usageLogId: string | undefined
      if (!metered.metered) {
        const modelIdentifier = buildLlmCreditIdentifier("motion-graphics", llmModel, parsed.data.reasoningEffort, parsed.data.advancedMode)
        const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
        if (reply.sent) return
        usageLogId = reservation?.usageLogId
      }
      const spend = new LlmSpend()

      // Reconciliation: mark this job inflight before invoking the LLM. The
      // sync-sweep cron uses this to detect stuck rows that the route
      // handler never completed. Best-effort — never throws.
      if (!(await stampSyncLlmCallStart(job.id, metered, reply))) return

      try {
        console.log(`[motion-graphics-ai] Generating for job ${job.id}, ${durationSeconds}s`)

        let response: Awaited<ReturnType<typeof llmComplete>>
        try {
          response = await llmComplete(request)
        } catch (err) {
          spend.add(llmModel, request, { error: err })
          throw err
        }
        spend.add(llmModel, request, { response })

        const rawText = response.text

        // Parse JSON from response
        let rawJson: unknown
        try {
          rawJson = JSON.parse(extractJsonFromAIResponse(rawText))
        } catch {
          console.error(`[motion-graphics-ai] Failed to parse JSON for job ${job.id}`)
          throw new Error("AI returned invalid JSON. Please try again with a different prompt.")
        }

        // Validate and auto-fix
        const validation = validateMotionGraphicsPlan(rawJson, fps, durationInFrames)

        if (validation.autoFixed.length > 0) {
          console.log(`[motion-graphics-ai] Auto-fixed ${validation.autoFixed.length} issues for job ${job.id}`)
        }

        const motionPlan = validation.plan ?? rawJson

        const outputData = {
          motionPlan,
          validationErrors: validation.errors,
          autoFixes: validation.autoFixed,
          usage: response.usage,
        }
        if (metered.metered) {
          // The output first (non-terminal), so the settle's billing ledger is
          // merged into it; then the settle; then the terminal flip — none on
          // `unsettled`, which leaves the row for the reconcile sweep (C3).
          await supabase.from("jobs").update({ output_data: outputData }).eq("id", job.id) // tenant-scope-ignore: job.id is server-generated in this request
          const settled = await settleLlmJob(job.id, metered, spend)
          if (settled.outcome !== "unsettled") await completeSettledSyncJob(job.id)
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

        console.log(`[motion-graphics-ai] Job ${job.id} completed, tokens: ${response.usage?.outputTokens}`)

        return reply.send({
          jobId: job.id,
          motionPlan,
          validationErrors: validation.errors,
          autoFixes: validation.autoFixed,
        })
      } catch (err) {
        const message = userFacingMessage(err, "Motion graphics plan generation failed")
        console.error(`[motion-graphics-ai] Error for job ${job.id}:`, message)

        if (metered.metered) {
          // A billed failure (an answer that would not parse included) is
          // charged its usage; one that billed nothing is refunded. The error
          // goes on output_data FIRST (non-terminal), so the settle's billing
          // ledger is merged beside it; settled BEFORE the terminal write.
          await supabase.from("jobs").update({ output_data: { error: message } }).eq("id", job.id) // tenant-scope-ignore: job.id is server-generated in this request
          const settled = await settleLlmJob(job.id, metered, spend)
          if (settled.outcome !== "unsettled") {
            await markJobFailed(job.id, {
              error_message: settled.outcome === "charged" ? `${message} The model had already answered, so the call was charged.` : message,
            })
          }
        } else {
          await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message } } })

          if (usageLogId) {
            await CreditsService.refundCredits(usageLogId)
          }
        }

        return reply.status(502).send({
          error: { code: llmErrorCode(err), message },
        })
      }
    },
  )
}
