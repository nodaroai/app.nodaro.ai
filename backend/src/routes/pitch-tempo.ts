import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { PITCH_TEMPO_LIMITS, pitchTempoCreditId } from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { measurePitchTempoDuration } from "../lib/pitch-tempo-duration.js"

export const PitchTempoBody = z
  .object({
    // Exactly one media source. The worker decides the lane from the file's
    // own streams, so a field only says where the media came from.
    audioUrl: safeUrlSchema.optional(),
    videoUrl: safeUrlSchema.optional(),
    semitones: z.number().min(PITCH_TEMPO_LIMITS.SEMITONES_MIN).max(PITCH_TEMPO_LIMITS.SEMITONES_MAX).optional().default(0),
    tempo: z.number().min(PITCH_TEMPO_LIMITS.TEMPO_MIN).max(PITCH_TEMPO_LIMITS.TEMPO_MAX).optional().default(1),
    preserveFormants: z.boolean().optional().default(true),
    userId: z.string().uuid().optional(),
  })
  .refine((b) => Boolean(b.audioUrl) !== Boolean(b.videoUrl), {
    message: "Provide exactly one of audioUrl or videoUrl",
    path: ["audioUrl"],
  })
export type PitchTempoBody = z.infer<typeof PitchTempoBody>

/** Request keys the preHandler stashes on the body for the credit guard. */
const PROBED_KEY = "__probedDuration"

function withoutStash(body: unknown): Record<string, unknown> {
  const { [PROBED_KEY]: _stashed, ...rest } = (body ?? {}) as Record<string, unknown>
  return rest
}

/**
 * Validate, then measure the input's length BEFORE the credit guard (decided
 * 2026-10-12): an invalid body, an unreadable length and an over-30-minute
 * input are all refused with nothing reserved. The length is stashed on the
 * body so the guard prices `pitch-tempo:<N>m` without probing again.
 */
async function validateAndMeasure(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = PitchTempoBody.safeParse(withoutStash(req.body))
  if (!parsed.success) {
    return void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  const mediaUrl = parsed.data.videoUrl ?? parsed.data.audioUrl ?? ""
  const measured = await measurePitchTempoDuration(mediaUrl, (err) => {
    req.log.warn({ err }, "pitch-tempo: ffprobe failed; refusing the run")
  })
  if (!measured.ok) {
    return void reply.status(400).send({ error: { code: measured.code, message: measured.message } })
  }
  ;(req.body as Record<string, unknown>)[PROBED_KEY] = measured.durationSec
}

function probedSeconds(body: unknown): number | undefined {
  const probed = (body as Record<string, unknown> | undefined)?.[PROBED_KEY]
  return typeof probed === "number" ? probed : undefined
}

export async function pitchTempoRoutes(app: FastifyInstance) {
  app.post(
    "/v1/pitch-tempo",
    { preHandler: [validateAndMeasure, creditGuard((req) => pitchTempoCreditId(probedSeconds(req.body)))] },
    async (req, reply) => {
      const durationSec = probedSeconds(req.body)
      const parsed = PitchTempoBody.safeParse(withoutStash(req.body))
      if (!parsed.success || durationSec === undefined) {
        return reply.status(400).send({
          error: { code: "validation_error", ...(parsed.success ? { message: "Input length was not measured" } : formatZodError(parsed.error)) },
        })
      }

      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }

      const { userId: _bodyUserId, ...settings } = parsed.data
      const creditId = pitchTempoCreditId(durationSec)
      const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "pitch-tempo"), duration_seconds: durationSec, bucketKey: creditId },
      })
      if (error) {
        return sendInternalError(reply, req, error, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, creditId)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("pitch-tempo", { jobId: job.id, ...settings, usageLogId })
      return { jobId: job.id }
    },
  )
}
