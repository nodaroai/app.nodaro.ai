import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { TEXT_TO_AUDIO_PROVIDERS } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

const textToAudioBody = z.object({
  prompt: z.string().min(1).max(2000),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(TEXT_TO_AUDIO_PROVIDERS).optional(),
  duration: z.number().min(0.5).max(30).optional(),
  loop: z.boolean().optional(),
  promptInfluence: z.number().min(0).max(1).optional(),
  userId: z.string().uuid().optional(),
})

export async function textToAudioRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-audio", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "tangoflux" }) }, async (req, reply) => {
    const parsed = textToAudioBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { prompt, provider, duration, loop, promptInfluence } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // B4b: deployment prompt policy at this route's assembly point (kind
    // "audio": the SFX description is a generative prompt, unlike TTS text,
    // which is spoken content and deliberately not policed). Mirrored into
    // parsed.data so input_data persists the policed text. No policy
    // registered = identity.
    const finalPrompt = applyPromptPolicies({ prompt, negativePrompt: "", kind: "audio" }).prompt
    parsed.data.prompt = finalPrompt

    // Determine model identifier for credit check (default to tangoflux)
    const modelIdentifier = provider ?? "tangoflux"
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "text-to-audio"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("text-to-audio", {
      jobId: job.id,
      prompt: finalPrompt,
      provider,
      duration,
      loop,
      promptInfluence,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
