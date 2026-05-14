import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import { llmComplete } from "../lib/llm-client.js"
import { formatZodError } from "../lib/zod-error.js"

/**
 * POST /v1/llm-suggest-description
 *
 * Generic LLM-helper endpoint backing every ✨ AI-helper button in the studio.
 * Synchronous, single round-trip. Uses Claude Sonnet via llmComplete.
 *
 * TODO (spec Open item #7): deduct 1 CR per call. PR 1 ships without credit
 * deduction because this route is only reachable from the new studio UI
 * (PR 2). Existing studio uses the inline LLM-draft path inside the gen
 * routes (which reserve credits via reserveCreditsForJob); standalone ✨
 * helper is a PR-2 surface.
 */

const KIND = z.enum(["seed-prompt", "asset-description", "motion-description"])

const body = z.object({
  kind: KIND,
  context: z.record(z.unknown()),
})

type Kind = z.infer<typeof KIND>

const PROMPTS: Record<Kind, (ctx: Record<string, unknown>) => { system: string; user: string }> = {
  "seed-prompt": (ctx) => ({
    system:
      "You write concise, vivid one-paragraph character descriptions used as image-gen prompts. " +
      "Focus on visual identity: ethnicity, age, build, facial features, hair, distinctive marks. " +
      "Avoid clothing details unless the user specifies. ~80–150 words. No preamble; output only the description.",
    user: `Picker dimensions: ${JSON.stringify(ctx.dimensions ?? {})}.${
      ctx.existingPrompt ? `\nExisting prompt to improve: ${ctx.existingPrompt}` : ""
    }`,
  }),
  "asset-description": (ctx) => ({
    system:
      "You write concise, single-sentence visual descriptions of a character pose / expression / lighting / angle. " +
      "The description is fed to an image gen model alongside a reference portrait. " +
      "Be specific about facial muscles, body posture, framing as relevant. ~15–25 words. Output only the description.",
    user: `Asset type: ${ctx.assetType}. Variant or prompt: "${ctx.variant ?? ctx.userPrompt}".${
      ctx.canonicalDescription ? `\nCharacter: ${ctx.canonicalDescription}` : ""
    }`,
  }),
  "motion-description": (ctx) => ({
    system:
      "You write concise behavioral descriptions of how a character moves during a short motion clip. " +
      "Focus on rhythm, body language, micro-expressions, eye behavior. ~15–25 words. Output only the description.",
    user: `Motion: "${ctx.variant ?? ctx.userPrompt}".${
      ctx.canonicalDescription ? `\nCharacter: ${ctx.canonicalDescription}` : ""
    }`,
  }),
}

export async function llmSuggestDescriptionRoutes(app: FastifyInstance) {
  app.post("/v1/llm-suggest-description", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
      return reply.status(503).send({
        error: { code: "provider_unavailable", message: "LLM API key not configured" },
      })
    }
    const { system, user } = PROMPTS[parsed.data.kind](parsed.data.context)
    try {
      const result = await llmComplete({
        modelId: "claude-sonnet-4.6",
        system,
        messages: [{ role: "user", content: user }],
        maxTokens: 400,
        temperature: 0.8,
      })
      const text = result.text.trim()
      if (!text) {
        return reply.status(502).send({
          error: { code: "llm_empty_response", message: "LLM returned no text — please retry." },
        })
      }
      return { text }
    } catch (err) {
      const message = err instanceof Error ? err.message : "LLM call failed"
      return reply.status(502).send({ error: { code: "llm_failure", message } })
    }
  })
}
