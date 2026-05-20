import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"

const rampSegmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  speed: z.number().min(0.05).max(100.0),
}).refine((s) => s.end > s.start, { message: "segment end must be > start" })

const speedRampBody = z.object({
  videoUrl: safeUrlSchema,
  speed: z.number().min(0.05).max(100.0),
  reverse: z.boolean().optional().default(false),
  audioMode: z.enum(["pitch-preserve", "pitch-shift", "drop"]).optional(),
  quality: z.enum(["fast", "smooth"]).optional().default("fast"),
  ramps: z.array(rampSegmentSchema).optional(),
  // Legacy alias — when audioMode is unset, true → "pitch-preserve", false → "drop".
  adjustAudio: z.boolean().optional(),
  userId: z.string().uuid().optional(),
}).refine((b) => {
  // Ramps must be sorted ascending by start and non-overlapping.
  if (!b.ramps || b.ramps.length === 0) return true
  for (let i = 1; i < b.ramps.length; i++) {
    if (b.ramps[i].start < b.ramps[i - 1].end) return false
  }
  return true
}, { message: "ramps must be sorted ascending and non-overlapping", path: ["ramps"] })

/** Build the composite credit-model identifier — `speed-ramp:smooth` when
 *  motion-compensated interpolation is enabled, `speed-ramp` otherwise. */
function buildSpeedRampCreditId(body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>
  return b.quality === "smooth" ? "speed-ramp:smooth" : "speed-ramp"
}

export async function speedRampRoutes(app: FastifyInstance) {
  app.post("/v1/speed-ramp", {
    preHandler: creditGuard((req) => buildSpeedRampCreditId(req.body)),
  }, async (req, reply) => {
    const parsed = speedRampBody.safeParse(req.body)
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

    const modelIdentifier = buildSpeedRampCreditId(parsed.data)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "speed-ramp"),
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

    await videoQueue.add("speed-ramp", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
