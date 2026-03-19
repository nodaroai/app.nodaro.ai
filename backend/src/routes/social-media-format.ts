import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { PLATFORM_SPECS } from "../../../packages/shared/src/social-media-specs.js"

const VALID_SPEC_KEYS = Object.keys(PLATFORM_SPECS) as [string, ...string[]]

const socialMediaFormatBody = z.object({
  mediaUrl: safeUrlSchema,
  mediaType: z.enum(["image", "video"]),
  specKey: z.enum(VALID_SPEC_KEYS),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  method: z.enum(["crop", "pad", "stretch"]).optional().default("pad"),
  padColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "padColor must be a valid hex color (e.g. #000000)").optional().default("#000000"),
  userId: z.string().uuid().optional(),
})

export async function socialMediaFormatRoutes(app: FastifyInstance) {
  app.post("/v1/social-media-format", { preHandler: creditGuard(() => "social-media-format") }, async (req, reply) => {
    const parsed = socialMediaFormatBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }

    const { userId: _bodyUserId, ...restData } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = "social-media-format"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...restData, type: "social-media-format" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("social-media-format", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
