import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { llmComplete } from "../lib/llm-client.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"
import { formatZodError } from "../lib/zod-error.js"
import {
  ASSET_DESCRIPTION_SYSTEM_PROMPT,
  ASSET_DESCRIPTION_LLM_OPTIONS,
  buildAssetDescriptionUserMessage,
} from "../lib/asset-description-prompt.js"

/**
 * POST /v1/llm-suggest-description
 *
 * Generic LLM-helper endpoint backing every ✨ AI-helper button in the studio.
 * Synchronous, single round-trip. Uses Claude Sonnet via llmComplete.
 *
 * Metered: every call reserves + commits credits at the shared `prompt-helper`
 * rate (refunded on failure), mirroring the qa-check / image-to-text sync-LLM
 * routes. Without this the endpoint was an uncapped free Claude proxy — any
 * authenticated user could loop it for unlimited completions at Nodaro's cost.
 * Credits are no-ops in non-cloud editions (reserveCreditsForJob returns no
 * usageLogId), so this stays correct in Community/Business.
 */

const KIND = z.enum(["seed-prompt", "asset-description", "motion-description"])

const body = z.object({
  kind: KIND,
  context: z.record(z.unknown()),
})

type Kind = z.infer<typeof KIND>

// All three kinds are short, standard-tier prompt-drafting completions; bill
// them at the shared "prompt-helper" rate (model_pricing / STATIC_CREDIT_COSTS).
const CREDIT_IDENTIFIER = "prompt-helper"

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
    { preHandler: creditGuard(() => CREDIT_IDENTIFIER) },
    async (req, reply) => {
      if (!req.userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      const parsed = body.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      // llmComplete is called with modelId="claude-sonnet-4.6" which routes
      // through Anthropic specifically. Without ANTHROPIC_API_KEY the LLM call
      // 502s mid-request — gate it here with a clean 503 instead. (Checked
      // before reserving credits so a misconfigured server never charges.)
      if (!config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: { code: "provider_unavailable", message: "Anthropic API key not configured" },
        })
      }

      const userId = req.userId

      // Audit-trail job row (mirrors qa-check / image-to-text). Reserve credits
      // against it; commit on success, refund on any failure.
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          user_id: userId,
          status: "pending",
          input_data: { type: "llm-suggest-description", kind: parsed.data.kind },
        })
        .select("id")
        .single()
      if (jobError || !job) {
        return reply.status(500).send({
          error: { code: "internal_error", message: jobError?.message ?? "Failed to create job" },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, CREDIT_IDENTIFIER)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId
      // Core stays free of static ee/ imports — load the credit service lazily
      // (only when a reservation actually happened, i.e. cloud edition).
      const credits = usageLogId
        ? (await import("../ee/services/credits.js")).CreditsService
        : null

      const { system, user, options } = PROMPTS[parsed.data.kind](parsed.data.context)
      try {
        const result = await llmComplete({
          modelId: "claude-sonnet-4.6",
          system,
          messages: [{ role: "user", content: user }],
          ...options,
        })
        const text = result.text.trim()
        if (!text) {
          await supabase
            .from("jobs")
            .update({ status: "failed", output_data: { error: "empty response" } })
            .eq("id", job.id)
            .eq("user_id", userId)
          if (credits && usageLogId) await credits.refundCredits(usageLogId)
          return reply.status(502).send({
            error: { code: "llm_empty_response", message: "LLM returned no text — please retry." },
          })
        }
        await supabase
          .from("jobs")
          .update({ status: "completed", output_data: { text } })
          .eq("id", job.id)
          .eq("user_id", userId)
        if (credits && usageLogId) await credits.commitCredits(usageLogId)
        return { text }
      } catch (err) {
        const message = err instanceof Error ? err.message : "LLM call failed"
        await supabase
          .from("jobs")
          .update({ status: "failed", output_data: { error: message } })
          .eq("id", job.id)
          .eq("user_id", userId)
        if (credits && usageLogId) await credits.refundCredits(usageLogId)
        return reply.status(502).send({ error: { code: "llm_failure", message } })
      }
    },
  )
}
