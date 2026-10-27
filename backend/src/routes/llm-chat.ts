import { LLM_ROUTE_REQUEST_TIMEOUT_MS, extendSocketTimeout } from "../lib/llm-route-timeout.js"
import type { FastifyInstance } from "fastify"
import { maybeProxyLlmRouteToCloud, maybeProxyLlmStreamToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertSyncJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../ee/billing/credits.js"
import { createSSEStream } from "../lib/sse.js"
import { llmComplete, llmStream } from "../lib/llm-client.js"
import type { LlmContentBlock, LlmRequest, LlmResponse } from "../lib/llm-client.js"
import { LlmSpend, reserveLlmCall, settleLlmJob, type LlmReserveResult, stampSyncLlmCallStart } from "../lib/llm-billing.js"
import { abortOnClientDisconnect, addCallToSpend, billedEvidence, meteredFailureMessage, meteredTextPrecheck, recordMeteredJobOutput } from "../lib/metered-text-route.js"
import { LLM_MODEL_IDS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS, getLlmModalityCaps } from "@nodaro/shared/llm-models"
import { LLM_TEXT_INPUT_MAX } from "@nodaro/shared/models"
import { advancedModeError, resolveLlmParams } from "../lib/llm-advanced-mode.js"
import { LLM_CHEAP_LANES_SHAPE, cheapLanesParam } from "../lib/llm-cheap-lanes.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { billedProviderCost } from "../lib/llm-errors.js"
import { llmErrorCode, userFacingMessage } from "../lib/user-facing-error.js"
import { completedJobColumns } from "../lib/job-status.js"
import { markJobFailed } from "../lib/job-failure.js"
import { completeSettledSyncJob } from "../lib/metered-sync-completion.js"

const llmChatBody = z.object({
  // LLM_TEXT_INPUT_MAX (100K): the "Generate Text" node feeds an LLM whose
  // context is huge, so the old flat 10000 falsely blocked pasting a document
  // to summarize/rewrite ("cannot use generate-text for longer than 10K").
  systemPrompt: z.string().max(LLM_TEXT_INPUT_MAX),
  userInput: z.string().min(1).max(LLM_TEXT_INPUT_MAX),
  userPrompt: z.string().max(LLM_TEXT_INPUT_MAX).optional(),
  referenceImageUrls: z.array(z.string().url()).max(5).optional(),
  referenceVideoUrls: z.array(z.string().url()).max(3).optional(),
  referenceAudioUrls: z.array(z.string().url()).max(3).optional(),
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

function buildUserContent(
  userInput: string,
  refs: { images?: string[]; videos?: string[]; audios?: string[] },
): string | LlmContentBlock[] {
  const hasMedia = ((refs.images?.length ?? 0) + (refs.videos?.length ?? 0) + (refs.audios?.length ?? 0)) > 0
  if (!hasMedia) return userInput
  const blocks: LlmContentBlock[] = []
  for (const url of refs.images ?? []) blocks.push({ type: "image", url })
  for (const url of refs.videos ?? []) blocks.push({ type: "video", url })
  for (const url of refs.audios ?? []) blocks.push({ type: "audio", url })
  blocks.push({ type: "text", text: userInput })
  return blocks
}

/**
 * Return null if refs are valid for the model, or an error payload when the
 * caller passed video/audio refs to a model that doesn't support them.
 */
function checkModalityOrError(
  llmModel: string,
  refs: { videos?: string[]; audios?: string[] },
): { code: string; message: string } | null {
  const caps = getLlmModalityCaps(llmModel)
  if (refs.videos?.length && !caps.video) {
    return { code: "modality_not_supported", message: `Model ${llmModel} does not support video references. Switch to a Gemini model.` }
  }
  if (refs.audios?.length && !caps.audio) {
    return { code: "modality_not_supported", message: `Model ${llmModel} does not support audio references. Switch to a Gemini model.` }
  }
  return null
}

/** The guard's metered pre-check: the text the route sends (system + user input). */
const llmChatPrecheck = meteredTextPrecheck("llm-chat", {
  schema: llmChatBody,
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
    console.error(`[llm-chat] settling job ${jobId} failed — left to the reconcile sweep:`, err)
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
    console.error(`[llm-chat] settling failed job ${jobId} failed — left to the reconcile sweep:`, settleErr)
    return message
  }
}

export async function llmChatRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // POST /v1/llm-chat/generate  (Synchronous — used by backend orchestrator)
  // ---------------------------------------------------------------------------

  app.post(
    "/v1/llm-chat/generate",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("llm-chat", req.body), { computeCredits: llmChatPrecheck }),
      config: { requestTimeout: LLM_ROUTE_REQUEST_TIMEOUT_MS } as Record<string, unknown>,
    },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/llm-chat/generate", "llm-chat")) return

      // The socket's idle timeout is what closes the connection on a long
      // answer — `config.requestTimeout` above is read by nothing.
      extendSocketTimeout(req, reply, LLM_ROUTE_REQUEST_TIMEOUT_MS)

      const parsed = llmChatBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { systemPrompt, userInput, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, temperature, maxTokens } = parsed.data
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

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["llm-chat"]
      const modalityError = checkModalityOrError(llmModel, { videos: referenceVideoUrls, audios: referenceAudioUrls })
      if (modalityError) {
        return reply.status(400).send({ error: modalityError })
      }
      const advancedError = advancedModeError(parsed.data, llmModel)
      if (advancedError) return reply.status(400).send({ error: advancedError })
      const modelIdentifier = buildLlmCreditIdentifier("llm-chat", llmModel, parsed.data.reasoningEffort, parsed.data.advancedMode)
      // Built once: the metered hold is sized from the very request the lane is sent.
      const request: LlmRequest = {
        modelId: llmModel,
        system: systemPrompt,
        messages: [{ role: "user", content: buildUserContent(userInput, { images: referenceImageUrls, videos: referenceVideoUrls, audios: referenceAudioUrls }) }],
        ...resolveLlmParams(parsed.data, { maxTokens, temperature }),
        ...cheapLanesParam(parsed.data),
        reasoningEffort: parsed.data.reasoningEffort,
      }

      const { data: job, error: jobError } = await insertSyncJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "llm-chat"),
        })

      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      // Metered (the default): hold one attempt of this call. A reference
      // video/audio of unknown length is held at the 60 s default (B3).
      const reserve = await reserveLlmCall(req, reply, job.id, { feature: "llm-chat", calls: [{ modelId: llmModel, request }] })
      if (!reserve || reply.sent) return
      if (reserve.metered) {
        if (!(await stampSyncLlmCallStart(job.id, reserve, reply))) return
        const spend = new LlmSpend()
        let response: LlmResponse
        try {
          response = await llmComplete(request)
        } catch (err) {
          const message = userFacingMessage(err, "LLM API call failed")
          const recorded = addCallToSpend(spend, llmModel, request, { error: err })
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
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      // Reconciliation: mark this job inflight before invoking the LLM. The
      // sync-sweep cron uses this to detect stuck rows that the route
      // handler never completed. Best-effort — never throws.
      await markProviderCallStart(job.id, "anthropic-sync")

      try {
        const response = await llmComplete(request)

        const generatedText = response.text

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
        } catch {
          // Best-effort job finalization — credit commit failure is non-fatal
        }

        return reply.send({ jobId: job.id, generatedText })
      } catch (err) {
        const message = userFacingMessage(err, "LLM API call failed")

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
  // POST /v1/llm-chat/generate-stream  (SSE streaming — used by frontend)
  // ---------------------------------------------------------------------------

  app.post(
    "/v1/llm-chat/generate-stream",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("llm-chat", req.body), { computeCredits: llmChatPrecheck }),
      config: { requestTimeout: LLM_ROUTE_REQUEST_TIMEOUT_MS } as Record<string, unknown>,
    },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmStreamToCloud(req, reply, "/v1/llm-chat/generate-stream")) return

      // The socket's idle timeout is what closes the connection on a long
      // answer — `config.requestTimeout` above is read by nothing.
      extendSocketTimeout(req, reply, LLM_ROUTE_REQUEST_TIMEOUT_MS)

      const parsed = llmChatBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { systemPrompt, userInput, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, temperature, maxTokens } = parsed.data
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

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["llm-chat"]
      const modalityError = checkModalityOrError(llmModel, { videos: referenceVideoUrls, audios: referenceAudioUrls })
      if (modalityError) {
        return reply.status(400).send({ error: modalityError })
      }
      const advancedError = advancedModeError(parsed.data, llmModel)
      if (advancedError) return reply.status(400).send({ error: advancedError })
      const modelIdentifier = buildLlmCreditIdentifier("llm-chat", llmModel, parsed.data.reasoningEffort, parsed.data.advancedMode)
      // Built once: the metered hold is sized from the very request the lane is sent.
      const request: LlmRequest = {
        modelId: llmModel,
        system: systemPrompt,
        messages: [{ role: "user", content: buildUserContent(userInput, { images: referenceImageUrls, videos: referenceVideoUrls, audios: referenceAudioUrls }) }],
        ...resolveLlmParams(parsed.data, { maxTokens, temperature }),
        ...cheapLanesParam(parsed.data),
        reasoningEffort: parsed.data.reasoningEffort,
      }

      const { data: job, error: jobError } = await insertSyncJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "llm-chat-stream"),
        })

      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      // Metered (the default): hold one attempt of this call.
      const reserve = await reserveLlmCall(req, reply, job.id, { feature: "llm-chat", calls: [{ modelId: llmModel, request }] })
      if (!reserve || reply.sent) return
      if (reserve.metered) {
        if (!(await stampSyncLlmCallStart(job.id, reserve, reply))) return
        const sse = await createSSEStream(req, reply)
        sse.sendEvent({ type: "metadata", data: { jobId: job.id, model: llmModel, maxTokens } })
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
          const message = userFacingMessage(err, "LLM API stream failed")
          const recorded = addCallToSpend(spend, llmModel, request, { error: err })
          if (err instanceof Error && err.message !== message) console.error("[llm-chat-stream] Error:", err.message)
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
        await completeMetered(job.id, reserve, spend, recorded)
        if (!sse.isClosed) {
          sse.sendEvent({ type: "done", data: { jobId: job.id, generatedText: fullText, usage: finalResponse.usage } })
          sse.close()
        }
        return
      }

      // LLM_TIER_PRICING_ROLLBACK (or no credits): the tier id, exactly as before.
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      // Reconciliation: mark this job inflight before invoking the LLM. The
      // sync-sweep cron uses this to detect stuck rows that the route
      // handler never completed. Best-effort — never throws.
      await markProviderCallStart(job.id, "anthropic-sync")

      const sse = await createSSEStream(req, reply)

      sse.sendEvent({
        type: "metadata",
        data: { jobId: job.id, model: llmModel, maxTokens },
      })

      const abortController = new AbortController()
      req.raw.once("close", () => abortController.abort())

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

        if (!sse.isClosed) {
          sse.sendEvent({
            type: "done",
            data: {
              jobId: job.id,
              generatedText: fullText,
              usage: finalResponse.usage,
            },
          })
          sse.close()
        }
      } catch (err) {
        // The person reads a model-lane failure's user-safe sentence; the full
        // diagnostic goes to the log.
        const message = userFacingMessage(err, "LLM API stream failed")
        if (err instanceof Error && err.message !== message) console.error("[llm-chat-stream] Error:", err.message)

        await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message }, provider_cost: billedProviderCost(err) } })

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
