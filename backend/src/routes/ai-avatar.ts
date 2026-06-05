import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"
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

/**
 * Fastify preHandler: in AUDIO mode, ffprobes the input audio to measure its
 * real duration and stashes ceil(duration) on the raw request body as
 * `__probedDurationSec`. This MUST run BEFORE the creditGuard preHandler so
 * `resolveAiAvatarCreditId` (which reads the raw body) buckets the credit
 * reserve by the ACTUAL clip length instead of the modest 120s default.
 *
 * Without a probe, audio-mode reserve falls back to 120s (resolveAiAvatarCreditId)
 * — a bounded ceiling, never the 900s top bucket that caused the user-reported
 * over-reservation (~4020 credits held for a ~$0.75 clip).
 *
 * The probe is best-effort: on ANY failure (probe error, missing audioUrl, not
 * audio mode) it leaves `__probedDurationSec` unset and resolveAiAvatarCreditId
 * uses its 120s fallback. It never rejects the request — a bad audioUrl is
 * surfaced later by Zod / the worker, not here. probeMediaDuration runs the
 * same SSRF guard as probeVideoSource.
 *
 * Mirrors `probeDurationPreHandler` in routes/video-sfx.ts.
 */
export async function probeAudioDurationPreHandler(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (body.speechMode !== "audio") return
  const audioUrl = body.audioUrl
  if (typeof audioUrl !== "string" || audioUrl.length === 0) return
  try {
    const duration = await probeMediaDuration(audioUrl)
    if (Number.isFinite(duration) && duration > 0) {
      body.__probedDurationSec = Math.ceil(duration)
    }
  } catch (err) {
    // Non-fatal: leave __probedDurationSec unset so resolveAiAvatarCreditId
    // falls back to the modest 120s default (bounded, never 900s).
    req.log.warn({ err }, "ai-avatar: audio ffprobe failed; falling back to 120s reserve")
  }
}

export async function aiAvatarRoutes(app: FastifyInstance) {
  app.post(
    "/v1/ai-avatar",
    {
      // Order matters: probe stashes __probedDurationSec on the raw body so the
      // creditGuard's resolveAiAvatarCreditId can bucket the reserve by the
      // ACTUAL audio duration. The probe MUST run first.
      preHandler: [
        probeAudioDurationPreHandler,
        creditGuard((req) =>
          resolveAiAvatarCreditId(req.body as Record<string, unknown> | undefined),
        ),
      ],
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

      // Resolve from the RAW body (not parsed.data) so the reserve matches the
      // creditGuard check: Zod strips the preHandler-stashed __probedDurationSec,
      // so resolving from parsed.data would lose the audio-probe bucket and fall
      // back to 120s — a mismatch with the preHandler's affordance check. The
      // raw body retains __probedDurationSec.
      const modelId = resolveAiAvatarCreditId(req.body as Record<string, unknown> | undefined)

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
