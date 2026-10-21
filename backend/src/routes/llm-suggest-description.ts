import type { FastifyInstance } from "fastify"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { z } from "zod"
import { insertSyncJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { llmComplete, type LlmRequest } from "../lib/llm-client.js"
import { LlmSpend, reserveLlmCall, stampSyncLlmCallStart } from "../lib/llm-billing.js"
import { chargedFailureMessage, finishMeteredSyncLlmJob, llmGuardPrecheck, spendLlmCall } from "../lib/meter-sync-llm.js"
import { claudeLaneConfigured } from "../lib/llm/anthropic-availability.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId } from "../lib/request-helpers.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  ASSET_DESCRIPTION_SYSTEM_PROMPT,
  ASSET_DESCRIPTION_LLM_OPTIONS,
  buildAssetDescriptionUserMessage,
} from "../lib/asset-description-prompt.js"
import { completedJobColumns } from "../lib/job-status.js"
import { markJobFailed } from "../lib/job-failure.js"
import { userFacingMessage } from "../lib/user-facing-error.js"

/**
 * POST /v1/llm-suggest-description
 *
 * Generic LLM-helper endpoint backing every ✨ AI-helper button in the studio.
 * Synchronous, single round-trip. Uses Claude Sonnet via llmComplete.
 *
 * Metered (D3): every call is held and settled under
 * `prompt-helper:<model>` at what it cost (a billed failure charged, an
 * unbilled one refunded). Under the rollback it reserves + commits the flat
 * `prompt-helper` rate (refunded on failure), exactly as before. Without this the endpoint was an uncapped free Claude proxy — any
 * authenticated user could loop it for unlimited completions at Nodaro's cost.
 * Credits are no-ops in non-cloud editions (reserveCreditsForJob returns no
 * usageLogId), so this stays correct in Community/Business.
 */

const KIND = z.enum(["seed-prompt", "asset-description", "motion-description"])

const body = z.object({
  kind: KIND,
  context: z.record(z.string(), z.unknown()),
})

type Kind = z.infer<typeof KIND>

// All three kinds are short, standard-tier prompt-drafting completions; bill
// them at the shared "prompt-helper" rate (model_pricing / STATIC_CREDIT_COSTS).
const CREDIT_IDENTIFIER = "prompt-helper"
/** The helper's model — fixed in code, so its metered price follows it. */
const SUGGEST_MODEL = "claude-sonnet-4.6"

interface PromptSpec {
  system: string
  user: string
  options: { maxTokens: number; temperature: number }
}

// Non-asset-description kinds keep their own local options here; they are
// intentionally NOT shared with the inline asset-description path. The
// asset-description branch routes through ASSET_DESCRIPTION_LLM_OPTIONS so
// the standalone helper and the inline draft in generate-character-asset.ts
// cannot drift.
const NON_ASSET_LLM_OPTIONS = { maxTokens: 400, temperature: 0.8 } as const

const PROMPTS: Record<Kind, (ctx: Record<string, unknown>) => PromptSpec> = {
  "seed-prompt": (ctx) => ({
    system:
      "You write concise, vivid one-paragraph character descriptions used as image-gen prompts. " +
      "Focus on visual identity: ethnicity, age, build, facial features, hair, distinctive marks. " +
      "Avoid clothing details unless the user specifies. ~80–150 words. No preamble; output only the description.",
    user: `Picker dimensions: ${JSON.stringify(ctx.dimensions ?? {})}.${
      ctx.existingPrompt ? `\nExisting prompt to improve: ${ctx.existingPrompt}` : ""
    }`,
    options: NON_ASSET_LLM_OPTIONS,
  }),
  "asset-description": (ctx) => ({
    system: ASSET_DESCRIPTION_SYSTEM_PROMPT,
    user: buildAssetDescriptionUserMessage({
      assetType: typeof ctx.assetType === "string" ? ctx.assetType : "",
      variant: typeof ctx.variant === "string" ? ctx.variant : undefined,
      userPrompt: typeof ctx.userPrompt === "string" ? ctx.userPrompt : undefined,
      canonicalDescription:
        typeof ctx.canonicalDescription === "string" ? ctx.canonicalDescription : null,
    }),
    options: ASSET_DESCRIPTION_LLM_OPTIONS,
  }),
  "motion-description": (ctx) => ({
    system:
      "You write concise behavioral descriptions of how a character moves during a short motion clip. " +
      "Focus on rhythm, body language, micro-expressions, eye behavior. ~15–25 words. Output only the description.",
    user: `Motion: "${ctx.variant ?? ctx.userPrompt}".${
      ctx.canonicalDescription ? `\nCharacter: ${ctx.canonicalDescription}` : ""
    }`,
    options: NON_ASSET_LLM_OPTIONS,
  }),
}

export async function llmSuggestDescriptionRoutes(app: FastifyInstance) {
  app.post(
    "/v1/llm-suggest-description",
    {
      preHandler: creditGuard(() => CREDIT_IDENTIFIER, {
        // Metered (D3): the pre-check is the call's 1-attempt hold (the body's
        // text); undefined under the rollback. Every kind caps at ≤ 400 tokens
        // except asset-description (its shared options) — the guard prices the
        // larger cap of the two.
        computeCredits: (body) => llmGuardPrecheck("prompt-helper", body, {
          llmModel: SUGGEST_MODEL,
          maxTokens: Math.max(NON_ASSET_LLM_OPTIONS.maxTokens, ASSET_DESCRIPTION_LLM_OPTIONS.maxTokens),
        }),
      }),
    },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/llm-suggest-description", "llm-suggest-description")) return

      if (!req.userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      const parsed = body.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      // llmComplete is called with modelId="claude-sonnet-4.6", which the
      // router serves on KIE or on the Anthropic account — refuse only when
      // neither is configured. (Checked before reserving credits so a
      // misconfigured server never charges.)
      if (!claudeLaneConfigured()) {
        return reply.status(503).send({
          error: { code: "provider_unavailable", message: "No AI provider key is configured" },
        })
      }

      const userId = req.userId

      // Audit-trail job row (mirrors qa-check / image-to-text). Reserve credits
      // against it; commit on success, refund on any failure.
      const { data: job, error: jobError } = await insertSyncJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          user_id: userId,
          status: "pending",
          input_data: { type: "llm-suggest-description", kind: parsed.data.kind },
        })
      if (jobError || !job) {
        return sendInternalError(reply, req, jobError, "Failed to create job")
      }

      const { system, user, options } = PROMPTS[parsed.data.kind](parsed.data.context)
      const request: LlmRequest = {
        modelId: SUGGEST_MODEL,
        system,
        messages: [{ role: "user", content: user }],
        ...options,
      }

      // Metered (the call's 1-attempt hold) — else the flat prompt-helper rate, as before.
      const reserve = await reserveLlmCall(req, reply, job.id, { feature: "prompt-helper", calls: [{ modelId: SUGGEST_MODEL, request }] })
      if (!reserve) return
      if (reserve.metered) {
        // The reconcile sweep's anchor (C3): an unsettled metered hold is found by it.
        if (!(await stampSyncLlmCallStart(job.id, reserve, reply))) return
        const spend = new LlmSpend()
        try {
          const result = await spendLlmCall(spend, SUGGEST_MODEL, request, () => llmComplete(request))
          const text = result.text.trim()
          if (!text) {
            // An empty answer the provider billed is charged (and says so).
            const finished = await finishMeteredSyncLlmJob(job.id, reserve, spend, {
              status: "failed",
              errorMessage: "empty response",
              outputData: { error: "empty response" },
            })
            return reply.status(502).send({
              error: { code: "llm_empty_response", message: chargedFailureMessage("LLM returned no text — please retry.", finished.settled) },
            })
          }
          await finishMeteredSyncLlmJob(job.id, reserve, spend, { status: "completed", outputData: { text } })
          return { text }
        } catch (err) {
          const message = userFacingMessage(err, "LLM call failed")
          const finished = await finishMeteredSyncLlmJob(job.id, reserve, spend, { status: "failed", errorMessage: message, outputData: { error: message } })
          return reply.status(502).send({ error: { code: "llm_failure", message: finished.errorMessage ?? message } })
        }
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, CREDIT_IDENTIFIER)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId
      // Core stays free of static ee/ imports — load the credit service lazily
      // (only when a reservation actually happened, i.e. cloud edition).
      const credits = usageLogId
        ? (await import("../ee/services/credits.js")).CreditsService
        : null

      try {
        const result = await llmComplete({
          modelId: SUGGEST_MODEL,
          system,
          messages: [{ role: "user", content: user }],
          ...options,
        })
        const text = result.text.trim()
        if (!text) {
          await markJobFailed(job.id, { error_message: "empty response", extra: { output_data: { error: "empty response" } } })
          if (credits && usageLogId) await credits.refundCredits(usageLogId)
          return reply.status(502).send({
            error: { code: "llm_empty_response", message: "LLM returned no text — please retry." },
          })
        }
        await supabase
          .from("jobs")
          .update({ status: "completed", ...completedJobColumns(), output_data: { text } })
          .eq("id", job.id)
          .eq("user_id", userId)
        if (credits && usageLogId) await credits.commitCredits(usageLogId)
        return { text }
      } catch (err) {
        const message = userFacingMessage(err, "LLM call failed")
        await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message } } })
        if (credits && usageLogId) await credits.refundCredits(usageLogId)
        return reply.status(502).send({ error: { code: "llm_failure", message } })
      }
    },
  )
}
