import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { sendInternalError } from "../lib/http-errors.js"
import { insertJob } from "../lib/insert-job.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob, type RoutePricing } from "../middleware/credit-guard.js"
import { dropClientMeasureFields, requestMeasure, setRequestMeasure } from "../lib/request-measure.js"
import { SWITCHX_PROBED_FIELD, SWITCHX_TRIM_FIELD, switchXCreditIdOf } from "../lib/probed-credit-ids.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { probeVideoFrames, exactFrameCount } from "../lib/ffprobe-frames.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"

/**
 * Beeble SwitchX hard input limits. The provider rejects sources beyond these,
 * so we fail fast with a friendly 400 instead of reserving credits + queueing a
 * job that the worker would only kill after download. `MAX_FRAMES` also bounds
 * the credit-reserve tier (see resolveSwitchXCreditId).
 */
const MAX_FRAMES = 240
// Sources up to this many frames are auto-trimmed down to MAX_FRAMES (a ≤~1s
// overage; 270 = 240 + 30). Beyond it we reject so a long clip isn't silently
// butchered down to the first 8 seconds.
const AUTO_TRIM_MAX = 270
const MAX_PIXELS = 2_770_000

export const switchXBody = z
  .object({
    videoUrl: safeUrlSchema,
    referenceImageUrl: safeUrlSchema.optional(),
    prompt: z.string().max(2000).optional(),
    alphaMode: z.enum(["auto", "fill", "select", "custom"]),
    maskUrl: safeUrlSchema.optional(),
    alphaKeyframeIndex: z.number().int().min(0).optional(),
    maxResolution: z.union([z.literal(720), z.literal(1080)]).default(1080),
    seed: z.number().int().min(0).max(4294967295).optional(),
    userId: z.string().uuid().optional(),
  })
  // At least one style driver — a text prompt OR a reference image.
  .refine((b) => Boolean(b.prompt) || Boolean(b.referenceImageUrl), {
    message: "MISSING_STYLE_INPUT",
  })
  // select/custom alpha need a user-supplied mask; auto/fill derive it.
  .refine((b) => !(b.alphaMode === "select" || b.alphaMode === "custom") || Boolean(b.maskUrl), {
    message: "MISSING_ALPHA",
  })

/** Refine sentinels that map to their own top-level error codes (not the
 *  generic validation_error) so the client can branch on the exact failure. */
const REFINE_CODES = new Set(["MISSING_STYLE_INPUT", "MISSING_ALPHA"])

/** What the preflight measured, kept on the server-side request (`lib/request-measure.ts`), never the body. */
export interface SwitchXMeasure {
  /** The frame count the reserve is bucketed by. */
  readonly frames: number
  /** Set for a small overage of the frame cap: the worker trims the source to this many frames. */
  readonly trimSourceToFrames?: number
}
const MEASURE = "switchx"

/** What this request's preflight measured, or `undefined` when it measured nothing (no url: the handler's Zod answers). */
export function measuredSwitchX(req: FastifyRequest): SwitchXMeasure | undefined {
  return requestMeasure<SwitchXMeasure>(req, MEASURE)
}

/** The credit id the guard and the reservation hold: the body's settings and the frame count the server probed (`switchXCreditIdOf`). */
const switchXCreditIdOfRequest = (req: FastifyRequest): string =>
  switchXCreditIdOf(req.body as Record<string, unknown> | undefined, measuredSwitchX(req)?.frames)

/**
 * Fastify preHandler: ffprobe the source video, reject oversize inputs, and
 * keep the frame count on the server-side request (`measuredSwitchX`) — never
 * the body, whose `__probedFrameCount` / `__trimSourceToFrames` (a client
 * could send either) are dropped first. This MUST run BEFORE the creditGuard
 * preHandler so the credit id buckets the reserve by the ACTUAL frame count.
 *
 * On a SUCCESSFUL probe we enforce both caps. A clip just over the frame cap
 * (≤270 after an exact-count confirm) is flagged (`trimSourceToFrames`) for
 * the worker to trim to 240; a larger frame count, or >2.77 Mpx, is rejected
 * here. A cheap over-estimate that an exact decode shows is really ≤240 passes
 * through untouched (no trim).
 *
 * On probe FAILURE we cannot reject (no data to reject on — Beeble will), so we
 * record the worst-case `MAX_FRAMES` so the reserve holds the top tier rather
 * than under-reserving. The probe is SSRF-guarded inside probeVideoFrames.
 */
export async function switchXPreflight(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  dropClientMeasureFields(req.body, [SWITCHX_PROBED_FIELD, SWITCHX_TRIM_FIELD])
  const record = (m: SwitchXMeasure) => setRequestMeasure(req, MEASURE, m)
  const body = (req.body ?? {}) as Record<string, unknown>
  const url = body.videoUrl
  // A link the run refuses (the body's own `safeUrlSchema`) is never probed: its handler, or the quote, answers it with the 400.
  if (typeof url !== "string" || !safeUrlSchema.safeParse(url).success) return
  try {
    const { frames, width, height } = await probeVideoFrames(url)
    // Pixel cap is a hard reject — frame-trimming can't shrink an oversize frame.
    // Check it FIRST so a doomed clip never pays for the exact-frame decode below.
    if (width * height > MAX_PIXELS) {
      return void reply.status(400).send({
        error: {
          code: "SOURCE_TOO_LARGE",
          message: `Source is ${width}×${height} (${width * height} px, max ${MAX_PIXELS}). Use a lower resolution.`,
        },
      })
    }
    if (frames <= MAX_FRAMES) {
      record({ frames })
      return
    }
    // Over the frame cap. The cheap nb_frames/duration×fps estimate can be ±1 at
    // the boundary, so for a clip in (or just past) the auto-trim zone, confirm
    // with an exact decode — avoids trimming a clip that's really ≤240 AND avoids
    // falsely rejecting one. Skip the decode for clips far over (clearly long).
    let real = frames
    if (frames <= AUTO_TRIM_MAX + 30) {
      const exact = await exactFrameCount(url).catch(() => undefined)
      if (exact !== undefined) real = exact
    }
    if (real <= MAX_FRAMES) {
      record({ frames: real }) // estimate over-counted — proceed, no trim
    } else if (real <= AUTO_TRIM_MAX) {
      // Small overage: the worker trims the source to MAX_FRAMES before Beeble.
      // Bill the 240-frame tier (what actually gets relit).
      record({ frames: MAX_FRAMES, trimSourceToFrames: MAX_FRAMES })
    } else {
      return void reply.status(400).send({
        error: {
          code: "VIDEO_TOO_MANY_FRAMES",
          message: `Source has ${real} frames (max ${MAX_FRAMES}). Trim it first.`,
        },
      })
    }
  } catch (err) {
    // Non-fatal: we can't reject without dimensions, so reserve the worst-case
    // top tier. Beeble enforces the real limit on its side.
    req.log.warn({ err }, "switchx: ffprobe failed; reserving worst-case 240-frame tier")
    record({ frames: MAX_FRAMES })
  }
}

/**
 * The route's pricing chain, registered below as its preHandlers and run by
 * `POST /v1/quote` on the same body: the preflight measures the clip's frames
 * (the worst-case 240-frame tier when it cannot), then the tier's id at the
 * node's frame size (`switchXCreditIdOfRequest`).
 */
export const switchXPricing: RoutePricing = {
  prechecks: [switchXPreflight],
  modelResolver: (req) => switchXCreditIdOfRequest(req),
}

export async function switchXRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/switchx",
    {
      // Order matters: the preflight records the frame count on the request so
      // the creditGuard's credit id can bucket the reserve by the ACTUAL frame
      // count. The probe MUST run first.
      preHandler: [...switchXPricing.prechecks, creditGuard(switchXPricing.modelResolver, switchXPricing.opts)],
    },
    async (req, reply) => {
      const parsed = switchXBody.safeParse(req.body)
      if (!parsed.success) {
        const firstMessage = parsed.error.issues[0]?.message
        const code = firstMessage && REFINE_CODES.has(firstMessage) ? firstMessage : "validation_error"
        return reply.status(400).send({
          error:
            code === "validation_error"
              ? { code, ...formatZodError(parsed.error) }
              : { code, message: firstMessage as string },
        })
      }

      const {
        videoUrl,
        referenceImageUrl,
        prompt,
        alphaMode,
        maskUrl,
        alphaKeyframeIndex,
        maxResolution,
        seed,
      } = parsed.data

      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      // B4b: deployment prompt policy at this route's assembly point — only
      // when a prompt exists (a promptless relight must not gain a policy
      // clause as its entire prompt). Mirrored into parsed.data so input_data
      // persists the policed text. No policy registered = identity.
      const finalPrompt = prompt
        ? applyPromptPolicies({ prompt, negativePrompt: "", kind: "video" }).prompt
        : prompt
      parsed.data.prompt = finalPrompt

      const mcpClient = extractMcpClient(req.body)
      const { data: job, error } = await insertJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "switchx"),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })

      if (error) {
        return sendInternalError(reply, req, error, "Failed to process video")
      }

      // The same id the creditGuard checked: the body's settings and the frame
      // count the preflight probed (never one the body carries).
      const modelId = switchXCreditIdOfRequest(req)

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelId)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("switchx", {
        jobId: job.id,
        videoUrl,
        referenceImageUrl,
        prompt: finalPrompt,
        alphaMode,
        maskUrl,
        alphaKeyframeIndex,
        maxResolution,
        seed,
        // Set by the preflight when the source is a small overage of the frame
        // cap — the worker trims it to this many frames before submitting.
        trimSourceToFrames: measuredSwitchX(req)?.trimSourceToFrames,
        usageLogId,
      }))
      if (reply.sent) return

      return { jobId: job.id }
    },
  )
}
