import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { resolveCinematicCreditId } from "@nodaro/shared"

// HeyGen `type:"cinematic_avatar"` — a prompt-driven generative clip referencing
// 1–3 avatar look ids. NO script / voice / audio / engine. `references` (optional
// extra media) is deferred to a later version and not accepted here.
const cinematicAvatarBody = z.object({
  prompt: z.string().min(1).max(10000),
  avatarLooks: z.array(z.string().min(1)).min(1).max(3),
  duration: z.number().int().min(4).max(15).optional(),
  autoDuration: z.boolean().optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
  enhancePrompt: z.boolean().optional(),
  userId: z.string().uuid().optional(),
})

export async function cinematicAvatarRoutes(app: FastifyInstance) {
  app.post(
    "/v1/cinematic-avatar",
    {
      preHandler: creditGuard((req) =>
        resolveCinematicCreditId(req.body as Record<string, unknown> | undefined),
      ),
    },
    async (req, reply) => {
      const parsed = cinematicAvatarBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const {
        prompt,
        avatarLooks,
        duration,
        autoDuration,
        aspectRatio,
        resolution,
        enhancePrompt,
      } = parsed.data

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
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "cinematic-avatar"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      // Duration is a user parameter known at submit time → the reserve id is
      // EXACT (no bucketing). Reserve under the SAME id the creditGuard used.
      const modelId = resolveCinematicCreditId(parsed.data as unknown as Record<string, unknown>)

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelId)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("cinematic-avatar", {
        jobId: job.id,
        prompt,
        avatarLooks,
        duration,
        autoDuration,
        aspectRatio,
        resolution,
        enhancePrompt,
        usageLogId,
      })

      return { jobId: job.id }
    },
  )
}
