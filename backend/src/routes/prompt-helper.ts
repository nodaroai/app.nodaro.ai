import type { FastifyInstance, FastifyReply } from "fastify"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertSyncJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../ee/billing/credits.js"
import { llmCompleteStructured } from "../lib/llm-client.js"
import type { LlmRequest } from "../lib/llm-client.js"
import type { StructuredLlmOutput } from "../lib/llm/structured.js"
import { LlmSpend, reserveLlmCall, settleLlmJob, type LlmReserveResult, stampSyncLlmCallStart } from "../lib/llm-billing.js"
import { addCallToSpend, billedEvidence, meteredFailureMessage, meteredTextPrecheck, recordMeteredJobOutput } from "../lib/metered-text-route.js"
import { LlmOutputTruncatedError, billedContentRefusal, billedProviderCost } from "../lib/llm-errors.js"
import { LLM_ROUTE_DEFAULTS, LLM_MODEL_IDS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { LLM_ADVANCED_SHAPE, advancedModeError, resolveLlmParams } from "../lib/llm-advanced-mode.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { buildWizardAnalyzeSystem, buildWizardGenerateSystem, buildWizardEnhanceSystem } from "../prompts/prompt-wizard-system.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { completedJobColumns } from "../lib/job-status.js"
import { markJobFailed } from "../lib/job-failure.js"
import { llmErrorCode, userFacingMessage } from "../lib/user-facing-error.js"
import { completeSettledSyncJob } from "../lib/metered-sync-completion.js"

const nodeContextSchema = z.object({
  connectedInputTypes: z.array(z.string()).optional(),
  referenceImageCount: z.number().optional(),
  referenceImageUrls: z.array(z.string().url()).max(10).optional(),
  hasSourceVideo: z.boolean().optional(),
}).optional()

const wizardAnalyzeBody = z.object({
  action: z.literal("analyze"),
  nodeType: z.string(),
  prompt: z.string().max(5000).optional(),
  userPrompt: z.string().max(8000).optional(),
  provider: z.string().optional(),
  style: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  ...LLM_ADVANCED_SHAPE,
  nodeContext: nodeContextSchema,
  userPreference: z.string().max(500).optional(),
})

const wizardSelectionSchema = z.object({
  category: z.string(),
  value: z.string(),
  isCustom: z.boolean(),
})

const wizardGenerateBody = z.object({
  action: z.literal("generate"),
  nodeType: z.string(),
  provider: z.string().optional(),
  style: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  ...LLM_ADVANCED_SHAPE,
  selections: z.array(wizardSelectionSchema).min(1),
  originalPrompt: z.string().max(5000).optional(),
  userPrompt: z.string().max(8000).optional(),
  nodeContext: nodeContextSchema,
  userPreference: z.string().max(500).optional(),
})

const wizardEnhanceBody = z.object({
  action: z.literal("enhance"),
  nodeType: z.string(),
  prompt: z.string().max(5000).optional(),
  provider: z.string().optional(),
  style: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  ...LLM_ADVANCED_SHAPE,
  nodeContext: nodeContextSchema,
  userPreference: z.string().max(500).optional(),
})

const wizardBody = z.discriminatedUnion("action", [wizardAnalyzeBody, wizardGenerateBody, wizardEnhanceBody])

// Response validation schemas
const wizardOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

const wizardQuestionSchema = z.object({
  category: z.string(),
  label: z.string(),
  options: z.array(wizardOptionSchema).min(1),
  selected: z.union([z.string(), z.array(z.string()), z.null()]),
  allowCustom: z.boolean(),
  multi: z.boolean().optional(),
})

const analyzeResponseSchema = z.object({
  questions: z.array(wizardQuestionSchema).min(1).max(12),
})

const generateResponseSchema = z.object({
  prompt: z.string().min(1),
  recommendedModel: z.object({
    provider: z.string(),
    field: z.string(),
    label: z.string(),
    reason: z.string(),
  }).optional(),
})

type WizardBody = z.infer<typeof wizardBody>

/** The guard's metered pre-check: the text of the body the wizard sends (its system prompt is built here, on top). */
const promptHelperPrecheck = meteredTextPrecheck("prompt-helper", {
  schema: wizardBody,
  textOf: (b) => [b.action === "generate" ? [b.originalPrompt, b.selections] : b.prompt, b.userPreference],
  // The cap the route sends: the route default, unless Advanced mode lets the body's own through.
  maxTokensOf: (b) => resolveLlmParams(b, LLM_ROUTE_DEFAULTS["prompt-helper"]).maxTokens,
})

/** The wizard's LLM request for `body` — built once, so the metered hold is sized from the very request the lane is sent. */
function buildWizardRequest(body: WizardBody, llmModel: string): LlmRequest {
  let systemPrompt: string
  let userMessage: string

  if (body.action === "analyze") {
    systemPrompt = buildWizardAnalyzeSystem({
      nodeType: body.nodeType,
      provider: body.provider,
      style: body.style,
      aspectRatio: body.aspectRatio,
      duration: body.duration,
      nodeContext: body.nodeContext,
      userPreference: body.userPreference,
    })
    userMessage = body.prompt
      ? `Analyze this prompt idea and generate questions:\n\n${body.prompt}`
      : `Generate questions to help build a ${body.nodeType} prompt from scratch. The user has not provided any initial idea.`
  } else if (body.action === "generate") {
    systemPrompt = buildWizardGenerateSystem({
      nodeType: body.nodeType,
      provider: body.provider,
      style: body.style,
      aspectRatio: body.aspectRatio,
      duration: body.duration,
      selections: body.selections,
      originalPrompt: body.originalPrompt,
      nodeContext: body.nodeContext,
      userPreference: body.userPreference,
    })
    userMessage = `Build a prompt from these selections:\n\n${body.selections.map((s) => `${s.category}: ${s.value}`).join("\n")}`
    if (body.originalPrompt) {
      userMessage += `\n\nOriginal idea: ${body.originalPrompt}`
    }
  } else {
    // enhance — one-shot, no selections
    systemPrompt = buildWizardEnhanceSystem({
      nodeType: body.nodeType,
      provider: body.provider,
      style: body.style,
      aspectRatio: body.aspectRatio,
      duration: body.duration,
      nodeContext: body.nodeContext,
      userPreference: body.userPreference,
    })
    userMessage = body.prompt
      ? `Rewrite this rough idea into one optimized prompt:\n\n${body.prompt}`
      : `Create an optimized ${body.nodeType} prompt from scratch. The user has not provided any initial idea.`
  }

  // Build message content — include reference images for multimodal analysis
  const refUrls = body.action !== "generate" ? (body.nodeContext?.referenceImageUrls ?? []) : []
  let messageContent: string | Array<{ type: "text"; text: string } | { type: "image"; url: string }>

  if (refUrls.length > 0) {
    messageContent = [
      ...refUrls.map((url) => ({ type: "image" as const, url })),
      { type: "text" as const, text: `The above ${refUrls.length === 1 ? "image is a" : `${refUrls.length} images are`} reference image${refUrls.length > 1 ? "s" : ""} connected to this node.\n\n${userMessage}` },
    ]
  } else {
    messageContent = userMessage
  }

  // Schema-constrained generation: the router forces valid output natively
  // where the model supports it (Anthropic tool / Gemini response_format),
  // and validates + retries everywhere else — no more single-shot JSON.parse.
  return {
    modelId: llmModel,
    system: systemPrompt,
    messages: [{ role: "user" as const, content: messageContent }],
    // 8192 (vs 4096): `analyze` can emit up to 12 questions × several
    // options. On the Anthropic forced-tool path a truncated tool call
    // yields empty input → guaranteed validation failure with no salvage,
    // so give the structured output real headroom (capped per-model anyway).
    ...resolveLlmParams(body, LLM_ROUTE_DEFAULTS["prompt-helper"]),
    reasoningEffort: body.reasoningEffort,
  }
}

/** One wizard call: the reply the route sends, and the structured call it came from. */
async function callWizard(
  body: WizardBody,
  request: LlmRequest,
  jobId: string,
): Promise<{ result: Record<string, unknown>; structured: StructuredLlmOutput<unknown> }> {
  if (body.action === "analyze") {
    const s = await llmCompleteStructured(request, analyzeResponseSchema, { schemaName: "questions" })
    return { result: { jobId, questions: s.output.questions }, structured: s }
  }
  // generate + enhance both return { prompt, recommendedModel? }
  const s = await llmCompleteStructured(request, generateResponseSchema, { schemaName: "prompt" })
  return {
    result: {
      jobId,
      prompt: s.output.prompt,
      ...(s.output.recommendedModel && { recommendedModel: s.output.recommendedModel }),
    },
    structured: s,
  }
}

/** The failure reply: `message` is what the person reads; the malformed-response check reads the error's own diagnostic. */
function sendWizardFailure(reply: FastifyReply, err: unknown, message: string, fallback: string) {
  const diagnostic = err instanceof Error ? err.message : fallback
  // A structured-output failure after retries is still a malformed-response
  // situation from the client's perspective (502, not a generic 500). So is
  // a reply cut off at its output cap (#1588): the provider answered, badly.
  const truncated = err instanceof Error && err.cause instanceof LlmOutputTruncatedError
  const isMalformed = diagnostic.includes("Malformed") || diagnostic.includes("invalid JSON") || diagnostic.includes("llm-structured")
  return reply.status(isMalformed || truncated ? 502 : 500).send({
    error: { code: isMalformed ? "malformed_response" : llmErrorCode(err), message },
  })
}

type MeteredReserve = Extract<NonNullable<LlmReserveResult>, { metered: true }>

/**
 * Settle a metered wizard job whose call answered, then — unless `unsettled`
 * (left non-terminal for the reconcile sweep, C3) — mark it completed. The
 * caller recorded the output and its billed evidence (`recordMeteredJobOutput`)
 * before the settle, so the terminal write carries the status only and never
 * clobbers the settle's billing columns. A spend that could not record the call (`!recorded`) is
 * not settled: the row is left to the sweep. Never throws.
 */
async function completeMetered(jobId: string, userId: string, reserve: MeteredReserve, spend: LlmSpend, recorded: boolean): Promise<void> {
  if (!recorded) return
  try {
    const settled = await settleLlmJob(jobId, reserve, spend)
    if (settled.outcome === "unsettled") return
    await completeSettledSyncJob(jobId, { userId })
  } catch (err) {
    console.error(`[prompt-wizard] settling job ${jobId} failed — left to the reconcile sweep:`, err)
  }
}

/**
 * Settle a metered wizard job whose call failed (billed → charged, unbilled →
 * refunded), then — unless `unsettled` — mark it failed. Returns the sentence
 * the person reads: `message`, with the charge stated only when the settle
 * confirmed it. Never throws.
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
    console.error(`[prompt-wizard] settling failed job ${jobId} failed — left to the reconcile sweep:`, settleErr)
    return message
  }
}

export async function promptHelperRoutes(app: FastifyInstance) {
  app.post(
    "/v1/prompt-helper/wizard",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("prompt-helper", req.body), { computeCredits: promptHelperPrecheck }),
    },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/prompt-helper/wizard", "prompt-wizard")) return

      const parsed = wizardBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: { code: "provider_unavailable", message: "LLM API key not configured" },
        })
      }

      const body = parsed.data
      const llmModel = body.llmModel ?? LLM_FEATURE_DEFAULTS["prompt-helper"]
      const advancedError = advancedModeError(body, llmModel)
      if (advancedError) return reply.status(400).send({ error: advancedError })
      const modelIdentifier = buildLlmCreditIdentifier("prompt-helper", llmModel, body.reasoningEffort, body.advancedMode)
      const request = buildWizardRequest(body, llmModel)

      // Create job record
      const { data: job, error: jobError } = await insertSyncJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, `prompt-wizard:${body.action}`),
        })

      if (jobError) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      // Metered (the default): hold one attempt of the wizard call. Its
      // structured re-asks are not held; the settle collects them.
      const reserve = await reserveLlmCall(req, reply, job.id, { feature: "prompt-helper", calls: [{ modelId: llmModel, request }] })
      if (!reserve || reply.sent) return
      if (reserve.metered) {
        // The reconcile sweep's anchor (C3): an unsettled hold is found by it.
        if (!(await stampSyncLlmCallStart(job.id, reserve, reply))) return
        const spend = new LlmSpend()
        let call: Awaited<ReturnType<typeof callWizard>>
        try {
          call = await callWizard(body, request, job.id)
        } catch (err) {
          // Every attempt the failure billed (a content refusal included) is
          // charged what it cost — never the hold; an unbilled one is refunded.
          const message = userFacingMessage(err, "Prompt wizard failed")
          const recorded = addCallToSpend(spend, llmModel, request, { error: err })
          await recordMeteredJobOutput(job.id, { error: message }, billedEvidence(spend, billedProviderCost(err)))
          const shown = await failMetered(job.id, reserve, spend, recorded, err, message)
          return sendWizardFailure(reply, err, shown, message)
        }
        // Outside the call's catch: a ledger error is never read as a provider failure.
        const recorded = addCallToSpend(spend, llmModel, request, { output: call.structured })
        const usage = { inputTokens: call.structured.inputTokens, outputTokens: call.structured.outputTokens }
        await recordMeteredJobOutput(job.id, { ...call.result, usage }, billedEvidence(spend, call.structured.providerCost), recorded ? undefined : reserve.chargeId)
        await completeMetered(job.id, userId, reserve, spend, recorded)
        return reply.send(call.result)
      }

      // LLM_TIER_PRICING_ROLLBACK (or no credits): the tier id, exactly as before.
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const { result, structured: s } = await callWizard(body, request, job.id)
        const usage = { inputTokens: s.inputTokens, outputTokens: s.outputTokens }
        const providerCost = s.providerCost

        // Mark job completed and commit credits
        try {
          await Promise.all([
            supabase.from("jobs").update({ status: "completed", ...completedJobColumns(), output_data: { ...result, usage }, provider_cost: providerCost ?? null }).eq("id", job.id).eq("user_id", userId),
            usageLogId ? CreditsService.commitCredits(usageLogId) : undefined,
          ])
        } catch (postErr) {
          console.error("[prompt-wizard] Post-API error:", postErr)
        }

        return reply.send(result)
      } catch (err) {
        // What the person reads (no lane, vendor or raw provider reply); the
        // malformed-response check below reads the error's own diagnostic.
        const message = userFacingMessage(err, "Prompt wizard failed")

        await Promise.all([
          markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message }, provider_cost: billedProviderCost(err) } }),
          // A content refusal the provider billed is a paid answer: committed, not refunded.
          usageLogId ? (billedContentRefusal(err) ? CreditsService.commitCredits(usageLogId) : CreditsService.refundCredits(usageLogId)) : undefined,
        ])

        return sendWizardFailure(reply, err, message, message)
      }
    },
  )
}
