import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob, type RoutePricing } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { VIDEO_TO_VIDEO_NODE_PROVIDERS, SEEDANCE_VIDEO_EDIT_SHAPE, isSeedanceVideoEditProvider } from "@nodaro/shared/models"
import { buildSeedanceVideoEditPrompt } from "@nodaro/prompts/assembly"
import { handleTextToVideoRequest, textToVideoPricing } from "./text-to-video.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

export const videoToVideoBody = z.object({
  videoUrl: safeUrlSchema,
  prompt: z.string().max(5000).optional(),
  userPrompt: z.string().max(8000).optional(),
  // The route's own models, plus the Seedance edit models (SEEDANCE_VIDEO_EDIT_PROVIDERS),
  // which run through the Seedance reference-video lane (see seedanceEditRunBody).
  provider: z.enum(VIDEO_TO_VIDEO_NODE_PROVIDERS).optional(),
  // Wan / Wan Flash params
  duration: z.enum(["5", "10"]).optional(),
  // 480p is Seedance only (checked below).
  resolution: z.enum(["480p", "720p", "1080p"]).optional(),
  // Wan Flash's audio track; Seedance's generated sound.
  audio: z.boolean().optional(),
  multiShots: z.boolean().optional(),
  // Runway Aleph params
  aspectRatio: z.enum(["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"]).optional(),
  seed: z.number().int().min(0).optional(),
  referenceImageUrl: safeUrlSchema.optional(),
  // wan-videoedit params
  negativePrompt: z.string().max(500).optional(),
  videoEditDuration: z.enum(["0", "5", "10"]).optional(),
  audioSetting: z.enum(["auto", "origin"]).optional(),
  promptExtend: z.boolean().optional(),
  // Seedance 2.5 Draft (480p, finalized later with video-upscale).
  draft: z.boolean().optional(),
}).superRefine((b, ctx) => {
  if (b.resolution === "480p" && !isSeedanceVideoEditProvider(b.provider)) {
    ctx.addIssue({ code: "custom", path: ["resolution"], message: "480p is available on the Seedance edit models only" })
  }
})

/** A Seedance edit, before or after its body is rewritten — decided by the model alone. */
function isSeedanceEdit(req: FastifyRequest): boolean {
  return isSeedanceVideoEditProvider((req.body as Record<string, unknown> | undefined)?.provider as string | undefined)
}

/**
 * A /v1/video-to-video body for a Seedance edit model, as the ONE Seedance
 * reference-video lane takes it (/v1/text-to-video): the clip as `@video_1`,
 * the edit instruction framed as an edit, the edit shape (adaptive, Auto
 * duration). The same body the canvas node and MCP `modify_video` send, built
 * server-side so no client has to. Request-level fields (sessionId, origin,
 * workflow/node ids, mcp_client) ride along untouched.
 */
export function seedanceEditRunBody(body: Record<string, unknown>): Record<string, unknown> {
  const {
    videoUrl, referenceImageUrl, audio, prompt, userPrompt,
    duration: _v2vDuration, multiShots: _m, videoEditDuration: _e, audioSetting: _a, promptExtend: _p,
    ...rest
  } = body
  return {
    ...rest,
    prompt: buildSeedanceVideoEditPrompt(typeof prompt === "string" ? prompt : ""),
    ...(typeof (userPrompt ?? prompt) === "string" ? { userPrompt: userPrompt ?? prompt } : {}),
    ...SEEDANCE_VIDEO_EDIT_SHAPE,
    referenceVideoUrls: [videoUrl],
    ...(typeof referenceImageUrl === "string" ? { referenceImageUrls: [referenceImageUrl] } : {}),
    ...(typeof audio === "boolean" ? { generateAudio: audio } : {}),
  }
}

/** First pre-check: a valid Seedance edit body becomes the reference-lane body,
 *  so every later step — pricing, the clip-length gate, the handler — is that
 *  lane's own. Any other body is left as sent. */
async function rewriteSeedanceEdit(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  if (!isSeedanceEdit(req)) return undefined
  const parsed = videoToVideoBody.safeParse(req.body)
  if (!parsed.success) {
    return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  // An edit needs an instruction: the bare "edit @video_1 as follows:" frame
  // would run (and charge for) an edit of nothing.
  if (!parsed.data.prompt?.trim()) {
    return reply.status(400).send({ error: { code: "validation_error", message: "prompt is required for a Seedance edit: say what to change in the clip" } })
  }
  req.body = seedanceEditRunBody(req.body as Record<string, unknown>)
  return undefined
}

const onlyForSeedanceEdit = (precheck: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
  async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => (isSeedanceEdit(req) ? precheck(req, reply) : undefined)

/**
 * Everything /v1/video-to-video prices a request with — registered as the
 * route's preHandlers and run as-is by `POST /v1/quote` (one copy). Every
 * model of the route's own is a flat per-model price (the model id is the
 * credit id); a Seedance edit is priced by the reference lane's own pricing on
 * its rewritten body — the clip's length, settled to what was rendered.
 */
export const videoToVideoPricing: RoutePricing = {
  prechecks: [rewriteSeedanceEdit, ...textToVideoPricing.prechecks.map(onlyForSeedanceEdit)],
  modelResolver: (req) => isSeedanceEdit(req)
    ? textToVideoPricing.modelResolver(req)
    : ((req.body as Record<string, unknown> | undefined)?.provider as string | undefined) ?? "wan",
  opts: {
    computeCredits: (body, req) => isSeedanceEdit(req) ? textToVideoPricing.opts?.computeCredits?.(body, req) : undefined,
  },
}

export async function videoToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/video-to-video", {
    preHandler: [...videoToVideoPricing.prechecks, creditGuard(videoToVideoPricing.modelResolver, videoToVideoPricing.opts)],
  }, async (req, reply) => {
    // A Seedance edit's body was rewritten by the first pre-check; the
    // reference lane's handler takes it from here.
    if (isSeedanceEdit(req)) return handleTextToVideoRequest(req, reply)
    const parsed = videoToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { videoUrl, prompt, provider, duration, resolution, audio, multiShots, aspectRatio, seed, referenceImageUrl, negativePrompt, videoEditDuration, audioSetting, promptExtend } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // B4b: deployment prompt policy at this route's assembly point — only when
    // a prompt exists. Mirrored into parsed.data so input_data persists the
    // policed text. No policy registered = identity.
    const policed = prompt ? applyPromptPolicies({ prompt, negativePrompt: negativePrompt ?? "", kind: "video" }) : undefined
    const finalPrompt = policed ? policed.prompt : prompt
    const finalNegativePrompt = policed ? policed.negativePrompt || undefined : negativePrompt
    parsed.data.prompt = finalPrompt
    parsed.data.negativePrompt = finalNegativePrompt

    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "video-to-video"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const modelIdentifier = provider ?? "wan"
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("video-to-video", {
      jobId: job.id,
      videoUrl,
      prompt: finalPrompt,
      provider: modelIdentifier,
      duration,
      resolution,
      audio,
      multiShots,
      aspectRatio,
      seed,
      referenceImageUrl,
      negativePrompt: finalNegativePrompt,
      videoEditDuration,
      audioSetting,
      promptExtend,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
