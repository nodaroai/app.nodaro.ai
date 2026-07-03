import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { TTS_PROVIDERS, getMaxTtsChars } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

/**
 * Resolve the effective TTS provider when the caller omits `provider` entirely.
 *
 * v3 is the default for the common case (matches the editor's default and is
 * the highest-quality model), but v3's per-request cap
 * (`getMaxTtsChars("elevenlabs-v3")`, currently 3,000 chars) is far below the
 * route's 40,000-char ceiling. A legacy integration that always omits
 * `provider` and sends long text would otherwise be silently truncated by
 * the v3 clamp below it (previously "elevenlabs" aliased to turbo, cap
 * 40,000, effectively lossless). Falling back to turbo once text exceeds the
 * v3 cap preserves that legacy lossless behavior for long-text callers.
 * Reads the cap from the shared constant (not a literal 3000) so a future
 * change to elevenlabs-v3's cap flows through automatically.
 */
export function resolveOmittedTtsProvider(text: string): "elevenlabs-v3" | "elevenlabs-turbo" {
  return text.length <= getMaxTtsChars("elevenlabs-v3") ? "elevenlabs-v3" : "elevenlabs-turbo"
}

export const textToSpeechBody = z.object({
  // Generous ceiling (eleven_turbo_v2.5 accepts 40000); the per-model cap is
  // clamped in the handler and the editor warns first (warn-don't-block).
  text: z.string().min(1).max(40000),
  userPrompt: z.string().max(8000).optional(),
  voice: z.string().optional(),
  provider: z.enum(TTS_PROVIDERS).optional(),
  userId: z.string().uuid().optional(),
  voiceType: z.enum(["premade", "custom", "library"]).optional().default("premade"),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.7).max(1.2).optional(),
  languageCode: z.string().optional(),
})

export async function textToSpeechRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-speech", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      // v3 = fully-multilingual default; legacy "elevenlabs" alias intentionally stays on turbo.
      // Length-aware: an omitted provider resolves to turbo (not v3) once the
      // text exceeds v3's cap, so long legacy requests aren't under-priced
      // for v3 credits then rejected/truncated by the v3-specific clamp.
      const provider = (body?.provider as string) ?? resolveOmittedTtsProvider((body?.text as string) ?? "")
      // Map legacy "elevenlabs" to "elevenlabs-turbo" for credit lookup
      return provider === "elevenlabs" ? "elevenlabs-turbo" : provider
    }),
  }, async (req, reply) => {
    const parsed = textToSpeechBody.safeParse(req.body)
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

    // Map legacy "elevenlabs" to "elevenlabs-turbo" for credit check
    // v3 = fully-multilingual default; legacy "elevenlabs" alias intentionally stays on turbo.
    // Same length-aware resolution as the creditGuard resolver above — kept
    // in the one shared helper so the two seams can't drift.
    const resolvedProvider =
      parsed.data.provider === "elevenlabs"
        ? "elevenlabs-turbo"
        : (parsed.data.provider ?? resolveOmittedTtsProvider(parsed.data.text))
    const modelIdentifier = resolvedProvider

    // Clamp to the model's verified per-request character cap (turbo 40000 /
    // multilingual 10000 / v3 3000) so an over-long request can't be rejected by
    // the provider. Mutate parsed.data BEFORE destructuring below so both
    // input_data (built from parsed.data) and the queue payload (built from
    // the destructured `text`) see the clamped value.
    parsed.data.text = parsed.data.text.slice(0, getMaxTtsChars(resolvedProvider))

    const { text, voice, voiceType, stability, similarityBoost, style, speed, languageCode } = parsed.data

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "text-to-speech"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("text-to-speech", {
      jobId: job.id,
      text,
      voice,
      provider: resolvedProvider,
      voiceType,
      usageLogId,
      stability,
      similarityBoost,
      style,
      speed,
      languageCode,
      // LLM-originated (MCP) requests may carry a hallucinated voice id —
      // only they get the Rachel voice_not_found fallback. User-picked
      // voices fail loudly (see directElevenLabsTTS).
      allowDefaultVoiceFallback: Boolean(mcpClient),
    })

    return { jobId: job.id }
  })
}
