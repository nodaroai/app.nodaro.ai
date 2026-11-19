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
import { withResolvedModel } from "../lib/job-resolved-model.js"
import { VIDEO_TO_VIDEO_NODE_PROVIDERS, SEEDANCE_VIDEO_EDIT_SHAPE, SEEDANCE_VIDEO_EDIT_TASK_TYPE, isSeedanceVideoEditProvider, videoToVideoProviderOf } from "@nodaro/shared/models"
import { uiResolutionFill } from "@nodaro/shared/video"
import { buildSeedanceVideoEditPrompt } from "@nodaro/prompts/assembly"
import { handleTextToVideoRequest, textToVideoBody, textToVideoPricing } from "./text-to-video.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { jobRunModel } from "../lib/run-model.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { isClipPricedV2vProvider, videoToVideoSentResolution } from "@nodaro/shared/credits"
import { measureVideoToVideoClip, videoToVideoClipBaseCredits } from "../lib/video-to-video-clip-input.js"
import { dropClientMeasureFields, requestMeasure, setRequestMeasure } from "../lib/request-measure.js"
import { ROUTE_MEASURE_DEADLINE_MS } from "../lib/pre-charge-probe-bounds.js"
import { probeRefusalStatus } from "../providers/video/probe-guard.js"

const SEEDANCE_EDIT_ONLY_LISTS = ["referenceImageUrls", "referenceVideoUrls", "referenceAudioUrls"] as const

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
  // Seedance edit models only (checked below): more references for the edit,
  // passed to the reference lane, whose own caps apply (the source clip counts
  // as one of the videos). Numbering: {video:1} is the source, these clips are
  // {video:2}, {video:3}, …; images follow `referenceImageUrl` when it is sent.
  referenceImageUrls: z.array(safeUrlSchema).optional(),
  referenceVideoUrls: z.array(safeUrlSchema).optional(),
  referenceAudioUrls: z.array(safeUrlSchema).optional(),
}).superRefine((b, ctx) => {
  // A body naming no model is the default's (a Seedance edit).
  if (isSeedanceVideoEditProvider(videoToVideoProviderOf(b.provider))) return
  if (b.resolution === "480p") {
    ctx.addIssue({ code: "custom", path: ["resolution"], message: "480p is available on the Seedance edit models only" })
  }
  for (const field of SEEDANCE_EDIT_ONLY_LISTS) {
    if (b[field] !== undefined) {
      ctx.addIssue({ code: "custom", path: [field], message: `${field} is available on the Seedance edit models only` })
    }
  }
})

/**
 * The route's FIRST pre-check: a body that names no model gets the default
 * written into it (`videoToVideoProviderOf`, Seedance 2.5 edit), so everything
 * after it reads one model off the body: the Seedance rewrite, the guard's
 * model door and free-plan rule, the price, the hold and the job. `POST
 * /v1/quote` runs it too, with the route's other pre-checks.
 */
export async function nameDefaultVideoToVideoModel(req: FastifyRequest): Promise<undefined> {
  const body = req.body
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>
    if (record.provider === undefined || record.provider === null || record.provider === "") {
      const model = videoToVideoProviderOf(undefined)
      record.provider = model
      // With no resolution either, the default renders at the size a node with
      // none set renders (`uiResolutionFill`: the model's first, 480p). A
      // request that names its model keeps the lane's own handling.
      const fill = uiResolutionFill(model)
      if ((record.resolution === undefined || record.resolution === null) && record.draft !== true && fill !== undefined) record.resolution = fill
    }
  }
  return undefined
}

/** A Seedance edit, before or after its body is rewritten — decided by the model alone. */
function isSeedanceEdit(req: FastifyRequest): boolean {
  return isSeedanceVideoEditProvider((req.body as Record<string, unknown> | undefined)?.provider as string | undefined)
}

const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * A /v1/video-to-video body for a Seedance edit model, as the ONE Seedance
 * reference-video lane takes it (/v1/text-to-video): the clip as `@video_1`,
 * the edit instruction framed as an edit, the edit shape (adaptive, Auto
 * duration), and every other reference after it. The same body the canvas
 * node and MCP `modify_video` send, built server-side so no client has to. Request-level fields (sessionId, origin,
 * workflow/node ids, mcp_client) ride along untouched.
 *
 * It also requests the edit task type, set LAST so a caller's own
 * `referenceTaskType` cannot turn the edit into something else. The lane
 * declares it only when the clips qualify (`resolveVideoRequestNorm`); an edit
 * whose clip is outside the edit's lengths goes out undeclared, as before.
 */
export function seedanceEditRunBody(body: Record<string, unknown>): Record<string, unknown> {
  const {
    videoUrl, referenceImageUrl, referenceImageUrls, referenceVideoUrls, audio, prompt, userPrompt,
    duration: _v2vDuration, multiShots: _m, videoEditDuration: _e, audioSetting: _a, promptExtend: _p,
    ...rest
  } = body
  const imageUrls = [...(typeof referenceImageUrl === "string" ? [referenceImageUrl] : []), ...listOf(referenceImageUrls)]
  // referenceAudioUrls rides along in `rest`.
  return {
    ...rest,
    prompt: buildSeedanceVideoEditPrompt(typeof prompt === "string" ? prompt : ""),
    ...(typeof (userPrompt ?? prompt) === "string" ? { userPrompt: userPrompt ?? prompt } : {}),
    ...SEEDANCE_VIDEO_EDIT_SHAPE,
    // The source is {video:1}; extra clips number on from it.
    referenceVideoUrls: [videoUrl, ...listOf(referenceVideoUrls)],
    ...(imageUrls.length > 0 ? { referenceImageUrls: imageUrls } : {}),
    ...(typeof audio === "boolean" ? { generateAudio: audio } : {}),
    referenceTaskType: SEEDANCE_VIDEO_EDIT_TASK_TYPE,
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
  const runBody = seedanceEditRunBody(req.body as Record<string, unknown>)
  // The rewritten body is the reference lane's: its own rules (the reference
  // caps — the source counts as one of the videos) decide it here, so a quote
  // refuses exactly what the run refuses, and nothing is probed past a cap.
  const lane = textToVideoBody.safeParse(runBody)
  if (!lane.success) {
    return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(lane.error) } })
  }
  req.body = runBody
  return undefined
}

/** Body fields named like the clip's length or its price: dropped from every request, never read. */
const CLIENT_CLIP_FIELDS: readonly string[] = ["videoDuration", "videoToVideoBilledSeconds", "videoToVideoUnits", "__videoToVideoClip"]
/** The request measure the clip step keeps, server-side only, for the guard's pricing and the handler. */
const CLIP = "videoToVideoClip"
/** What the clip step read: the clip's length, the seconds held, and the row and units priced. */
interface VideoToVideoClipStash {
  readonly clipSec: number
  readonly billedSeconds: number
  readonly creditId: string
  readonly units?: number
}

/** What the clip step recorded for this request (the server-side request's, never the body's). */
function clipOf(req: FastifyRequest): VideoToVideoClipStash | undefined {
  return requestMeasure<VideoToVideoClipStash>(req, CLIP)
}

/** The model a request runs on: the one its body names (the first pre-check names the default). */
function runProvider(req: FastifyRequest): string {
  return videoToVideoProviderOf((req.body as Record<string, unknown> | undefined)?.provider)
}

/**
 * The credit guard's `beforePricing` step for the models priced by their
 * clip's length (HappyHorse Edit, Wan 2.7 VideoEdit): past the guard's model
 * and node doors, the app-token scope gate and the Idempotency-Key dedup (so a
 * model the deployment withholds never costs a download), validate the body
 * with the handler's own schema, read the clip's length
 * (`measureVideoToVideoClip`, the rule the workflow run shares), refuse what
 * the model cannot take with nothing held, and keep the result on the
 * server-side request. `POST /v1/quote` runs this same step. Every other model
 * is never probed; a Seedance edit runs its own lane's steps.
 */
export async function videoToVideoClipStep(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isSeedanceEdit(req)) return
  dropClientMeasureFields(req.body, CLIENT_CLIP_FIELDS)
  const provider = runProvider(req)
  if (!isClipPricedV2vProvider(provider)) return
  const parsed = videoToVideoBody.safeParse(req.body)
  if (!parsed.success) {
    return void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  const { videoUrl, resolution, videoEditDuration } = parsed.data
  const read = await measureVideoToVideoClip({ provider, resolution, videoEditDuration }, videoUrl, (err) => {
    req.log.warn({ err }, "video-to-video: ffprobe failed; refusing the run")
  }, { deadlineAt: Date.now() + ROUTE_MEASURE_DEADLINE_MS })
  if (!read.ok) {
    return void reply.status(probeRefusalStatus(read.code)).send({ error: { code: read.code, message: read.message } })
  }
  setRequestMeasure(req, CLIP, {
    clipSec: read.clipSec,
    billedSeconds: read.billedSeconds,
    creditId: read.creditId,
    ...(read.units !== undefined ? { units: read.units } : {}),
  } satisfies VideoToVideoClipStash)
}

/** The row a clip-priced run reserves (the clip step's); the throw only covers a body that step already refused. */
function clipCreditId(req: FastifyRequest): string {
  const stash = clipOf(req)
  if (!stash) throw new Error("video-to-video: the run reached its pricing without its clip's length")
  return stash.creditId
}

const onlyForSeedanceEdit = (precheck: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
  async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => (isSeedanceEdit(req) ? precheck(req, reply) : undefined)

/**
 * Everything /v1/video-to-video prices a request with — registered as the
 * route's preHandlers and run as-is by `POST /v1/quote` (one copy):
 * - HappyHorse Edit and Wan 2.7 VideoEdit are priced by the length of their
 *   clip, read before anything is held (`videoToVideoClipStep`): the row and
 *   units it chose (`videoToVideoClipPrice`, @nodaro/shared);
 * - every other model of the route's own is a flat per-model price (the model
 *   id is the credit id);
 * - a Seedance edit is priced by the reference lane's own pricing on its
 *   rewritten body — the clip's length, settled to what was rendered.
 */
export const videoToVideoPricing: RoutePricing = {
  prechecks: [nameDefaultVideoToVideoModel, rewriteSeedanceEdit, ...textToVideoPricing.prechecks.map(onlyForSeedanceEdit)],
  modelResolver: (req) => {
    if (isSeedanceEdit(req)) return textToVideoPricing.modelResolver(req)
    const provider = runProvider(req)
    return isClipPricedV2vProvider(provider) ? clipCreditId(req) : provider
  },
  opts: {
    runModel: jobRunModel("video-to-video"),
    computeCredits: async (body, req) => {
      if (isSeedanceEdit(req)) return textToVideoPricing.opts?.computeCredits?.(body, req)
      if (!isClipPricedV2vProvider(runProvider(req))) return undefined
      const stash = clipOf(req)
      if (!stash) throw new Error("video-to-video: the run reached its pricing without its clip's length")
      return videoToVideoClipBaseCredits(stash.creditId, stash.units)
    },
    beforePricing: videoToVideoClipStep,
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
    const runModel = videoToVideoProviderOf(provider)
    // A model priced by its clip: the length the server read from the clip
    // (never one the request sent) is recorded on the job and the queue
    // payload, and the run reserves the row that length chose. HappyHorse Edit
    // sends the size it is priced at: 720p unless the request names 1080p.
    const clip = isClipPricedV2vProvider(runModel) ? clipOf(req) : undefined
    if (isClipPricedV2vProvider(runModel) && !clip) {
      // Unreachable while the guard's clip step runs first; an invariant, not a user error.
      return sendInternalError(reply, req, new Error("video-to-video: clip length missing"), "Failed to create job")
    }
    const sentResolution = runModel === "happyhorse-edit" ? videoToVideoSentResolution(runModel, resolution) : resolution
    if (runModel === "happyhorse-edit") parsed.data.resolution = sentResolution as typeof parsed.data.resolution
    const clipFields = clip ? { videoDuration: clip.clipSec, videoToVideoBilledSeconds: clip.billedSeconds } : {}

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: withResolvedModel({ ...buildJobInputData(parsed.data, "video-to-video"), ...clipFields }, "video-to-video"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // The row the run reserves: the clip's for a clip-priced model, else the model's own.
    const modelIdentifier = clip ? clip.creditId : runModel
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("video-to-video", {
      jobId: job.id,
      videoUrl,
      prompt: finalPrompt,
      provider: runModel,
      duration,
      resolution: sentResolution,
      audio,
      multiShots,
      aspectRatio,
      seed,
      referenceImageUrl,
      negativePrompt: finalNegativePrompt,
      videoEditDuration,
      audioSetting,
      promptExtend,
      ...clipFields,
      usageLogId,
    }))
    if (reply.sent) return

    return { jobId: job.id }
  })
}
