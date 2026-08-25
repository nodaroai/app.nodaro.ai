import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { VOICE_DESIGN_MODELS, DEFAULT_VOICE_DESIGN_MODEL } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isNodeDenied, deniedNodeRejectionMessage } from "../lib/surface-deny.js"

const voiceDesignBody = z.object({
  text: z.string().min(100).max(1000),
  userPrompt: z.string().max(8000).optional(),
  voiceDescription: z.string().min(1).max(1000),
  model: z.enum(VOICE_DESIGN_MODELS).optional(),
  loudness: z.number().min(-1).max(1).optional(),
  guidanceScale: z.number().min(0).max(100).optional(),
  seed: z.number().int().optional(),
  quality: z.number().optional(),
  shouldEnhance: z.boolean().optional(),
  userId: z.string().uuid().optional(),
})

export async function voiceDesignRoutes(app: FastifyInstance) {
  app.post("/v1/voice-design", {
    preHandler: creditGuard(() => "elevenlabs-voice-design"),
  }, async (req, reply) => {
    const parsed = voiceDesignBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { text, voiceDescription, model, loudness, guidanceScale, seed, quality, shouldEnhance } = parsed.data
    // eleven_ttv_v3 is ElevenLabs' newest text-to-voice model (all languages);
    // default it in-handler when the caller omits it, mirroring how
    // text-to-speech resolves its provider default (schema stays optional).
    const resolvedModel = model ?? DEFAULT_VOICE_DESIGN_MODEL
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // B4c: reuse B1's nodes.deny — inert when "voice-design" isn't denied.
    if (isNodeDenied("voice-design")) {
      return reply.status(403).send({
        error: { code: "node_not_available", message: deniedNodeRejectionMessage(["voice-design"]) },
      })
    }

    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "voice-design"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-voice-design")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("voice-design", {
      jobId: job.id,
      text,
      voiceDescription,
      model: resolvedModel,
      loudness,
      guidanceScale,
      seed,
      quality,
      shouldEnhance,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
