import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob, type RoutePricing } from "../middleware/credit-guard.js"
import { dropClientMeasureFields, requestMeasure, setRequestMeasure } from "../lib/request-measure.js"
import { AI_AVATAR_PROBED_FIELD, aiAvatarCreditIdOf } from "../lib/probed-credit-ids.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { measureAiAvatarAudio } from "../lib/ai-avatar-audio-length.js"
import { ROUTE_MEASURE_DEADLINE_MS } from "../lib/pre-charge-probe-bounds.js"
import { sendInternalError } from "../lib/http-errors.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { probeRefusalStatus } from "../providers/video/probe-guard.js"

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

export const aiAvatarBody = z
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

/** The request measure the probed audio seconds are kept under (server-side only, `lib/request-measure.ts`). */
const AUDIO_MEASURE = "aiAvatarAudioSec"

/** The audio seconds this request's preHandler measured, or `undefined` (text mode, no audio, a failed probe). */
export function measuredAiAvatarAudioSec(req: FastifyRequest): number | undefined {
  return requestMeasure<number>(req, AUDIO_MEASURE)
}

/** The credit id the guard and the reservation hold: the body's settings and the audio length the server measured (`aiAvatarCreditIdOf`). */
const aiAvatarCreditIdOfRequest = (req: FastifyRequest): string =>
  aiAvatarCreditIdOf(req.body as Record<string, unknown> | undefined, measuredAiAvatarAudioSec(req))

/**
 * Fastify preHandler: in AUDIO mode, ffprobes the input audio to measure its
 * real duration and keeps ceil(duration) on the server-side request
 * (`measuredAiAvatarAudioSec`) — never the body, whose `__probedDurationSec`
 * (a client could send one) is dropped first. This MUST run BEFORE the
 * creditGuard preHandler so the credit id (`aiAvatarCreditIdOf`) buckets the
 * reserve by the ACTUAL clip length instead of the modest 120s default.
 *
 * Without a probe, audio-mode reserve falls back to 120s (resolveAiAvatarCreditId)
 * — a bounded ceiling, never the 900s top bucket that caused the user-reported
 * over-reservation (~4020 credits held for a ~$0.75 clip).
 *
 * Without an audioUrl the route's schema takes (or outside audio mode) nothing
 * is probed and no length is recorded: the handler's validation
 * answers a bad one. The sound's length is read as Trim reads a clip
 * (`probeSoundLengthSec`): from the header, and for a recording whose header
 * carries none (a WebM a browser recorded) from its last audio packet,
 * streamed, within the route's deadline. A probe that FAILS refuses the request
 * before anything is reserved, rather than reserve the 120s fallback for a clip
 * that may be longer: a host that could not be looked up for now, or a read
 * that ran out of time, is the retryable 503 every measuring route answers
 * (`probeLinkRefusal`); a link that is not an ordinary media file, or audio
 * that cannot be read, is a 400. The sound is read through the probe guard.
 *
 * Mirrors `probeDurationPreHandler` in routes/video-sfx.ts.
 */
export async function probeAudioDurationPreHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  dropClientMeasureFields(req.body, [AI_AVATAR_PROBED_FIELD])
  const body = (req.body ?? {}) as Record<string, unknown>
  if (body.speechMode !== "audio") return
  const audioUrl = body.audioUrl
  // Only a link the route's schema takes is probed; anything else is the handler's validation_error.
  if (typeof audioUrl !== "string" || !safeUrlSchema.safeParse(audioUrl).success) return
  // Its sound's length, read as Trim reads a clip (the header, else — a recording a browser made — its last audio
  // packet): the one rule the workflow run's stamp reads too (`measureAiAvatarAudio`).
  const measured = await measureAiAvatarAudio(audioUrl, { deadlineAt: Date.now() + ROUTE_MEASURE_DEADLINE_MS }, (err) => {
    req.log.warn({ err }, "ai-avatar: audio ffprobe failed; refusing the run")
  })
  if (!measured.ok) {
    return void reply.status(probeRefusalStatus(measured.code)).send({ error: { code: measured.code, message: measured.message } })
  }
  if (measured.sec !== undefined) setRequestMeasure(req, AUDIO_MEASURE, measured.sec)
}

/**
 * The route's pricing chain, registered below as its preHandlers and run by
 * `POST /v1/quote` on the same body: the probe measures an audio-mode run's
 * audio (refusing one it cannot read), then the duration bucket of the measured
 * seconds, or of the script's estimated length in text mode
 * (`aiAvatarCreditIdOfRequest`).
 */
export const aiAvatarPricing: RoutePricing = {
  prechecks: [probeAudioDurationPreHandler],
  modelResolver: (req) => aiAvatarCreditIdOfRequest(req),
}

export async function aiAvatarRoutes(app: FastifyInstance) {
  app.post(
    "/v1/ai-avatar",
    {
      // Order matters: the probe records the audio's length on the request so
      // the creditGuard's credit id can bucket the reserve by the ACTUAL audio
      // duration. The probe MUST run first.
      preHandler: [...aiAvatarPricing.prechecks, creditGuard(aiAvatarPricing.modelResolver, aiAvatarPricing.opts)],
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

      const { data: job, error } = await insertJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "ai-avatar"),
        })

      if (error) {
        return sendInternalError(reply, req, error, "Failed to create job")
      }

      // The same id the creditGuard checked: the body's settings and the audio
      // length the preHandler measured (never one the body carries).
      const modelId = aiAvatarCreditIdOfRequest(req)

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelId)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("ai-avatar", {
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
      }))
      if (reply.sent) return

      return { jobId: job.id }
    },
  )
}
