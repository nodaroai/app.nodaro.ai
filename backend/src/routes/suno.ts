import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { SUNO_MODELS, SUNO_ADD_TRACK_MODELS } from "@nodaro/shared"
import {
  sunoStyleBoost,
  sunoVoiceValidate,
  sunoVoiceValidateInfo,
  sunoVoiceRegenerate,
  sunoVoiceGenerate,
  sunoVoiceRecordInfo,
} from "../providers/kie/suno-client.js"
import { CreditsService } from "../ee/billing/credits.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import {
  commitReservedCreditsForJob,
  refundReservedCreditsForJob,
} from "../lib/credits-job-lifecycle.js"
import { formatZodError } from "../lib/zod-error.js"

const SUNO_VOICE_CREATE_CREDIT_ID = "suno-voice-create"
const SUNO_VOICE_VALIDATE_TAG = "suno-voice-validate"

// Ownership tracked via `jobs` rows tagged `model_identifier=tag` with
// `metadata.kie_task_id=taskId`. Without this check, auth'd callers could
// poll arbitrary KIE task ids (IDOR).
async function userOwnsVoiceTask(
  taskId: string,
  userId: string,
  tag: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("model_identifier", tag)
    .eq("metadata->>kie_task_id", taskId)
    .limit(1)
  return Boolean(data?.length)
}

const sunoModelEnum = z.enum(SUNO_MODELS).optional().default("V5_5")
const sunoAddTrackModelEnum = z.enum(SUNO_ADD_TRACK_MODELS).optional().default("V5_5")

function sunoModelCreditType(model: string | undefined, fallback: string): string {
  if (model === "V5_5") return "suno-v5_5"
  if (model === "V5") return "suno-v5"
  return fallback
}

const personaModelEnum = z.enum(["voice_persona", "style_persona"])

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
  personaId: z.string().min(1).max(200).optional(),
  personaModel: personaModelEnum.optional(),
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
  personaId: z.string().min(1).max(200).optional(),
  personaModel: personaModelEnum.optional(),
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
  personaId: z.string().min(1).max(200).optional(),
  personaModel: personaModelEnum.optional(),
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

const sunoVoiceLanguageEnum = z.enum([
  "en", "zh", "es", "fr", "pt", "de", "ja", "ko", "hi", "ru",
])

const sunoVoiceSkillLevelEnum = z.enum([
  "beginner", "intermediate", "advanced", "professional",
])

const sunoVoiceValidateBody = z
  .object({
    voiceUrl: safeUrlSchema,
    vocalStartS: z.number().int().min(0).max(600),
    vocalEndS: z.number().int().min(1).max(600),
    language: sunoVoiceLanguageEnum.optional(),
    userId: z.string().uuid().optional(),
  })
  .refine((d) => d.vocalEndS > d.vocalStartS, {
    message: "vocalEndS must be greater than vocalStartS",
    path: ["vocalEndS"],
  })

const sunoVoiceTaskIdQuery = z.object({
  taskId: z.string().min(1),
})

const sunoVoiceRegenerateBody = z.object({
  taskId: z.string().min(1),
  userId: z.string().uuid().optional(),
})

const sunoVoiceGenerateBody = z.object({
  taskId: z.string().min(1),
  verifyUrl: safeUrlSchema,
  voiceName: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  style: z.string().max(500).optional(),
  singerSkillLevel: sunoVoiceSkillLevelEnum.optional(),
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
        return sunoModelCreditType(body?.model as string, "suno-generate")
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
        instrumental, personaId, personaModel,
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

      const creditType = sunoModelCreditType(model, "suno-generate")
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
        personaId,
        personaModel: personaId ? (personaModel ?? "voice_persona") : undefined,
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
        return sunoModelCreditType(body?.model as string, "suno-cover")
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
        instrumental, personaId, personaModel,
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

      const creditType = sunoModelCreditType(model, "suno-cover")
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
        personaId,
        personaModel: personaId ? (personaModel ?? "voice_persona") : undefined,
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
        return sunoModelCreditType(body?.model as string, "suno-extend")
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
        personaId, personaModel,
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

      const creditType = sunoModelCreditType(model, "suno-extend")
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
        personaId,
        personaModel: personaId ? (personaModel ?? "voice_persona") : undefined,
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

  // ────────────────────────────────────────────────────────────────────────
  // Voice Persona — 2-stage human-in-the-loop flow
  // ────────────────────────────────────────────────────────────────────────
  // Stage 1: validate → poll validate-info → user reads phrase
  // Stage 2: generate → poll record-info → voiceId
  //
  // Credits (20cr) are reserved on POST /voice/generate against a `jobs`
  // row; the GET /voice/record-info endpoint commits or refunds when KIE
  // reports terminal state.

  // POST /v1/suno/voice/validate — kicks off validation (no credits).
  // Inserts a `jobs` row tagged `model_identifier="suno-voice-validate"` so
  // subsequent polls / regenerate / generate calls can verify the caller owns
  // the returned taskId.
  app.post("/v1/suno/voice/validate", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    const parsed = sunoVoiceValidateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    let result
    try {
      result = await sunoVoiceValidate({
        voiceUrl: parsed.data.voiceUrl,
        vocalStartS: parsed.data.vocalStartS,
        vocalEndS: parsed.data.vocalEndS,
        language: parsed.data.language,
      })
    } catch (err) {
      return reply.status(502).send({
        error: { code: "upstream_error", message: (err as Error).message },
      })
    }
    // Record ownership AFTER KIE succeeds. If the insert fails the user can
    // still retry validate; nothing has been charged. The reconcile cron's
    // sync-sweep handles abandoned `kie-suno-voice-validate` rows past 24h.
    const nowIso = new Date().toISOString()
    await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        status: "processing",
        provider: "kie",
        model_identifier: SUNO_VOICE_VALIDATE_TAG,
        started_at: nowIso,
        provider_kind: "kie-suno-voice-validate",
        provider_call_started_at: nowIso,
        input_data: buildJobInputData(parsed.data, SUNO_VOICE_VALIDATE_TAG),
        metadata: { kie_task_id: result.taskId },
      })
      .then(() => {}, (err) => {
        // Best-effort — the modal flow can still proceed if the insert raced.
        console.warn(`[suno-voice] validate ownership insert failed: ${err.message}`)
      })
    return result
  })

  // GET /v1/suno/voice/validate-info?taskId=… — poll for the validation phrase.
  // 404s if the caller doesn't own the taskId.
  app.get("/v1/suno/voice/validate-info", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    const parsed = sunoVoiceTaskIdQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    if (!(await userOwnsVoiceTask(parsed.data.taskId, userId, SUNO_VOICE_VALIDATE_TAG))) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Voice validate task not found" },
      })
    }
    try {
      return await sunoVoiceValidateInfo(parsed.data.taskId)
    } catch (err) {
      return reply.status(502).send({
        error: { code: "upstream_error", message: (err as Error).message },
      })
    }
  })

  // POST /v1/suno/voice/regenerate — get a fresh validation phrase for an
  // existing validate task. 404s if the caller doesn't own the input taskId.
  app.post("/v1/suno/voice/regenerate", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    const parsed = sunoVoiceRegenerateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    if (!(await userOwnsVoiceTask(parsed.data.taskId, userId, SUNO_VOICE_VALIDATE_TAG))) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Voice validate task not found" },
      })
    }
    let result
    try {
      result = await sunoVoiceRegenerate(parsed.data.taskId)
    } catch (err) {
      return reply.status(502).send({
        error: { code: "upstream_error", message: (err as Error).message },
      })
    }
    // Record ownership of the new taskId returned by regenerate.
    await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        status: "processing",
        provider: "kie",
        model_identifier: SUNO_VOICE_VALIDATE_TAG,
        started_at: new Date().toISOString(),
        input_data: { type: SUNO_VOICE_VALIDATE_TAG, regeneratedFrom: parsed.data.taskId },
        metadata: { kie_task_id: result.taskId },
      })
      .then(() => {}, (err) => {
        console.warn(`[suno-voice] regenerate ownership insert failed: ${err.message}`)
      })
    return result
  })

  // POST /v1/suno/voice/generate — reserves 20cr, kicks off voice generation
  app.post(
    "/v1/suno/voice/generate",
    {
      // Pass 3 — rate-limit so a stolen JWT can't burn 20cr×N quickly.
      config: { rateLimit: { max: 5, timeWindow: "1m" } },
      preHandler: creditGuard(() => SUNO_VOICE_CREATE_CREDIT_ID),
    },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }
      const parsed = sunoVoiceGenerateBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      // IDOR guard — the validate taskId must belong to this user. We do this
      // BEFORE creating the generate jobs row and BEFORE reserving credits so
      // a malicious caller passing someone else's validate taskId is rejected
      // cleanly without touching their balance.
      if (!(await userOwnsVoiceTask(parsed.data.taskId, userId, SUNO_VOICE_VALIDATE_TAG))) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Voice validate task not found" },
        })
      }

      // Step 1 — create a jobs row so credit lifecycle (reserve/commit/refund)
      // is consistent with the rest of the codebase.
      const { data: job, error: jobErr } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "suno-voice-create"),
        })
        .select("id")
        .single()
      if (jobErr || !job) {
        return reply.status(500).send({
          error: { code: "internal_error", message: jobErr?.message ?? "job_create_failed" },
        })
      }

      // Step 2 — reserve credits AGAINST the jobs row.
      const reservation = await reserveCreditsForJob(
        req,
        reply,
        job.id,
        SUNO_VOICE_CREATE_CREDIT_ID,
      )
      if (reply.sent) return
      if (!reservation) {
        return reply.status(503).send({
          error: { code: "reservation_failed", message: "Could not reserve credits" },
        })
      }

      // Step 3 — call KIE generate synchronously; on failure refund + mark failed.
      // markProviderCallStart sets `provider_kind` + `provider_call_started_at`
      // so reconcile's sync-sweep can refund the 20cr reservation if the user
      // abandons the modal (past 2h). Migrated from `sweepStaleVoiceJobs`.
      await markProviderCallStart(job.id, "kie-suno-voice-create")
      try {
        const { taskId: kieTaskId } = await sunoVoiceGenerate({
          taskId: parsed.data.taskId,
          verifyUrl: parsed.data.verifyUrl,
          voiceName: parsed.data.voiceName,
          description: parsed.data.description,
          style: parsed.data.style,
          singerSkillLevel: parsed.data.singerSkillLevel,
        })

        await supabase
          .from("jobs")
          .update({
            status: "processing",
            provider: "kie",
            model_identifier: SUNO_VOICE_CREATE_CREDIT_ID,
            started_at: new Date().toISOString(),
            metadata: { kie_task_id: kieTaskId, credit_identifier: SUNO_VOICE_CREATE_CREDIT_ID },
          })
          .eq("id", job.id)
          .eq("user_id", userId)

        return { jobId: job.id, kieTaskId }
      } catch (err) {
        const message = (err as Error).message
        await supabase
          .from("jobs")
          .update({ status: "failed", error: message })
          .eq("id", job.id)
          .eq("user_id", userId)
          .then(() => {}, () => {})
        await refundReservedCreditsForJob(job.id)
        return reply.status(502).send({
          error: { code: "upstream_error", message },
        })
      }
    },
  )

  // GET /v1/suno/voice/record-info?taskId=… — poll for voiceId.
  // 404s if the caller doesn't own the taskId.
  // Doubles as the commit/refund site: when KIE reports a terminal status the
  // matching `suno-voice-create` jobs row is marked completed/failed and the
  // 20cr reservation is committed or refunded. CreditsService commit/refund
  // are idempotent (CAS on status='reserved'), so concurrent polls are safe.
  app.get("/v1/suno/voice/record-info", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    const parsed = sunoVoiceTaskIdQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    // Ownership check — find the caller's jobs row for this generate taskId.
    // Includes terminal statuses so a successful row can be re-polled
    // idempotently after the modal closes and re-opens.
    const { data: ownedJobs } = await supabase
      .from("jobs")
      .select("id, status")
      .eq("user_id", userId)
      .eq("model_identifier", SUNO_VOICE_CREATE_CREDIT_ID)
      .eq("metadata->>kie_task_id", parsed.data.taskId)
      .limit(1)
    const ownedJob = ownedJobs?.[0]
    if (!ownedJob) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Voice generate task not found" },
      })
    }

    let info
    try {
      info = await sunoVoiceRecordInfo(parsed.data.taskId)
    } catch (err) {
      return reply.status(502).send({
        error: { code: "upstream_error", message: (err as Error).message },
      })
    }

    // Side effect — commit/refund credits when KIE first flips to a terminal
    // state. Only runs while the jobs row is still in a non-terminal state, so
    // re-polls after success are no-ops.
    if (
      (info.status === "success" || info.status === "fail") &&
      (ownedJob.status === "pending" || ownedJob.status === "processing")
    ) {
      if (info.status === "success" && info.voiceId) {
        await supabase
          .from("jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            output_data: { voiceId: info.voiceId },
          })
          .eq("id", ownedJob.id)
          .eq("user_id", userId)
          .in("status", ["pending", "processing"])
          .then(() => {}, () => {})
        await commitReservedCreditsForJob(ownedJob.id)
      } else if (info.status === "fail") {
        await supabase
          .from("jobs")
          .update({
            status: "failed",
            error: info.errorMessage || "voice generation failed",
          })
          .eq("id", ownedJob.id)
          .eq("user_id", userId)
          .in("status", ["pending", "processing"])
          .then(() => {}, () => {})
        await refundReservedCreditsForJob(ownedJob.id)
      }
    }

    return info
  })
}
