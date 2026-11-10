import type { FastifyInstance } from "fastify"
import { sendInternalError } from "../lib/http-errors.js"
import { insertJob } from "../lib/insert-job.js"
import { z } from "zod"
import { VOICE_CHANGER_MODEL_IDS } from "@nodaro/shared/models"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { judgeVoice, voiceNotAvailableBody } from "../lib/voice-gender.js"
import { fixedRunModel } from "../lib/run-model.js"

/** The catalog model every run of this route runs — and the credit id it bills under. */
const VOICE_CHANGER_MODEL_ID = "elevenlabs-voice-changer"

const voiceChangerBody = z
  .object({
    // Audio mode (audio in → audio out) OR video mode (video in → video out +
    // revoiced audio). When both are supplied, video wins (the worker ignores
    // audioUrl). Exactly one is required.
    audioUrl: safeUrlSchema.optional(),
    videoUrl: safeUrlSchema.optional(),
    voiceId: z.string().min(1),
    // ElevenLabs speech-to-speech model. Optional: when omitted the provider
    // falls back to eleven_multilingual_sts_v2 — ElevenLabs recommends it
    // even for English audio, and it's required for non-English sources.
    model: z.enum(VOICE_CHANGER_MODEL_IDS as [string, ...string[]]).optional(),
    stability: z.number().min(0).max(1).optional(),
    similarityBoost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    useSpeakerBoost: z.boolean().optional(),
    seed: z.number().int().min(0).max(4294967295).optional(),
    removeBackgroundNoise: z.boolean().optional(),
    userId: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.audioUrl) || Boolean(d.videoUrl), {
    message: "Either audioUrl or videoUrl is required",
    path: ["audioUrl"],
  })

export async function voiceChangerRoutes(app: FastifyInstance) {
  app.post("/v1/voice-changer", {
    preHandler: creditGuard(() => VOICE_CHANGER_MODEL_ID, { runModel: fixedRunModel(VOICE_CHANGER_MODEL_ID) }),
  }, async (req, reply) => {
    const parsed = voiceChangerBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { audioUrl, videoUrl, voiceId, model, stability, similarityBoost, style, removeBackgroundNoise, useSpeakerBoost, seed } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // B4c: under a voice lock, the voice a clip is converted INTO must be one
    // whose gender the platform can vouch for as allowed, judged by its id alone
    // (lib/voice-gender.ts: a premade voice by name or id, the caller's own
    // clone, a library voice this deployment listed), before any job row or
    // reservation. A voice of unknown gender is refused too. No lock: nothing is
    // looked up and the request is unchanged.
    const voiceVerdict = await judgeVoice(voiceId, { userId })
    if (!voiceVerdict.allowed) {
      return reply.status(400).send(voiceNotAvailableBody())
    }

    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "voice-changer"), resolvedModel: VOICE_CHANGER_MODEL_ID },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to change voice")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, VOICE_CHANGER_MODEL_ID)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("voice-changer", {
      jobId: job.id,
      audioUrl,
      videoUrl,
      voiceId,
      model,
      stability,
      similarityBoost,
      style,
      removeBackgroundNoise,
      useSpeakerBoost,
      seed,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
