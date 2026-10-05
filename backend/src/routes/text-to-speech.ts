import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { TTS_PROVIDERS, getMaxTtsChars } from "@nodaro/shared"
import { resolveOmittedTtsProvider } from "../lib/omitted-tts-provider.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isVoiceGenderAllowed, premadeVoiceGender } from "../lib/voice-policy.js"
import { TTS_VOICE_SETTING_RANGES, type TtsVoiceSettingKey } from "../providers/elevenlabs/voice-settings.js"

/**
 * A voice setting, validated with the range the provider funnel clamps into (one source of truth, so the route and
 * the funnel cannot disagree). The route still rejects what the funnel would clamp or ignore: a REST caller gets a
 * 400, not a silently changed request.
 */
const voiceSetting = (key: TtsVoiceSettingKey) =>
  z.number().min(TTS_VOICE_SETTING_RANGES[key].min).max(TTS_VOICE_SETTING_RANGES[key].max).optional()

// An omitted `provider` resolves through `resolveOmittedTtsProvider` (lib/omitted-tts-provider.ts):
// the default speech model up to its own cap, turbo above it. A legacy integration that always omits
// `provider` and sends long text keeps its lossless behaviour (turbo, cap 40,000) instead of being
// truncated by the default model's clamp below. The workflow engine, the narration pipeline and the
// worker read the same function, so every lane picks the same model for the same text.

export const textToSpeechBody = z.object({
  // Generous ceiling (eleven_turbo_v2.5 accepts 40000); the per-model cap is
  // clamped in the handler and the editor warns first (warn-don't-block).
  text: z.string().min(1).max(40000),
  userPrompt: z.string().max(8000).optional(),
  voice: z.string().optional(),
  provider: z.enum(TTS_PROVIDERS).optional(),
  userId: z.string().uuid().optional(),
  voiceType: z.enum(["premade", "custom", "library"]).optional().default("premade"),
  stability: voiceSetting("stability"),
  similarityBoost: voiceSetting("similarityBoost"),
  style: voiceSetting("style"),
  speed: voiceSetting("speed"),
  languageCode: z.string().optional(),
})

export async function textToSpeechRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-speech", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      // An omitted provider runs on the default speech model; the legacy "elevenlabs"
      // alias intentionally stays on turbo. Length-aware: an omitted provider resolves
      // to turbo once the text exceeds the default model's cap, so a long request is
      // never priced for one model then truncated by that model's clamp.
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

    // B4c: reject a PREMADE voice whose gender the deployment disallows. Custom /
    // library / unknown-gender voices pass here (clone/design/remix are gated by
    // nodes.deny). Unrestricted deployments are byte-identical (isVoiceGenderAllowed
    // returns true when allowedGenders is []).
    if (parsed.data.voiceType !== "custom" && parsed.data.voiceType !== "library") {
      const g = premadeVoiceGender(parsed.data.voice)
      if (g !== undefined && !isVoiceGenderAllowed(g)) {
        return reply.status(400).send({
          error: { code: "voice_not_available", message: "The selected voice is not available on this deployment." },
        })
      }
    }

    // Map legacy "elevenlabs" to "elevenlabs-turbo" for credit check; an omitted
    // provider runs on the default speech model. Same length-aware resolution as the creditGuard resolver above — kept
    // in the one shared helper so the two seams can't drift.
    const resolvedProvider =
      parsed.data.provider === "elevenlabs"
        ? "elevenlabs-turbo"
        : (parsed.data.provider ?? resolveOmittedTtsProvider(parsed.data.text))
    const modelIdentifier = resolvedProvider

    // Clamp to the model's verified per-request character cap (turbo 40000 /
    // multilingual 10000 / v3 5000) so an over-long request can't be rejected by
    // the provider. Mutate parsed.data BEFORE destructuring below so both
    // input_data (built from parsed.data) and the queue payload (built from
    // the destructured `text`) see the clamped value.
    parsed.data.text = parsed.data.text.slice(0, getMaxTtsChars(resolvedProvider))

    const { text, voice, voiceType, stability, similarityBoost, style, speed, languageCode } = parsed.data

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "text-to-speech"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
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
