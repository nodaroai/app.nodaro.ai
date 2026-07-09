import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

const imageCollageBody = z.object({
  imageUrls: z
    .array(safeUrlSchema)
    .min(2, "At least 2 images required")
    .max(30, "At most 30 images"),
  layout: z.enum(["smart", "grid"]).optional().default("smart"),
  resolution: z.enum(["2K", "4K"]).optional().default("4K"),
  // Any "W:H" (1–2 digits each). Parsed generically by resolveCollageCanvas, so
  // new frontend ratios need no route change (no enum to keep in sync).
  aspectRatio: z
    .string()
    .regex(/^([1-9]\d?):([1-9]\d?)$/, "Expected a W:H ratio like 4:3")
    .optional()
    .default("4:3"),
  /** Gap between cells + outer margin, in px on the output canvas. */
  gap: z.number().int().min(0).max(200).optional().default(24),
  /** "#RRGGBB" hex; the '#' is optional. Shown in the gaps. */
  backgroundColor: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, "Expected a #RRGGBB hex color")
    .optional()
    .default("#ffffff"),
  userId: z.string().uuid().optional(),
})

/** BASE credits (pre-markup) by output resolution. 4K costs more compute. */
function estimateImageCollageCredits(resolution: unknown): number {
  return resolution === "4K" ? 4 : 2
}

export async function imageCollageRoutes(app: FastifyInstance) {
  app.post(
    "/v1/image-collage",
    {
      preHandler: creditGuard(() => "image-collage", {
        computeCredits: (body) =>
          estimateImageCollageCredits((body as Record<string, unknown>).resolution),
      }),
    },
    async (req, reply) => {
      const parsed = imageCollageBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { imageUrls, layout, resolution, aspectRatio, gap, backgroundColor } = parsed.data
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const modelIdentifier = "image-collage"

      const mcpClient = extractMcpClient(req.body)
      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "image-collage"),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })
        .select("id")
        .single()

      if (error) {
        return sendInternalError(reply, req, error, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("image-collage", {
        jobId: job.id,
        imageUrls,
        layout,
        resolution,
        aspectRatio,
        gap,
        backgroundColor,
        usageLogId,
      })

      return { jobId: job.id }
    },
  )
}
