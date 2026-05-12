import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { SUNO_MODELS } from "@nodaro/shared"
import { sunoStyleBoost } from "../providers/kie/suno-client.js"
import { CreditsService } from "../ee/billing/credits.js"
import { formatZodError } from "../lib/zod-error.js"

const sunoModelEnum = z.enum(SUNO_MODELS).optional().default("V5")
const sunoAddTrackModelEnum = z.enum(["V4_5PLUS", "V5", "V5_5"]).optional().default("V5_5")

const sunoGenerateBody = z.object({
  prompt: z.string().min(1).max(3000),
  userPrompt: z.string().max(8000).optional(),
  model: sunoModelEnum,
  lyrics: z.string().max(3000).optional(),
  style: z.string().max(500).optional(),
  title: z.string().max(200).optional(),
  negativeStyle: z.string().max(500).optional(),
  vocalGender: z.enum(["male", "female"]).optional(),
  styleWeight: z.number().min(0).max(1).optional(),
  weirdnessConstraint: z.number().min(0).max(1).optional(),
  audioWeight: z.number().min(0).max(1).optional(),
  customMode: z.boolean().optional().default(false),
  instrumental: z.boolean().optional().default(false),
  userId: z.string().uuid().optional(),
})

const sunoCoverBody = z.object({
  prompt: z.string().min(1).max(3000),
  userPrompt: z.string().max(8000).optional(),
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
  userPrompt: z.string().max(8000).optional(),
  model: sunoModelEnum,
  style: z.string().max(1000).optional(),
  title: z.string().max(80).optional(),
  continueAt: z.number().min(0).optional(),
  negativeStyle: z.string().max(500).optional(),
  vocalGender: z.enum(["male", "female"]).optional(),
  styleWeight: z.number().min(0).max(1).optional(),
  weirdnessConstraint: z.number().min(0).max(1).optional(),
  audioWeight: z.number().min(0).max(1).optional(),
  userId: z.string().uuid().optional(),
})

const sunoLyricsBody = z.object({
  prompt: z.string().min(1).max(1000),
  userPrompt: z.string().max(8000).optional(),
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

const sunoMashupBody = z.object({
  uploadUrlList: z.tuple([safeUrlSchema, safeUrlSchema]),
  model: sunoModelEnum,
  customMode: z.boolean().optional().default(false),
  style: z.string().max(500).optional(),
  title: z.string().max(200).optional(),
  negativeStyle: z.string().max(500).optional(),
  vocalGender: z.enum(["male", "female"]).optional(),
  userId: z.string().uuid().optional(),
})

const sunoReplaceSectionBody = z.object({
  taskId: z.string().min(1),
  audioId: z.string().min(1),
  infillStartS: z.number().min(0),
  infillEndS: z.number().min(6).max(60),
  prompt: z.string().min(1).max(3000),
  userPrompt: z.string().max(8000).optional(),
  tags: z.string().max(500),
  title: z.string().max(200).optional(),
  userId: z.string().uuid().optional(),
})

const sunoStyleBoostBody = z.object({
  content: z.string().min(1).max(3000),
  userPrompt: z.string().max(8000).optional(),
  userId: z.string().uuid().optional(),
})

const sunoAddInstrumentalBody = z.object({
  taskId: z.string().min(1),
  audioId: z.string().min(1),
  model: sunoAddTrackModelEnum,
  userId: z.string().uuid().optional(),
})

const sunoAddVocalsBody = z.object({
  taskId: z.string().min(1),
  audioId: z.string().min(1),
  model: sunoAddTrackModelEnum,
  userId: z.string().uuid().optional(),
})

const sunoConvertWavBody = z.object({
  taskId: z.string().min(1),
  audioId: z.string().min(1),
  userId: z.string().uuid().optional(),
})

const sunoUploadExtendBody = z.object({
  uploadUrl: safeUrlSchema,
  continueAt: z.number().min(0),
  defaultParamFlag: z.boolean().optional().default(false),
  model: sunoModelEnum,
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
      preHandler: creditGuard((req) => {
        const body = req.body as Record<string, unknown>
        const m = body?.model as string; return m === "V5_5" ? "suno-v5_5" : m === "V5" ? "suno-v5" : "suno-generate"
      }),
    },
    async (req, reply) => {
      const parsed = sunoGenerateBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const {
        prompt, model, lyrics, style, title,
        negativeStyle, vocalGender, styleWeight,
        weirdnessConstraint, audioWeight, customMode,
        instrumental,
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
          input_data: buildJobInputData(parsed.data, "suno-generate"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const creditType = model === "V5_5" ? "suno-v5_5" : model === "V5" ? "suno-v5" : "suno-generate"
      const reservation = await reserveCreditsForJob(req, reply, job.id, creditType)
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
      preHandler: creditGuard((req) => {
        const body = req.body as Record<string, unknown>
        const m = body?.model as string; return m === "V5_5" ? "suno-v5_5" : m === "V5" ? "suno-v5" : "suno-cover"
      }),
    },
    async (req, reply) => {
      const parsed = sunoCoverBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const {
        prompt, uploadUrl, model, lyrics, style,
        title, negativeStyle, vocalGender, customMode,
        instrumental,
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
          input_data: buildJobInputData(parsed.data, "suno-cover"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const creditType = model === "V5_5" ? "suno-v5_5" : model === "V5" ? "suno-v5" : "suno-cover"
      const reservation = await reserveCreditsForJob(req, reply, job.id, creditType)
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
      preHandler: creditGuard((req) => {
        const body = req.body as Record<string, unknown>
        const m = body?.model as string; return m === "V5_5" ? "suno-v5_5" : m === "V5" ? "suno-v5" : "suno-extend"
      }),
    },
    async (req, reply) => {
      const parsed = sunoExtendBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const {
        audioId, defaultParamFlag, prompt, model, style,
        title, continueAt, negativeStyle, vocalGender,
        styleWeight, weirdnessConstraint, audioWeight,
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
          input_data: buildJobInputData(parsed.data, "suno-extend"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const creditType = model === "V5_5" ? "suno-v5_5" : model === "V5" ? "suno-v5" : "suno-extend"
      const reservation = await reserveCreditsForJob(req, reply, job.id, creditType)
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
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { prompt } = parsed.data
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
          input_data: buildJobInputData(parsed.data, "suno-lyrics"),
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
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { taskId, audioId, type } = parsed.data
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
          input_data: { ...buildJobInputData(parsed.data, "suno-separate"), separateType: type },
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
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { taskId, audioId } = parsed.data
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
          input_data: buildJobInputData(parsed.data, "suno-music-video"),
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

  // ── Mashup ──
  app.post(
    "/v1/suno/mashup",
    {
      preHandler: creditGuard(() => "suno-mashup"),
    },
    async (req, reply) => {
      const parsed = sunoMashupBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const {
        uploadUrlList, model, customMode, style,
        title, negativeStyle, vocalGender,
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
          input_data: buildJobInputData(parsed.data, "suno-mashup"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-mashup")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-mashup", {
        jobId: job.id,
        uploadUrlList,
        model,
        customMode,
        style,
        title,
        negativeStyle,
        vocalGender,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )

  // ── Replace Section ──
  app.post(
    "/v1/suno/replace-section",
    {
      preHandler: creditGuard(() => "suno-replace-section"),
    },
    async (req, reply) => {
      const parsed = sunoReplaceSectionBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { taskId, audioId, infillStartS, infillEndS, prompt, tags, title } = parsed.data
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
          input_data: buildJobInputData(parsed.data, "suno-replace-section"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-replace-section")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-replace-section", {
        jobId: job.id,
        taskId,
        audioId,
        infillStartS,
        infillEndS,
        prompt,
        tags,
        title,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )

  // ── Style Boost (Synchronous — inline call, no worker) ──
  app.post(
    "/v1/suno/style-boost",
    {
      preHandler: creditGuard(() => "suno-style-boost"),
    },
    async (req, reply) => {
      const parsed = sunoStyleBoostBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { content } = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      // Create a job for credit tracking
      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "suno-style-boost"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-style-boost")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const result = await sunoStyleBoost({ content })

        // Mark job as completed with text result
        await supabase.from("jobs").update({
          status: "completed",
          progress: 100,
          output_data: { text: result.text },
          completed_at: new Date().toISOString(),
        }).eq("id", job.id)

        // Commit credits
        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        return { text: result.text }
      } catch (err) {
        // Refund credits on failure
        if (usageLogId) {
          await CreditsService.refundCredits(usageLogId)
        }
        await supabase.from("jobs").update({
          status: "failed",
          output_data: { error: err instanceof Error ? err.message : "Style boost failed" },
        }).eq("id", job.id)

        return reply.status(500).send({
          error: {
            code: "internal_error",
            message: err instanceof Error ? err.message : "Style boost failed",
          },
        })
      }
    }
  )

  // ── Add Instrumental ──
  app.post(
    "/v1/suno/add-instrumental",
    {
      preHandler: creditGuard(() => "suno-add-instrumental"),
    },
    async (req, reply) => {
      const parsed = sunoAddInstrumentalBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { taskId, audioId, model } = parsed.data
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
          input_data: buildJobInputData(parsed.data, "suno-add-instrumental"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-add-instrumental")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-add-instrumental", {
        jobId: job.id,
        taskId,
        audioId,
        model,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )

  // ── Add Vocals ──
  app.post(
    "/v1/suno/add-vocals",
    {
      preHandler: creditGuard(() => "suno-add-vocals"),
    },
    async (req, reply) => {
      const parsed = sunoAddVocalsBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { taskId, audioId, model } = parsed.data
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
          input_data: buildJobInputData(parsed.data, "suno-add-vocals"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-add-vocals")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-add-vocals", {
        jobId: job.id,
        taskId,
        audioId,
        model,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )

  // ── Convert WAV ──
  app.post(
    "/v1/suno/convert-wav",
    {
      preHandler: creditGuard(() => "suno-convert-wav"),
    },
    async (req, reply) => {
      const parsed = sunoConvertWavBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { taskId, audioId } = parsed.data
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
          input_data: buildJobInputData(parsed.data, "suno-convert-wav"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-convert-wav")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-convert-wav", {
        jobId: job.id,
        taskId,
        audioId,
        usageLogId,
      })

      return { jobId: job.id }
    }
  )

  // ── Upload Extend ──
  app.post(
    "/v1/suno/upload-extend",
    {
      preHandler: creditGuard(() => "suno-upload-extend"),
    },
    async (req, reply) => {
      const parsed = sunoUploadExtendBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const {
        uploadUrl, continueAt, defaultParamFlag, model,
        style, title, negativeStyle, vocalGender,
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
          input_data: buildJobInputData(parsed.data, "suno-upload-extend"),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "suno-upload-extend")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("suno-upload-extend", {
        jobId: job.id,
        uploadUrl,
        continueAt,
        defaultParamFlag,
        model,
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
