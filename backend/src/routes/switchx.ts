import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { probeVideoFrames } from "../lib/ffprobe-frames.js"
import { resolveSwitchXCreditId } from "@nodaro/shared"

/**
 * Beeble SwitchX hard input limits. The provider rejects sources beyond these,
 * so we fail fast with a friendly 400 instead of reserving credits + queueing a
 * job that the worker would only kill after download. `MAX_FRAMES` also bounds
 * the credit-reserve tier (see resolveSwitchXCreditId).
 */
const MAX_FRAMES = 240
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
 * On a SUCCESSFUL probe we enforce both hard limits — a clean probe that
 * reports >240 frames (or >2.77 Mpx) is rejected here, never allowed to slip
 * through to a doomed worker run.
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
    if (frames > MAX_FRAMES) {
      return void reply.status(400).send({
        error: {
          code: "VIDEO_TOO_MANY_FRAMES",
          message: `Source has ${frames} frames (max ${MAX_FRAMES}). Trim it first.`,
        },
      })
    }
    if (width * height > MAX_PIXELS) {
      return void reply.status(400).send({
        error: {
          code: "SOURCE_TOO_LARGE",
          message: `Source is ${width}×${height} (${width * height} px, max ${MAX_PIXELS}). Use a lower resolution.`,
        },
      })
    }
    body.__probedFrameCount = frames
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
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
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
        usageLogId,
      })

      return { jobId: job.id }
    },
  )
}
