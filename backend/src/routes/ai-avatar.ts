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

const ttsEngineSchema = z
  .discriminatedUnion("engine_type", [
    z.object({
      engine_type: z.literal("elevenlabs"),
      model: z
        .enum(["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5", "eleven_v3"])
        .nullable()
        .optional(),
      similarity_boost: z.number().min(0).max(1).optional(),
      stability: z.number().min(0).max(1).optional(),
      style: z.number().min(0).max(1).optional(),
      use_speaker_boost: z.boolean().optional(),
    }),
    z.object({
      engine_type: z.literal("fish"),
      model: z.enum(["s1", "s2-pro"]).nullable().optional(),
      stability: z.number().min(0).max(1).optional(),
      similarity: z.number().min(0).max(1).optional(),
    }),
    z.object({
      engine_type: z.literal("starfish"),
    }),
  ])
  .optional()

const aiAvatarBody = z
  .object({
    // Visual source. "avatar" (default) animates a catalog avatar look (needs
    // avatarId + engine); "image" animates a raw image (needs imageUrl, no engine).
    avatarSource: z.enum(["avatar", "image"]).default("avatar"),
    engine: z.enum(["avatar-v", "avatar-iv"]).default("avatar-iv"),
    // avatarId is required only in avatar mode (enforced in superRefine below);
    // optional at the field level so image mode can omit it.
    avatarId: z.string().min(1).optional(),
    imageUrl: safeUrlSchema.optional(),
    speechMode: z.enum(["text", "audio"]),
    script: z.string().max(5000).optional(),
    voiceId: z.string().optional(),
    voiceSpeed: z.number().min(0.5).max(1.5).optional(),
    pitch: z.number().min(-50).max(50).optional(),
    volume: z.number().min(0).max(1).optional(),
    locale: z.string().optional(),
    ttsEngine: ttsEngineSchema,
    audioUrl: safeUrlSchema.optional(),
    resolution: z.enum(["720p", "1080p", "4k"]).default("720p"),
    aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
    fit: z.enum(["cover", "contain"]).optional(),
    outputFormat: z.enum(["mp4", "webm"]).optional(),
    caption: z.boolean().optional(),
    captionStyle: z.enum(["default"]).optional(),
    background: z
      .object({
        type: z.enum(["color", "image"]),
        value: z.string().optional(),
        url: z.string().optional(),
        assetId: z.string().optional(),
      })
      .optional(),
    removeBackground: z.boolean().optional(),
    motionPrompt: z.string().max(1000).optional(),
    expressiveness: z.enum(["high", "medium", "low"]).optional(),
    userId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    // Source-conditional requirements: avatar mode needs avatarId; image mode
    // needs imageUrl. The other field is ignored for the active mode.
    if (v.avatarSource === "image") {
      if (!v.imageUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "imageUrl is required when avatarSource is image",
          path: ["imageUrl"],
        })
      }
    } else {
      if (!v.avatarId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "avatarId is required when avatarSource is avatar",
          path: ["avatarId"],
        })
      }
    }
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
        avatarSource,
        engine,
        avatarId,
        imageUrl,
        speechMode,
        script,
        voiceId,
        voiceSpeed,
        pitch,
        volume,
        locale,
        ttsEngine,
        audioUrl,
        resolution,
        aspectRatio,
        fit,
        outputFormat,
        caption,
        captionStyle,
        background,
        removeBackground,
        motionPrompt,
        expressiveness,
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
        avatarSource,
        engine,
        avatarId,
        imageUrl,
        speechMode,
        script,
        voiceId,
        voiceSpeed,
        pitch,
        volume,
        locale,
        ttsEngine,
        audioUrl,
        resolution,
        aspectRatio,
        fit,
        outputFormat,
        caption,
        captionStyle,
        background,
        removeBackground,
        motionPrompt,
        expressiveness,
        usageLogId,
      })

      return { jobId: job.id }
    },
  )
}
