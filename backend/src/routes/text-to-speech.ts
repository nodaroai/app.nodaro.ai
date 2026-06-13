import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { TTS_PROVIDERS, getMaxTtsChars } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

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
      const provider = (body?.provider as string) ?? "elevenlabs-turbo"
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

    const { text, voice, provider, voiceType, stability, similarityBoost, style, speed, languageCode } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Map legacy "elevenlabs" to "elevenlabs-turbo" for credit check
    const resolvedProvider = provider === "elevenlabs" ? "elevenlabs-turbo" : (provider ?? "elevenlabs-turbo")
    const modelIdentifier = resolvedProvider

    // Clamp to the model's verified per-request character cap (turbo 40000 /
    // multilingual 10000 / v3 3000) so an over-long request can't be rejected by
    // the provider. input_data is built from parsed.data below, so mutate it here.
    parsed.data.text = parsed.data.text.slice(0, getMaxTtsChars(resolvedProvider))

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
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
