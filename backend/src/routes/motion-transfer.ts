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
 * - videoDuration: accepted for older clients and never read (decided
 *   2026-11-18): the driving video is measured by the server before anything
 *   is held (`motionTransferMeasureStep`), and the job records that length.
 *
 * Pricing (`motionTransferPrice`, @nodaro/shared): Kling 3.0 at 720p is charged
 * per second of the measured video at its four-second row (the hold is the
 * charge); every other model and size by its tier (Kling) or its size row
 * (Wan Animate), read from the measured length. A video shorter than 3 s, past
 * the model's limit, or unreadable is refused with nothing held.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
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
import { motionTransferResolution } from "@nodaro/shared/credits"
import { formatZodError } from "../lib/zod-error.js"
import { jobRunModel } from "../lib/run-model.js"
import { withAdjustments } from "../lib/image-gen-normalize.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { measureMotionTransferInput } from "../lib/motion-transfer-input.js"
import { unitRateBaseCredits } from "../lib/credit-base-cost.js"
import { dropClientMeasureFields, requestMeasure, setRequestMeasure } from "../lib/request-measure.js"
import { ROUTE_MEASURE_DEADLINE_MS } from "../lib/pre-charge-probe-bounds.js"
import { probeRefusalStatus } from "../providers/video/probe-guard.js"

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
  // Accepted for older clients and never read (decided 2026-11-18): the run is
  // priced on the driving video's length as the server measures it.
  videoDuration: z.number().min(1).max(60).optional(),
})

/** Body fields named like the measure: dropped from every request, never read. */
const CLIENT_MEASURE_FIELDS: readonly string[] = ["__motionTransferMeasure", "motionTransferBilledSeconds"]
/** The request measure the measuring step keeps, server-side only, for the guard's pricing and the handler. */
const MEASURE = "motionTransfer"
/** What the measuring step measured: the driving video's length, the seconds held, and the row and units priced. */
interface MotionTransferStash {
  readonly measuredSec: number
  readonly billedSeconds: number
  readonly creditId: string
  readonly units?: number
}

/** What the measuring step measured for this request (the server-side request's, never the body's). */
function measureOf(req: FastifyRequest): MotionTransferStash | undefined {
  return requestMeasure<MotionTransferStash>(req, MEASURE)
}

/**
 * The credit guard's `beforePricing` step: past the guard's model and node
 * doors, the app-token scope gate and the Idempotency-Key dedup (so a model
 * the deployment withholds never costs a download), validate the body with the
 * handler's own schema, measure the driving video (`measureMotionTransferInput`,
 * the rule the workflow run shares), refuse what the model cannot take with
 * nothing held, and keep the measure on the server-side request. A length the
 * request sent (`videoDuration`) is dropped here: nothing the guard runs can
 * read it.
 */
export async function motionTransferMeasureStep(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  dropClientMeasureFields(req.body, CLIENT_MEASURE_FIELDS)
  const parsed = motionTransferBody.safeParse(req.body)
  if (!parsed.success) {
    return void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  const body = req.body as Record<string, unknown>
  // The guard's model deny reads the RAW `body.provider`: write the resolved one back so an omitted provider is judged as the model it runs.
  body.provider = parsed.data.provider
  const { provider, resolution, characterOrientation, videoUrl } = parsed.data
  const measured = await measureMotionTransferInput({ provider, resolution, characterOrientation }, videoUrl, (err) => {
    req.log.warn({ err }, "motion-transfer: ffprobe failed; refusing the run")
  }, { deadlineAt: Date.now() + ROUTE_MEASURE_DEADLINE_MS })
  if (!measured.ok) {
    return void reply.status(probeRefusalStatus(measured.code)).send({ error: { code: measured.code, message: measured.message } })
  }
  setRequestMeasure(req, MEASURE, {
    measuredSec: measured.measuredSec,
    billedSeconds: measured.billedSeconds,
    creditId: measured.creditId,
    ...(measured.units !== undefined ? { units: measured.units } : {}),
  } satisfies MotionTransferStash)
  delete body.videoDuration
}

/** The row the run reserves: the measured one; the throw only covers a body the measuring step already refused. */
function motionTransferCreditId(req: FastifyRequest): string {
  const stash = measureOf(req)
  if (!stash) throw new Error("motion-transfer: the run reached its pricing without its measured video")
  return stash.creditId
}

/**
 * BASE credits for a run charged at a per-second rate (Kling 3.0 at 720p): its
 * four-second row × the billed seconds ÷ 4, rounded up once; undefined for a
 * run priced by a tier row, which the guard prices from that row.
 */
export async function motionTransferComputeCredits(_body: unknown, req: FastifyRequest): Promise<number | undefined> {
  const stash = measureOf(req)
  if (!stash) throw new Error("motion-transfer: the run reached its pricing without its measured video")
  return stash.units === undefined ? undefined : unitRateBaseCredits(stash.creditId, stash.units)
}

export async function motionTransferRoutes(app: FastifyInstance) {
  app.post("/v1/motion-transfer", {
    // The driving video is measured inside the guard (`beforePricing`), after its model and node doors.
    preHandler: creditGuard(motionTransferCreditId, {
      runModel: jobRunModel("motion-transfer"),
      computeCredits: motionTransferComputeCredits,
      beforePricing: motionTransferMeasureStep,
    }),
  }, async (req, reply) => {
    const parsed = motionTransferBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { imageUrl, videoUrl, prompt, negativePrompt, characterOrientation, provider, backgroundSource } = parsed.data
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

    // The measured length, never one the request sent: the job records it, and
    // the seconds it is held and charged for ride the row and the queue payload.
    const stash = measureOf(req)
    if (!stash) {
      // Unreachable while the measuring step runs first; an invariant, not a user error.
      return sendInternalError(reply, req, new Error("motion-transfer: measure missing"), "Failed to transfer motion")
    }
    parsed.data.videoDuration = stash.measuredSec
    const modelIdentifier = stash.creditId
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: withResolvedModel({
          ...buildJobInputData(parsed.data, "motion-transfer"),
          motionTransferBilledSeconds: stash.billedSeconds,
        }, "motion-transfer"),
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
      videoDuration: stash.measuredSec,
      motionTransferBilledSeconds: stash.billedSeconds,
      usageLogId,
    }))
    if (reply.sent) return

    return withAdjustments({ jobId: job.id }, sized.adjustments)
  })
}
