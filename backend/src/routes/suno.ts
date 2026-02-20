import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const sunoModelEnum = z.enum(["V4", "V4_5", "V4_5PLUS", "V4_5ALL", "V5"]).optional().default("V5")

const sunoGenerateBody = z.object({
  prompt: z.string().min(1).max(3000),
  model: sunoModelEnum,
  lyrics: z.string().max(3000).optional(),
  style: z.string().max(500).optional(),
  title: z.string().max(200).optional(),
  negativeStyle: z.string().max(500).optional(),
  vocalGender: z.enum(["male", "female"]).optional(),
  styleWeight: z.number().min(0).max(100).optional(),
  weirdnessConstraint: z.number().min(0).max(100).optional(),
  audioWeight: z.number().min(0).max(100).optional(),
  customMode: z.boolean().optional().default(false),
  instrumental: z.boolean().optional().default(false),
  userId: z.string().uuid().optional(),
})

const sunoCoverBody = z.object({
  prompt: z.string().min(1).max(3000),
  uploadUrl: safeUrlSchema,
  model: sunoModelEnum,
  lyrics: z.string().max(3000).optional(),
  style: z.string().max(500).optional(),
  title: z.string().max(200).optional(),
  negativeStyle: z.string().max(500).optional(),
  vocalGender: z.enum(["male", "female"]).optional(),
  customMode: z.boolean().optional().default(false),
  instrumental: z.boolean().optional().default(false),
  userId: z.string().uuid().optional(),
})

const sunoExtendBody = z.object({
  audioId: z.string().min(1),
  defaultParamFlag: z.boolean().optional().default(true),
  prompt: z.string().max(5000).optional(),
  model: sunoModelEnum,
  style: z.string().max(1000).optional(),
  title: z.string().max(80).optional(),
  continueAt: z.number().min(0).optional(),
  negativeStyle: z.string().max(500).optional(),
  vocalGender: z.enum(["male", "female"]).optional(),
  styleWeight: z.number().min(0).max(100).optional(),
  weirdnessConstraint: z.number().min(0).max(100).optional(),
  audioWeight: z.number().min(0).max(100).optional(),
  userId: z.string().uuid().optional(),
})

const sunoLyricsBody = z.object({
  prompt: z.string().min(1).max(1000),
  userId: z.string().uuid().optional(),
})

const sunoSeparateBody = z.object({
  taskId: z.string().min(1),
  audioId: z.string().min(1),
  type: z.enum(["separate_vocal", "split_stem"]).optional().default("separate_vocal"),
  userId: z.string().uuid().optional(),
})

const sunoMusicVideoBody = z.object({
  taskId: z.string().min(1),
  audioId: z.string().min(1),
  userId: z.string().uuid().optional(),
})

export async function sunoRoutes(app: FastifyInstance) {
  // ── Generate Song ──
  app.post(
    "/v1/suno/generate",
    {
      preHandler: creditGuard(() => "suno-generate"),
    },
    async (req, reply) => {
      const parsed = sunoGenerateBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const {
        prompt, model, lyrics, style, title,
        negativeStyle, vocalGender, styleWeight,
        weirdnessConstraint, audioWeight, customMode,
        instrumental, userId,
      } = parsed.data

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "userId is required" },
        })
      }

      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: null,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "suno-generate",
            prompt,
            model,
            lyrics,
            style,
            title,
            negativeStyle,
            vocalGender,
            styleWeight,
            weirdnessConstraint,
            audioWeight,
            customMode,
            instrumental,
          },
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-generate")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-generate", {
        jobId: job.id,
        prompt,
        model,
        lyrics,
        style,
        title,
        negativeStyle,
        vocalGender,
        styleWeight,
        weirdnessConstraint,
        audioWeight,
        customMode,
        instrumental,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )

  // ── Cover Song ──
  app.post(
    "/v1/suno/cover",
    {
      preHandler: creditGuard(() => "suno-cover"),
    },
    async (req, reply) => {
      const parsed = sunoCoverBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const {
        prompt, uploadUrl, model, lyrics, style,
        title, negativeStyle, vocalGender, customMode,
        instrumental, userId,
      } = parsed.data

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "userId is required" },
        })
      }

      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: null,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "suno-cover",
            prompt,
            uploadUrl,
            model,
            lyrics,
            style,
            title,
            negativeStyle,
            vocalGender,
            customMode,
            instrumental,
          },
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-cover")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-cover", {
        jobId: job.id,
        prompt,
        uploadUrl,
        model,
        lyrics,
        style,
        title,
        negativeStyle,
        vocalGender,
        customMode,
        instrumental,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )

  // ── Extend Song ──
  app.post(
    "/v1/suno/extend",
    {
      preHandler: creditGuard(() => "suno-extend"),
    },
    async (req, reply) => {
      const parsed = sunoExtendBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const {
        audioId, defaultParamFlag, prompt, model, style,
        title, continueAt, negativeStyle, vocalGender,
        styleWeight, weirdnessConstraint, audioWeight, userId,
      } = parsed.data

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "userId is required" },
        })
      }

      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: null,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "suno-extend",
            audioId,
            defaultParamFlag,
            prompt,
            model,
            style,
            title,
            continueAt,
            negativeStyle,
            vocalGender,
            styleWeight,
            weirdnessConstraint,
            audioWeight,
          },
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-extend")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-extend", {
        jobId: job.id,
        audioId,
        defaultParamFlag,
        prompt,
        model,
        style,
        title,
        continueAt,
        negativeStyle,
        vocalGender,
        styleWeight,
        weirdnessConstraint,
        audioWeight,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )

  // ── Generate Lyrics ──
  app.post(
    "/v1/suno/lyrics",
    {
      preHandler: creditGuard(() => "suno-lyrics"),
    },
    async (req, reply) => {
      const parsed = sunoLyricsBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { prompt, userId } = parsed.data

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "userId is required" },
        })
      }

      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: null,
          user_id: userId,
          status: "pending",
          input_data: { type: "suno-lyrics", prompt },
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-lyrics")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-lyrics", {
        jobId: job.id,
        prompt,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )

  // ── Separate / Stem Split ──
  app.post(
    "/v1/suno/separate",
    {
      preHandler: creditGuard((req) => {
        const body = req.body as { type?: string }
        return body.type === "split_stem" ? "suno-separate-stem" : "suno-separate"
      }),
    },
    async (req, reply) => {
      const parsed = sunoSeparateBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { taskId, audioId, type, userId } = parsed.data

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "userId is required" },
        })
      }

      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: null,
          user_id: userId,
          status: "pending",
          input_data: { type: "suno-separate", taskId, audioId, separateType: type },
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const creditType = type === "split_stem" ? "suno-separate-stem" : "suno-separate"
      const reservation = await reserveCreditsForJob(req, reply, job.id, creditType)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-separate", {
        jobId: job.id,
        taskId,
        audioId,
        separateType: type,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )

  // ── Music Video ──
  app.post(
    "/v1/suno/music-video",
    {
      preHandler: creditGuard(() => "suno-music-video"),
    },
    async (req, reply) => {
      const parsed = sunoMusicVideoBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { taskId, audioId, userId } = parsed.data

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "userId is required" },
        })
      }

      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: null,
          user_id: userId,
          status: "pending",
          input_data: { type: "suno-music-video", taskId, audioId },
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-music-video")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-music-video", {
        jobId: job.id,
        taskId,
        audioId,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )
}
