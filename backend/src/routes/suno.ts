import type { FastifyInstance } from "fastify"
import { z } from "zod"
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
  userId: z.string().uuid().optional(),
})

const sunoCoverBody = z.object({
  prompt: z.string().min(1).max(3000),
  uploadUrl: z.string().url(),
  model: sunoModelEnum,
  lyrics: z.string().max(3000).optional(),
  style: z.string().max(500).optional(),
  title: z.string().max(200).optional(),
  negativeStyle: z.string().max(500).optional(),
  vocalGender: z.enum(["male", "female"]).optional(),
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
        weirdnessConstraint, audioWeight, userId,
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
        title, negativeStyle, vocalGender, userId,
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
        usageLogId,
      })

      return { jobId: job.id }
    }
  )
}
