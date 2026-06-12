/**
 * Extend Video Route
 *
 * Extends a VEO or Runway video with a new prompt.
 * Requires the original KIE taskId from the upstream video generation job.
 *
 * Providers:
 * - veo-extend: VEO 3.1 extend (POST /api/v1/veo/extend)
 * - runway-extend: Runway extend (POST /api/v1/runway/extend)
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { EXTEND_VIDEO_PROVIDERS, VIDEO_PROMPT_MAX, applyVideoNegativePrompt, buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

// KIE providers (veo-extend, runway-extend) need a kieTaskId from the upstream
// generation; LTX 2.3 Pro is a Replicate model that takes a raw videoUrl. Both
// fields are optional at the schema level and conditionally required inside
// the handler so each provider's required input set is enforced precisely.
const extendVideoBody = z.object({
  kieTaskId: z.string().min(1).optional(), // Required for veo-extend / runway-extend
  videoUrl: safeUrlSchema.optional(),       // Required for ltx-2.3-pro
  prompt: z.string().min(1).optional(),    // Required for veo-extend / runway-extend; optional for LTX
  negativePrompt: z.string().max(VIDEO_PROMPT_MAX).optional(), // Always optional — injected into prompt as "Avoid: …" for non-native providers
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(EXTEND_VIDEO_PROVIDERS),
  model: z.enum(["fast", "quality"]).optional(), // VEO only
  seeds: z.number().int().min(10000).max(99999).optional(), // VEO only
  quality: z.enum(["720p", "1080p"]).optional(), // Runway only
  extendMode: z.enum(["start", "end"]).optional(), // LTX 2.3 Pro only
  duration: z.number().int().min(1).max(20).optional(), // Seconds to add — LTX 1-20; seedance-2-extend snaps to 4-15 in the worker
  resolution: z.enum(["480p", "720p", "1080p"]).optional(), // seedance-2-extend only
  generateAudio: z.boolean().optional(), // seedance-2-extend only (default true)
})

// Resolve the credit identifier used by both the preHandler check and the
// downstream credit reservation. Keeping these in sync is critical — a
// divergence would charge the preHandler's price but reserve at a different
// price, which can let under-funded users through or over-charge paying ones.
function resolveExtendVideoIdentifier(body: Record<string, unknown> | undefined): string {
  const provider = (body?.provider as string) ?? "veo-extend"
  if (provider === "veo-extend" && body?.model === "quality") {
    return "veo-extend:quality"
  }
  if (provider === "seedance-2-extend") {
    // Duration tier × resolution composites (rows include stitch overhead).
    // Same builder the ee credits resolver uses, so guard + reserve + node
    // cost display can never diverge.
    return buildVideoCreditModelIdentifier(
      provider,
      (body?.duration as number) ?? 8,
      undefined,
      undefined,
      undefined,
      (body?.resolution as string) ?? "720p",
    )
  }
  return provider
}

export async function extendVideoRoutes(app: FastifyInstance) {
  app.post("/v1/extend-video", {
    preHandler: creditGuard((req) => resolveExtendVideoIdentifier(req.body as Record<string, unknown> | undefined)),
  }, async (req, reply) => {
    const parsed = extendVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { kieTaskId, videoUrl, prompt, negativePrompt, provider, model, seeds, quality, extendMode, duration } = parsed.data
    // None of the current extend providers (veo-extend / runway-extend / ltx-2.3-pro)
    // support `negative_prompt` natively, so the helper appends "Avoid: …" to
    // the user prompt before it reaches the queue. LTX doesn't consume the
    // prompt at all — the negative is silently dropped for that provider,
    // matching its existing prompt-ignored behavior.
    const { prompt: effectivePrompt } = applyVideoNegativePrompt(prompt, negativePrompt, provider)
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Per-provider required fields. The Zod schema makes everything optional
    // because the union is wider than any single provider; we enforce per
    // provider here so error messages stay specific instead of asking the
    // user to fill fields that don't apply to their provider.
    if (provider === "ltx-2.3-pro") {
      if (!videoUrl) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "videoUrl is required for ltx-2.3-pro" },
        })
      }
    } else if (provider === "seedance-2-extend") {
      // URL-based like LTX, but the continuation CONTENT is required — the
      // worker wraps it in the spike-proven bare template ("Generate the
      // content after Video 1: …"); an empty continuation has nothing to say.
      if (!videoUrl) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "videoUrl is required for seedance-2-extend" },
        })
      }
      if (!prompt) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "prompt (what happens next) is required for seedance-2-extend" },
        })
      }
    } else {
      // veo-extend, runway-extend — KIE-based, require the kieTaskId from
      // upstream + a prompt.
      if (!kieTaskId) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "kieTaskId is required for KIE-based extend providers" },
        })
      }
      if (!prompt) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "prompt is required for KIE-based extend providers" },
        })
      }
    }

    const mcpClient = extractMcpClient(req.body)
    // job_type powers the reconcile cron's correct finalization path —
    // see lib/reconcile/replicate.ts (defaults to "generate-image" when
    // null, which mis-uploads videos as images for LTX prediction jobs).
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        job_type: "extend-video",
        status: "pending",
        input_data: buildJobInputData(parsed.data, "extend-video"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(
      req,
      reply,
      job.id,
      resolveExtendVideoIdentifier(req.body as Record<string, unknown> | undefined),
    )
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // Translate camelCase API params → snake_case worker payload to match the
    // shape the LTX worker handler reads (mirrors the orchestrator payload-
    // builder's emit shape for the same case).
    const queuePayload =
      provider === "ltx-2.3-pro"
        ? {
            jobId: job.id,
            provider,
            video: videoUrl,
            duration,
            extend_mode: extendMode ?? "end",
            usageLogId,
          }
        : provider === "seedance-2-extend"
        ? {
            jobId: job.id,
            provider,
            video: videoUrl,
            // effectivePrompt carries any negative as in-prompt "Avoid: …" —
            // the seedance-correct constraint placement (no native param).
            prompt: effectivePrompt,
            duration,
            resolution: parsed.data.resolution,
            generateAudio: parsed.data.generateAudio,
            usageLogId,
          }
        : {
            jobId: job.id,
            kieTaskId,
            prompt: effectivePrompt,
            provider,
            model,
            seeds,
            quality,
            usageLogId,
          }
    await videoQueue.add("extend-video", queuePayload)

    return { jobId: job.id }
  })
}
