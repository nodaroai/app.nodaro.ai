import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { resolveCinematicCreditId } from "@nodaro/shared"

// HeyGen combined reference caps (see create-video.md): at most 3 videos and 9
// images across avatar looks + references. Avatar looks are image looks, so
// they count toward the 9-image budget.
const MAX_REFERENCE_VIDEOS = 3
const MAX_REFERENCE_IMAGES = 9

// HeyGen `type:"cinematic_avatar"` — a prompt-driven generative clip referencing
// 1–3 avatar look ids. NO script / voice / audio / engine. `references` is an
// optional array of extra media (images/videos/audio) guiding generation; each
// item carries an internal media-kind `type` used here for caps validation,
// then mapped to HeyGen's AssetUrl shape in the provider.
const cinematicReference = z.object({
  type: z.enum(["video", "image", "audio"]),
  url: safeUrlSchema,
})

const cinematicAvatarBody = z
  .object({
    prompt: z.string().min(1).max(10000),
    avatarLooks: z.array(z.string().min(1)).min(1).max(3),
    duration: z.number().int().min(4).max(15).optional(),
    autoDuration: z.boolean().optional(),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
    resolution: z.enum(["720p", "1080p"]).default("720p"),
    enhancePrompt: z.boolean().optional(),
    references: z.array(cinematicReference).optional(),
    userId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    const refs = data.references ?? []
    const videoCount = refs.filter((r) => r.type === "video").length
    // Avatar looks are image looks — they count toward the combined image cap.
    const imageCount = data.avatarLooks.length + refs.filter((r) => r.type === "image").length

    if (videoCount > MAX_REFERENCE_VIDEOS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["references"],
        message: `At most ${MAX_REFERENCE_VIDEOS} video references are allowed (got ${videoCount}).`,
      })
    }
    if (imageCount > MAX_REFERENCE_IMAGES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["references"],
        message: `At most ${MAX_REFERENCE_IMAGES} images are allowed across avatar looks + image references (got ${imageCount}).`,
      })
    }
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
        references,
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
        references,
        usageLogId,
      })

      return { jobId: job.id }
    },
  )
}
