import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

const audioSeparationBody = z.object({
  audioUrl: safeUrlSchema,
  mode: z.enum(["vocal_instrumental", "stems"]).optional().default("vocal_instrumental"),
  quality: z.enum(["auto", "fast", "best"]).optional().default("auto"),
  userId: z.string().uuid().optional(),
})

/**
 * Composite credit id from the raw `mode`+`quality` (read before Zod strips
 * them). Mirrors `pickModel`: full-stems (auto/best) routes to htdemucs_6s
 * (6-stem, materially more GPU compute than the base 2/4-stem htdemucs), so it
 * must price above the base tier rather than charging the same as a 2-stem run.
 */
function audioSeparationCreditId(quality: unknown, mode: unknown): string {
  if (mode === "stems" && quality !== "fast") return "audio-separation:stems" // htdemucs_6s
  if (quality === "best") return "audio-separation:best" // htdemucs_ft (vocal/instrumental)
  return "audio-separation"
}

export async function audioSeparationRoutes(app: FastifyInstance) {
  app.post("/v1/audio-separation", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown> | undefined
      return audioSeparationCreditId(body?.quality, body?.mode)
    }),
  }, async (req, reply) => {
    const parsed = audioSeparationBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { audioUrl, mode, quality } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "audio-separation"),
      })
      .select("id")
      .single()

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, audioSeparationCreditId(quality, mode))
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("audio-separation", {
      jobId: job.id,
      audioUrl,
      mode,
      quality,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
