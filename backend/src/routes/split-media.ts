import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

const splitMediaBody = z.object({
  videoUrl: safeUrlSchema.optional(),
  audioUrl: safeUrlSchema.optional(),
  /** The longest a part may be, in seconds: every part is at most this long. */
  chunkDuration: z.number().min(1),
  /** The shortest a part may be, in seconds (default 4, never above chunkDuration). */
  minPartDuration: z.number().min(0).optional(),
  audioFormat: z.enum(["mp3", "wav", "aac"]).optional().default("mp3"),
  userId: z.string().uuid().optional(),
}).refine((d) => d.videoUrl || d.audioUrl, {
  message: "At least one of videoUrl or audioUrl is required",
}).refine((d) => d.minPartDuration === undefined || d.minPartDuration <= d.chunkDuration, {
  message: "minPartDuration must not be longer than chunkDuration",
  path: ["minPartDuration"],
})

/**
 * Shots mode: one part per shot of the video, at the platform's measured cuts
 * (a video only; no part length). Chosen by `mode: "shots"`; every other body
 * is the part-length split above, parsed exactly as before.
 */
const splitMediaShotsBody = z.object({
  videoUrl: safeUrlSchema,
  audioUrl: safeUrlSchema.optional(),
  mode: z.literal("shots"),
  userId: z.string().uuid().optional(),
}).refine((d) => d.audioUrl === undefined, {
  message: "Shots mode splits a video (its own sound stays in every part); a separate audioUrl cannot be cut at its shots",
  path: ["audioUrl"],
})

const isShotsBody = (body: unknown): boolean =>
  !!body && typeof body === "object" && (body as { mode?: unknown }).mode === "shots"

const parseSplitMediaBody = (body: unknown) =>
  isShotsBody(body) ? splitMediaShotsBody.safeParse(body) : splitMediaBody.safeParse(body)

export async function splitMediaRoutes(app: FastifyInstance) {
  app.post("/v1/split-media", { preHandler: creditGuard(() => "split-media") }, async (req, reply) => {
    const parsed = parseSplitMediaBody(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { userId: _bodyUserId, ...restData } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = "split-media"

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "split-media"),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("split-media", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
