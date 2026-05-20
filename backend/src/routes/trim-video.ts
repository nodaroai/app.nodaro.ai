import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { estimateTrimVideoCredits } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

const trimVideoBody = z.object({
  videoUrl: safeUrlSchema,
  // Time-based trim (seconds). Optional when caller uses frame-based or
  // smart-cut mode; the worker dispatches based on which fields are set.
  startTime: z.number().min(0).optional().default(0),
  endTime: z.number().min(0).optional(),
  // Frame-based trim. Either or both may be set; overrides time-based.
  // Worker probes source fps and converts.
  trimStartFrames: z.number().int().min(0).optional(),
  trimEndFrames: z.number().int().min(0).optional(),
  // Seconds-mirror of the frames mode: trim N seconds from start AND/OR end.
  // Worker probes duration to convert end-trim into an endTime.
  trimStartSeconds: z.number().min(0).optional(),
  trimEndSeconds: z.number().min(0).optional(),
  // Keep only the first/last N seconds. Worker probes duration.
  keepFirstSeconds: z.number().positive().optional(),
  keepLastSeconds: z.number().positive().optional(),
  // Smart loop cut: ignore startTime/endTime/trim*Frames; the worker
  // empirically finds the trailing frame closest to frame 0 (PSNR) and
  // cuts there. `lookbackFrames` bounds how many trailing candidates to
  // evaluate (default 16, max 64).
  smartLoopCut: z.boolean().optional().default(false),
  smartLoopCutLookback: z.number().int().min(2).max(64).optional(),
  outputSilentVideo: z.boolean().optional().default(false),
  userId: z.string().uuid().optional(),
  // Optional upstream video duration (seconds). Used by both the credit
  // estimator (frames + smart-loop-cut modes need to know input length) and
  // for telemetry. Omit and the backend falls back to 8s.
  upstreamDuration: z.number().positive().optional(),
  // Mirror frontend's trimMode for the estimator (default "time"). Worker
  // doesn't read this directly — it dispatches based on which fields are set.
  trimMode: z.enum(["time", "seconds", "keep-first-seconds", "keep-last-seconds", "frames", "smart-loop-cut"]).optional(),
})

export async function trimVideoRoutes(app: FastifyInstance) {
  app.post("/v1/trim-video", {
    preHandler: creditGuard(() => "trim-video", {
      computeCredits: (body) => {
        const b = body as Record<string, unknown>
        const upstream = typeof b.upstreamDuration === "number" ? b.upstreamDuration : undefined
        return estimateTrimVideoCredits({
          trimMode: b.trimMode as "time" | "seconds" | "keep-first-seconds" | "keep-last-seconds" | "frames" | "smart-loop-cut" | undefined,
          startTime: b.startTime as number | undefined,
          endTime: b.endTime as number | undefined,
          trimStartFrames: b.trimStartFrames as number | undefined,
          trimEndFrames: b.trimEndFrames as number | undefined,
          trimStartSeconds: b.trimStartSeconds as number | undefined,
          trimEndSeconds: b.trimEndSeconds as number | undefined,
          keepFirstSeconds: b.keepFirstSeconds as number | undefined,
          keepLastSeconds: b.keepLastSeconds as number | undefined,
          smartLoopCutLookback: b.smartLoopCutLookback as number | undefined,
        }, upstream)
      },
    }),
  }, async (req, reply) => {
    const parsed = trimVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { userId: _bodyUserId, upstreamDuration: _upDur, trimMode: _mode, ...restData } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = "trim-video"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "trim-video"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("trim-video", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
