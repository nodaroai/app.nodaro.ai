import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { shotsSchema, elementsSchema } from "../lib/video-schemas.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { insertWithIdempotencyKey } from "../lib/idempotent-insert.js"
import { TEXT_TO_VIDEO_PROVIDERS, SEEDANCE_2_REF_LIMITS, PROMPT_HARD_CEILING, videoProviderRequiresImage, isSeedance2Provider } from "@nodaro/shared"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

export const textToVideoBody = z.object({
  prompt: z.string().min(1).max(PROMPT_HARD_CEILING),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(TEXT_TO_VIDEO_PROVIDERS).optional(),
  duration: z.number().int().min(1).max(60).optional(),
  mode: z.enum(["pro", "std", "4K"]).optional(),
  sound: z.boolean().optional(),
  negativePrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  cfgScale: z.number().min(0).max(1).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]).optional(),
  multiShot: z.boolean().optional(),
  shots: shotsSchema.optional(),
  elements: elementsSchema.optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  resolution: z.string().optional(),
  generateAudio: z.boolean().optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(SEEDANCE_2_REF_LIMITS.images).optional(),
  referenceVideoUrls: z.array(safeUrlSchema).max(SEEDANCE_2_REF_LIMITS.videos).optional(),
  referenceAudioUrls: z.array(safeUrlSchema).max(SEEDANCE_2_REF_LIMITS.audio).optional(),
  webSearch: z.boolean().optional(),
  nsfwChecker: z.boolean().optional(),
  // VEO 3.x: opt out of KIE's auto-translate-to-English (default true
  // upstream). Set false to keep prompts verbatim. No effect on non-VEO.
  enableTranslation: z.boolean().optional(),
  userId: z.string().uuid().optional(),
})

export async function textToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-video", {
    preHandler: creditGuard(
      (req) => {
        const body = req.body as Record<string, unknown>
        const hasVideoRef = Array.isArray(body?.referenceVideoUrls) && (body.referenceVideoUrls as unknown[]).length > 0
        return buildVideoCreditModelIdentifier(
          (body?.provider as string) ?? "minimax",
          body?.duration as number | string | undefined,
          body?.sound as boolean | undefined,
          "text-to-video",
          body?.mode as string | undefined,
          body?.resolution as string | undefined,
          hasVideoRef,
        )
      },
      {
        computeCredits: async (body) => {
          const b = body as Record<string, unknown>
          const hasVideoRef = Array.isArray(b?.referenceVideoUrls) && (b.referenceVideoUrls as unknown[]).length > 0
          // Seedance 2 reference-video runs bill unit×(input+output): ffprobe the
          // connected reference videos and reserve the FULL scaled base up front
          // (commit_credits only refunds — never up-charges). Core may not
          // statically import ee/, so the helpers are loaded dynamically (the
          // allowed escape hatch — same pattern the credit-guard shim uses).
          if (isSeedance2Provider(b?.provider as string | undefined) && hasVideoRef) {
            const { seedance2RefVideoBaseCreditsFromUrls } = await import("../ee/billing/seedance2-ref-video-credits.js")
            return seedance2RefVideoBaseCreditsFromUrls({
              provider: b.provider as string,
              resolution: (b.resolution as string | undefined) ?? "720p",
              outputDurationSec: Number(b.duration ?? 5),
              referenceVideoUrls: b.referenceVideoUrls as unknown[],
            })
          }
          // Non-ref / other providers: the normal base for the resolved identifier
          // (matches how generate-video computes its non-addon base).
          const modelId = buildVideoCreditModelIdentifier(
            (b?.provider as string) ?? "minimax",
            b?.duration as number | string | undefined,
            b?.sound as boolean | undefined,
            "text-to-video",
            b?.mode as string | undefined,
            b?.resolution as string | undefined,
            hasVideoRef,
          )
          const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
          const { creditCost } = await getModelCreditBaseCost(modelId)
          return creditCost
        },
      },
    ),
  }, async (req, reply) => {
    const parsed = textToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { prompt, provider, duration, mode, sound, negativePrompt, cfgScale, aspectRatio, multiShot, shots, elements, seed, resolution, generateAudio, referenceImageUrls, referenceVideoUrls, referenceAudioUrls, webSearch, nsfwChecker, enableTranslation } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Image-to-video-only models (e.g. Grok Imagine Video 1.5) are surfaced in the
    // T2V provider set for unified-node visibility, but KIE requires an input image.
    // Fail fast with a clear message instead of letting the prompt-only request
    // reach the provider. The creditGuard preHandler only checks balance — no
    // reservation happens until reserveCreditsForJob below, so returning here is clean.
    if (videoProviderRequiresImage(provider)) {
      return reply.status(400).send({
        error: {
          code: "image_required",
          message: `${provider} requires an input image — connect an image to the node's image input (reference images alone are not enough).`,
        },
      })
    }

    // Determine model identifier for credit check (supports variable pricing by duration/audio/resolution/video-ref)
    const modelIdentifier = buildVideoCreditModelIdentifier(
      provider ?? "minimax",
      duration,
      sound,
      "text-to-video",
      mode,
      resolution,
      (referenceVideoUrls?.length ?? 0) > 0,
    )

    const mcpClient = extractMcpClient(req.body)
    // job_type powers the reconcile cron's correct finalization path —
    // see lib/reconcile/replicate.ts (defaults to "generate-image" when
    // null, which mis-uploads videos as images).
    //
    // Race-proof INSERT via DB UNIQUE constraint on (user_id,
    // idempotency_key). See generate-image.ts for full rationale.
    let insertResult: { row: { id: string }; created: boolean }
    try {
      insertResult = await insertWithIdempotencyKey<{ id: string }>(
        "jobs",
        {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          job_type: "text-to-video",
          status: "pending",
          input_data: buildJobInputData(parsed.data, "text-to-video"),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        },
        req.idempotencyKey,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({
        error: { code: "internal_error", message },
      })
    }
    const job = insertResult.row

    if (!insertResult.created) {
      reply.header("X-Dedup-Hit", "1")
      return reply.code(200).send({ jobId: job.id, deduped: true })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("text-to-video", {
      jobId: job.id,
      prompt,
      provider,
      duration,
      mode,
      sound,
      negativePrompt,
      cfgScale,
      aspectRatio,
      multiShot,
      shots,
      elements,
      seed,
      resolution,
      generateAudio,
      referenceImageUrls,
      referenceVideoUrls,
      referenceAudioUrls,
      webSearch,
      nsfwChecker,
      enableTranslation,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
