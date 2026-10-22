import { LLM_ROUTE_REQUEST_TIMEOUT_MS } from "../lib/llm-route-timeout.js"
import type { FastifyInstance } from "fastify"
import { maybeProxyLlmRouteToCloud, maybeProxyLlmStreamToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertSyncJob } from "../lib/insert-job.js"
import { sendInternalError } from "../lib/http-errors.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../ee/billing/credits.js"
import { createSSEStream } from "../lib/sse.js"
import { llmComplete, llmStream } from "../lib/llm-client.js"
import type { LlmRequest, LlmResponse } from "../lib/llm-client.js"
import { LlmSpend, reserveLlmCall, settleLlmJob, type LlmReserveResult, stampSyncLlmCallStart } from "../lib/llm-billing.js"
import { abortOnClientDisconnect, addCallToSpend, billedEvidence, meteredFailureMessage, meteredTextPrecheck, recordMeteredJobOutput } from "../lib/metered-text-route.js"
import { LLM_MODEL_IDS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { LLM_TEXT_INPUT_MAX } from "@nodaro/shared/models"
import { advancedModeError, resolveLlmParams } from "../lib/llm-advanced-mode.js"
import { LLM_CHEAP_LANES_SHAPE, cheapLanesParam } from "../lib/llm-cheap-lanes.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { billedProviderCost } from "../lib/llm-errors.js"
import { llmErrorCode, userFacingMessage } from "../lib/user-facing-error.js"
import { completedJobColumns } from "../lib/job-status.js"
import { markJobFailed } from "../lib/job-failure.js"
import { completeSettledSyncJob } from "../lib/metered-sync-completion.js"

const aiWriterBody = z.object({
  // LLM_TEXT_INPUT_MAX (100K) — same rationale as llm-chat: the input feeds an
  // LLM with a huge context, so the old flat 10000 falsely blocked long briefs.
  systemPrompt: z.string().max(LLM_TEXT_INPUT_MAX),
  userInput: z.string().min(1).max(LLM_TEXT_INPUT_MAX),
  userPrompt: z.string().max(LLM_TEXT_INPUT_MAX).optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  // 32768 matches LLM_ADVANCED_SHAPE and the Advanced-mode input's ceiling.
  // At 16384 a value the panel accepts hard-400s every later run of that node.
  maxTokens: z.number().min(1).max(32768).default(8192),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  advancedMode: z.boolean().optional(),
  ...LLM_CHEAP_LANES_SHAPE,
})

/** The guard's metered pre-check: the text the route sends (system + user input). */
const aiWriterPrecheck = meteredTextPrecheck("ai-writer", {
  schema: aiWriterBody,
  textOf: (b) => [b.systemPrompt, b.userInput],
  // The cap the route sends: resolveLlmParams over the (schema-defaulted) body maxTokens.
  maxTokensOf: (b) => resolveLlmParams(b, { maxTokens: b.maxTokens }).maxTokens,
})

type MeteredReserve = Extract<NonNullable<LlmReserveResult>, { metered: true }>

/**
 * Settle a metered job whose call answered, then — unless the settle is
 * `unsettled` (the row is left non-terminal for the reconcile sweep, C3) —
 * mark it completed. The caller recorded the output and its billed evidence
 * (`recordMeteredJobOutput`) before the settle, so the terminal write carries
 * the status only and never clobbers the billing columns. A spend that could not record
 * the call (`!recorded`) is not settled: the row is left to the sweep, which
 * charges its hold from the evidence. Never throws — a settle that crashes
 * leaves the row to the sweep the same way.
 */
async function completeMetered(jobId: string, reserve: MeteredReserve, spend: LlmSpend, recorded: boolean): Promise<void> {
  if (!recorded) return
  try {
    const settled = await settleLlmJob(jobId, reserve, spend)
    if (settled.outcome === "unsettled") return
    await completeSettledSyncJob(jobId)
  } catch (err) {
    console.error(`[ai-writer] settling job ${jobId} failed — left to the reconcile sweep:`, err)
  }
}

/**
 * Settle a metered job whose call failed (a billed failure is charged, an
 * unbilled one refunded), then — unless `unsettled` — mark it failed. Returns
 * the sentence the person reads: `message`, with the charge stated only when
 * the settle confirmed it (`meteredFailureMessage`). Never throws.
 */
async function failMetered(jobId: string, reserve: MeteredReserve, spend: LlmSpend, recorded: boolean, err: unknown, message: string): Promise<string> {
  if (!recorded) return message
  try {
    const settled = await settleLlmJob(jobId, reserve, spend)
    if (settled.outcome === "unsettled") return message
    const shown = meteredFailureMessage(err, message, settled)
    await markJobFailed(jobId, { error_message: shown })
    return shown
  } catch (settleErr) {
    console.error(`[ai-writer] settling failed job ${jobId} failed — left to the reconcile sweep:`, settleErr)
    return message
  }
}

export async function aiWriterRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // POST /v1/ai-writer/generate  (Legacy synchronous endpoint)
  // ---------------------------------------------------------------------------

  app.post(
    "/v1/ai-writer/generate",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("ai-writer", req.body), { computeCredits: aiWriterPrecheck }),
      config: { requestTimeout: LLM_ROUTE_REQUEST_TIMEOUT_MS } as Record<string, unknown>,
    },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/ai-writer/generate", "ai-writer")) return

      // Set timeouts at every layer to prevent premature connection close
      // The socket's idle timeout is what closes the connection on a long
      // answer — `config.requestTimeout` above is read by nothing.
      req.raw.setTimeout(LLM_ROUTE_REQUEST_TIMEOUT_MS)
      reply.raw.setTimeout(LLM_ROUTE_REQUEST_TIMEOUT_MS)

      const parsed = aiWriterBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { systemPrompt, userInput, temperature, maxTokens } =
        parsed.data
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

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["ai-writer"]
      const advancedError = advancedModeError(parsed.data, llmModel)
      if (advancedError) return reply.status(400).send({ error: advancedError })
      const modelIdentifier = buildLlmCreditIdentifier("ai-writer", llmModel, parsed.data.reasoningEffort, parsed.data.advancedMode)
      // Built once: the metered hold is sized from the very request the lane is sent.
      const request: LlmRequest = {
        modelId: llmModel,
        system: systemPrompt,
        messages: [{ role: "user", content: userInput }],
        ...resolveLlmParams(parsed.data, { maxTokens, temperature }),
        ...cheapLanesParam(parsed.data),
        reasoningEffort: parsed.data.reasoningEffort,
      }

      // Create a job record for audit trail
      const { data: job, error: jobError } = await insertSyncJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "ai-writer"),
        })

      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      // Metered (the default): hold one attempt of this call.
      const reserve = await reserveLlmCall(req, reply, job.id, { feature: "ai-writer", calls: [{ modelId: llmModel, request }] })
      if (!reserve || reply.sent) return
      if (reserve.metered) {
        if (!(await stampSyncLlmCallStart(job.id, reserve, reply))) return
        const spend = new LlmSpend()
        let response: LlmResponse
        try {
          response = await llmComplete(request)
        } catch (err) {
          const message = userFacingMessage(err, "Claude API call failed")
          const recorded = addCallToSpend(spend, llmModel, request, { error: err })
          console.error("[ai-writer] Error details:", JSON.stringify(err, null, 2))
          await recordMeteredJobOutput(job.id, { error: message }, billedEvidence(spend, billedProviderCost(err)))
          const shown = await failMetered(job.id, reserve, spend, recorded, err, message)
          return reply.status(502).send({ error: { code: llmErrorCode(err), message: shown } })
        }
        // Outside the call's catch: a ledger error is never read as a provider failure.
        const recorded = addCallToSpend(spend, llmModel, request, { response })
        await recordMeteredJobOutput(
          job.id,
          { generatedText: response.text, model: llmModel, usage: response.usage },
          billedEvidence(spend, response.providerCost),
          recorded ? undefined : reserve.chargeId,
        )
        await completeMetered(job.id, reserve, spend, recorded)
        return reply.send({ jobId: job.id, generatedText: response.text })
      }

      // LLM_TIER_PRICING_ROLLBACK (or no credits): the tier id, exactly as before.
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
        const response = await llmComplete(request)

        const generatedText = response.text

        // Finalize job and credits
        try {
          await supabase
            .from("jobs") // tenant-scope-ignore: job.id is server-generated in this request
            .update({
              status: "completed",
              ...completedJobColumns(),
              output_data: { generatedText, model: llmModel, usage: response.usage },
              provider_cost: response.providerCost ?? null,
            })
            .eq("id", job.id)

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
          }
        } catch (postErr) {
          console.error("[ai-writer] Post-API error:", postErr)
        }

        return reply.send({ jobId: job.id, generatedText })
      } catch (err) {
        const message =
          userFacingMessage(err, "Claude API call failed")

        console.error("[ai-writer] Error details:", JSON.stringify(err, null, 2))

        await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message }, provider_cost: billedProviderCost(err) } })

        if (usageLogId) {
          await CreditsService.refundCredits(usageLogId)
        }

        return reply.status(502).send({
          error: { code: llmErrorCode(err), message },
        })
      }
    },
  )

  // ---------------------------------------------------------------------------
  // POST /v1/ai-writer/generate-stream  (SSE streaming version)
  // ---------------------------------------------------------------------------

  app.post(
    "/v1/ai-writer/generate-stream",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("ai-writer", req.body), { computeCredits: aiWriterPrecheck }),
      config: { requestTimeout: LLM_ROUTE_REQUEST_TIMEOUT_MS } as Record<string, unknown>,
    },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmStreamToCloud(req, reply, "/v1/ai-writer/generate-stream")) return

      // The socket's idle timeout is what closes the connection on a long
      // answer — `config.requestTimeout` above is read by nothing.
      req.raw.setTimeout(LLM_ROUTE_REQUEST_TIMEOUT_MS)
      reply.raw.setTimeout(LLM_ROUTE_REQUEST_TIMEOUT_MS)

      const parsed = aiWriterBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { systemPrompt, userInput, temperature, maxTokens } =
        parsed.data
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

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["ai-writer"]
      const advancedError = advancedModeError(parsed.data, llmModel)
      if (advancedError) return reply.status(400).send({ error: advancedError })
      const modelIdentifier = buildLlmCreditIdentifier("ai-writer", llmModel, parsed.data.reasoningEffort, parsed.data.advancedMode)
      // Built once: the metered hold is sized from the very request the lane is sent.
      const request: LlmRequest = {
        modelId: llmModel,
        system: systemPrompt,
        messages: [{ role: "user", content: userInput }],
        ...resolveLlmParams(parsed.data, { maxTokens, temperature }),
        ...cheapLanesParam(parsed.data),
        reasoningEffort: parsed.data.reasoningEffort,
      }

      // Create job record
      const { data: job, error: jobError } = await insertSyncJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "ai-writer-stream"),
        })

      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      // Metered (the default): hold one attempt of this call.
      const reserve = await reserveLlmCall(req, reply, job.id, { feature: "ai-writer", calls: [{ modelId: llmModel, request }] })
      if (!reserve || reply.sent) return
      if (reserve.metered) {
        if (!(await stampSyncLlmCallStart(job.id, reserve, reply))) return
        // Open SSE stream -- from here on, errors go through the stream
        const sse = await createSSEStream(req, reply)
        sse.sendEvent({ type: "metadata", data: { jobId: job.id, model: llmModel, maxTokens } })
        // Abort upstream LLM stream when client disconnects
        const abortController = new AbortController()
        // The CLIENT's disconnect (the response closing early) stops the stream:
        // charged its estimated usage (D2), or refunded if not yet dispatched.
        abortOnClientDisconnect(reply, abortController)

        let fullText = ""
        const spend = new LlmSpend()
        let finalResponse: LlmResponse
        try {
          finalResponse = await llmStream(
            request,
            (delta) => {
              if (sse.isClosed) return
              fullText += delta
              sse.sendEvent({ type: "token", data: delta })
            },
            abortController.signal,
          )
        } catch (err) {
          // A stream the person stopped is charged its estimated usage (D2:
          // `LlmStreamAbortedError`); one stopped before it was sent billed
          // nothing and is refunded.
          const message = userFacingMessage(err, "Claude API stream failed")
          const recorded = addCallToSpend(spend, llmModel, request, { error: err })
          console.error("[ai-writer-stream] Error:", err instanceof Error ? err.message : message)
          await recordMeteredJobOutput(job.id, { error: message }, billedEvidence(spend, billedProviderCost(err)))
          const shown = await failMetered(job.id, reserve, spend, recorded, err, message)
          if (!sse.isClosed) {
            sse.sendEvent({ type: "error", data: { code: llmErrorCode(err), message: shown } })
            sse.close()
          }
          return
        }
        // Outside the call's catch: a ledger error is never read as a provider failure.
        const recorded = addCallToSpend(spend, llmModel, request, { response: finalResponse })
        await recordMeteredJobOutput(
          job.id,
          { generatedText: fullText, model: llmModel, usage: finalResponse.usage },
          billedEvidence(spend, finalResponse.providerCost),
          recorded ? undefined : reserve.chargeId,
        )
        // Settled whether or not the client is still there: the answer finished
        // (the early-complete path settles exactly like the normal one).
        await completeMetered(job.id, reserve, spend, recorded)
        if (!sse.isClosed) {
          sse.sendEvent({ type: "done", data: { jobId: job.id, generatedText: fullText, usage: finalResponse.usage } })
          sse.close()
        }
        return
      }

      // LLM_TIER_PRICING_ROLLBACK (or no credits): the tier id, exactly as before.
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

      // Open SSE stream -- from here on, errors go through the stream
      const sse = await createSSEStream(req, reply)

      sse.sendEvent({
        type: "metadata",
        data: { jobId: job.id, model: llmModel, maxTokens },
      })

      // Abort upstream LLM stream when client disconnects
      const abortController = new AbortController()
      req.raw.on("close", () => abortController.abort())

      let fullText = ""

      try {
        const finalResponse = await llmStream(
          request,
          (delta) => {
            if (sse.isClosed) return
            fullText += delta
            sse.sendEvent({ type: "token", data: delta })
          },
          abortController.signal,
        )

        if (sse.isClosed) {
          // Still finalize job and credits even if client disconnected
          await supabase
            .from("jobs") // tenant-scope-ignore: job.id is server-generated in this request
            .update({
              status: "completed",
              ...completedJobColumns(),
              output_data: {
                generatedText: fullText,
                model: llmModel,
                usage: finalResponse.usage,
              },
              provider_cost: finalResponse.providerCost ?? null,
            })
            .eq("id", job.id)

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
          }
          return
        }

        // Finalize job
        await supabase
          .from("jobs") // tenant-scope-ignore: job.id is server-generated in this request
          .update({
            status: "completed",
            ...completedJobColumns(),
            output_data: {
              generatedText: fullText,
              model: llmModel,
              usage: finalResponse.usage,
            },
            provider_cost: finalResponse.providerCost ?? null,
          })
          .eq("id", job.id)

        // Commit credits
        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        sse.sendEvent({
          type: "done",
          data: {
            jobId: job.id,
            generatedText: fullText,
            usage: finalResponse.usage,
          },
        })
        sse.close()
      } catch (err) {
        // The person reads a model-lane failure's user-safe sentence; the full
        // diagnostic goes to the log.
        const message = userFacingMessage(err, "Claude API stream failed")

        console.error("[ai-writer-stream] Error:", err instanceof Error ? err.message : message)

        // Mark job as failed
        await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message }, provider_cost: billedProviderCost(err) } })

        // Refund credits
        if (usageLogId) {
          await CreditsService.refundCredits(usageLogId)
        }

        if (!sse.isClosed) {
          sse.sendEvent({
            type: "error",
            data: { code: llmErrorCode(err), message },
          })
          sse.close()
        }
      }
    },
  )
}
