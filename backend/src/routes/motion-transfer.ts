/**
 * Motion Transfer Route
 *
 * Applies motion from a source video to a character from a source image.
 * Supports Kling 2.6 and Kling 3.0 Motion Control models via KIE.ai.
 *
 * Input:
 * - imageUrl: Character reference image
 * - videoUrl: Motion source video
 * - prompt: Optional text prompt (max 2500 chars)
 * - characterOrientation: "image" or "video" — both Kling 2.6 and 3.0
 * - resolution: "480p" / "580p" / "720p" (Wan Animate) or "720p" / "1080p" (Kling);
 *   a size the model does not have runs, and is charged, as the size
 *   `motionTransferResolution` moves it to (Wan Animate's 1080p as 720p),
 *   and the answer's `adjustments` says so
 * - provider: "kling" (2.6), "kling-3.0", "wan-animate-move" or "wan-animate-replace"
 * - backgroundSource: "input_video" or "input_image" — Kling 3.0 only
 */

import type { FastifyInstance } from "fastify"
import { sendInternalError } from "../lib/http-errors.js"
import { insertJob } from "../lib/insert-job.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { withResolvedModel } from "../lib/job-resolved-model.js"
import { MOTION_TRANSFER_PROVIDERS, PROMPT_HARD_CEILING } from "@nodaro/shared/models"
import { buildMotionCreditModelIdentifier, motionTransferResolution } from "@nodaro/shared/credits"
import { formatZodError } from "../lib/zod-error.js"
import { jobRunModel } from "../lib/run-model.js"
import { withAdjustments } from "../lib/image-gen-normalize.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"

export const motionTransferBody = z.object({
  imageUrl: safeUrlSchema,
  videoUrl: safeUrlSchema,
  prompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  negativePrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  userPrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  characterOrientation: z.enum(["image", "video"]).default("image"),
  resolution: z.enum(["480p", "580p", "720p", "1080p"]).default("720p"),
  provider: z.enum(MOTION_TRANSFER_PROVIDERS).default("kling"),
  backgroundSource: z.enum(["input_video", "input_image"]).optional(),
  videoDuration: z.number().min(1).max(60).optional(),
})

export async function motionTransferRoutes(app: FastifyInstance) {
  app.post("/v1/motion-transfer", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      const provider = (body?.provider as string) ?? "kling"
      const resolution = (body?.resolution as string) ?? "720p"
      const videoDuration = (body?.videoDuration as number) ?? undefined
      return buildMotionCreditModelIdentifier(provider, resolution, videoDuration)
    }, { runModel: jobRunModel("motion-transfer") }),
  }, async (req, reply) => {
    const parsed = motionTransferBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { imageUrl, videoUrl, prompt, negativePrompt, characterOrientation, provider, backgroundSource, videoDuration } = parsed.data
    // The size the model runs at, sent, recorded and charged alike (the guard
    // above prices through the same rule).
    const sized = motionTransferResolution(provider, parsed.data.resolution)
    const resolution = sized.resolution as typeof parsed.data.resolution
    parsed.data.resolution = resolution
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // B4b: deployment prompt policy at this route's assembly point — only when
    // a prompt exists (policing "" would inject a policy clause as the entire
    // prompt). Mirrored into parsed.data so input_data persists the policed
    // text. No policy registered = identity.
    const policed = prompt ? applyPromptPolicies({ prompt, negativePrompt: negativePrompt ?? "", kind: "video" }) : undefined
    const finalPrompt = policed ? policed.prompt : prompt
    const finalNegativePrompt = policed ? policed.negativePrompt || undefined : negativePrompt
    parsed.data.prompt = finalPrompt
    parsed.data.negativePrompt = finalNegativePrompt

    const modelIdentifier = buildMotionCreditModelIdentifier(provider, resolution, videoDuration)
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: withResolvedModel(buildJobInputData(parsed.data, "motion-transfer"), "motion-transfer"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to transfer motion")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("motion-transfer", {
      jobId: job.id,
      imageUrl,
      videoUrl,
      prompt: finalPrompt,
      negativePrompt: finalNegativePrompt,
      characterOrientation,
      resolution,
      provider,
      backgroundSource,
      videoDuration,
      usageLogId,
    }))
    if (reply.sent) return

    return withAdjustments({ jobId: job.id }, sized.adjustments)
  })
}
