import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { resolveAiAvatarCreditId } from "@nodaro/shared"

const aiAvatarBody = z
  .object({
    engine: z.enum(["avatar-v", "avatar-iv"]).default("avatar-iv"),
    avatarId: z.string().min(1),
    speechMode: z.enum(["text", "audio"]),
    script: z.string().max(5000).optional(),
    voiceId: z.string().optional(),
    voiceSpeed: z.number().min(0.5).max(1.5).optional(),
    audioUrl: safeUrlSchema.optional(),
    resolution: z.enum(["720p", "1080p", "4k"]).default("720p"),
    aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
    caption: z.boolean().optional(),
    userId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.speechMode === "text") {
      if (!v.script) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "script is required when speechMode is text",
          path: ["script"],
        })
      }
      if (!v.voiceId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "voiceId is required when speechMode is text",
          path: ["voiceId"],
        })
      }
    } else {
      if (!v.audioUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "audioUrl is required when speechMode is audio",
          path: ["audioUrl"],
        })
      }
    }
  })

export async function aiAvatarRoutes(app: FastifyInstance) {
  app.post(
    "/v1/ai-avatar",
    {
      preHandler: creditGuard((req) =>
        resolveAiAvatarCreditId(req.body as Record<string, unknown> | undefined),
      ),
    },
    async (req, reply) => {
      const parsed = aiAvatarBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const {
        engine,
        avatarId,
        speechMode,
        script,
        voiceId,
        voiceSpeed,
        audioUrl,
        resolution,
        aspectRatio,
        caption,
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
          input_data: buildJobInputData(parsed.data, "ai-avatar"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const modelId = resolveAiAvatarCreditId(parsed.data as unknown as Record<string, unknown>)

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelId)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("ai-avatar", {
        jobId: job.id,
        engine,
        avatarId,
        speechMode,
        script,
        voiceId,
        voiceSpeed,
        audioUrl,
        resolution,
        aspectRatio,
        caption,
        usageLogId,
      })

      return { jobId: job.id }
    },
  )
}
