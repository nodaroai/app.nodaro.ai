import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { sendInternalError } from "../lib/http-errors.js"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { probeVideoFrames, exactFrameCount } from "../lib/ffprobe-frames.js"
import { resolveSwitchXCreditId } from "@nodaro/shared"

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

const switchXBody = z
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

/**
 * Fastify preHandler: ffprobe the source video, reject oversize inputs, and
 * stash the frame count on the RAW body as `__probedFrameCount`. This MUST run
 * BEFORE the creditGuard preHandler so `resolveSwitchXCreditId` (which reads the
 * raw body) buckets the credit reserve by the ACTUAL frame count.
 *
 * On a SUCCESSFUL probe we enforce both caps. A clip just over the frame cap
 * (≤270 after an exact-count confirm) is flagged via `__trimSourceToFrames` for
 * the worker to trim to 240; a larger frame count, or >2.77 Mpx, is rejected
 * here. A cheap over-estimate that an exact decode shows is really ≤240 passes
 * through untouched (no trim).
 *
 * On probe FAILURE we cannot reject (no data to reject on — Beeble will), so we
 * stash the worst-case `MAX_FRAMES` so the reserve holds the top tier rather
 * than under-reserving. The probe is SSRF-guarded inside probeVideoFrames.
 */
export async function switchXPreflight(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const url = body.videoUrl
  if (typeof url !== "string" || url.length === 0) return // Zod will 400 on the missing/invalid url
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
      body.__probedFrameCount = frames
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
      body.__probedFrameCount = real // estimate over-counted — proceed, no trim
    } else if (real <= AUTO_TRIM_MAX) {
      // Small overage: the worker trims the source to MAX_FRAMES before Beeble.
      // Bill the 240-frame tier (what actually gets relit).
      body.__trimSourceToFrames = MAX_FRAMES
      body.__probedFrameCount = MAX_FRAMES
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
    body.__probedFrameCount = MAX_FRAMES
  }
}

export async function switchXRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/switchx",
    {
      // Order matters: the preflight stashes __probedFrameCount on the raw body
      // so the creditGuard's resolveSwitchXCreditId can bucket the reserve by
      // the ACTUAL frame count. The probe MUST run first.
      preHandler: [
        switchXPreflight,
        creditGuard((req) => resolveSwitchXCreditId((req.body ?? {}) as Record<string, unknown>)),
      ],
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

      const mcpClient = extractMcpClient(req.body)
      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "switchx"),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })
        .select("id")
        .single()

      if (error) {
        return sendInternalError(reply, req, error, "Failed to process video")
      }

      // Resolve from the RAW body (not parsed.data) so the reserve matches the
      // creditGuard check: Zod strips the preHandler-stashed __probedFrameCount,
      // so resolving from parsed.data would lose the frame-tier bucket and fall
      // back to the worst-case 240f tier — a mismatch with the preHandler's
      // affordance check. The raw body retains __probedFrameCount.
      const modelId = resolveSwitchXCreditId((req.body ?? {}) as Record<string, unknown>)

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelId)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("switchx", {
        jobId: job.id,
        videoUrl,
        referenceImageUrl,
        prompt,
        alphaMode,
        maskUrl,
        alphaKeyframeIndex,
        maxResolution,
        seed,
        // Set by the preflight when the source is a small overage of the frame
        // cap — the worker trims it to this many frames before submitting.
        trimSourceToFrames: (req.body as Record<string, unknown>).__trimSourceToFrames as number | undefined,
        usageLogId,
      })

      return { jobId: job.id }
    },
  )
}
