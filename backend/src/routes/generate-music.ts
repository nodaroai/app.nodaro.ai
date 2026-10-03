import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { MUSIC_CREDIT_ID, MUSIC_PROVIDERS } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

/**
 * What MiniMax Music refuses to run without.
 *
 * `minimax/music-01` is a reference-conditioned model: with no `song_file` /
 * `voice_file` / `instrumental_file` it answers E006 "At least one reference
 * song, voice or instrumental is required" — so a prompt-only run of this node
 * (its ONLY provider) could never succeed. It failed in production on
 * 2026-09-08 exactly that way: credits reserved, job created, provider refusal,
 * refund. Refusing HERE costs the user nothing and says what to do.
 */
export const MINIMAX_MUSIC_NEEDS_REFERENCE =
  "MiniMax Music needs a reference song, voice or instrumental. Upload one, paste a YouTube link, or wire an audio node into the node's reference input, then run again."

const generateMusicBody = z.object({
  prompt: z.string().min(1).max(2000),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(MUSIC_PROVIDERS).optional().default("minimax"),
  duration: z.number().min(1).max(30).optional(),
  genre: z.string().optional(),
  mood: z.string().optional(),
  instrumental: z.boolean().optional(),
  lyrics: z.string().max(2000).optional(),
  referenceAudioUrl: safeUrlSchema.optional(),
  modelVersion: z.string().optional(),
  userId: z.string().uuid().optional(),
}).refine(
  (data) => (data.provider ?? "minimax") !== "minimax" || Boolean(data.referenceAudioUrl),
  { message: MINIMAX_MUSIC_NEEDS_REFERENCE, path: ["referenceAudioUrl"] },
)

export async function generateMusicRoutes(app: FastifyInstance) {
  app.post("/v1/generate-music", { preHandler: creditGuard(() => MUSIC_CREDIT_ID) }, async (req, reply) => {
    const parsed = generateMusicBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { prompt, provider, duration, genre, mood, instrumental, lyrics, referenceAudioUrl, modelVersion } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Use node-type identifier (avoids collision with video "minimax")
    const modelIdentifier = MUSIC_CREDIT_ID

    // Build enriched prompt with genre/mood if provided
    const parts = [prompt]
    if (genre) parts.push(genre)
    if (mood) parts.push(mood)
    if (instrumental) parts.push("instrumental, no vocals")
    const enrichedPrompt = parts.join(", ")

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "generate-music"), prompt: enrichedPrompt },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("generate-music", {
      jobId: job.id,
      prompt: enrichedPrompt,
      provider,
      duration,
      lyrics,
      referenceAudioUrl,
      modelVersion,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
