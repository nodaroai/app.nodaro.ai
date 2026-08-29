import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { resolveCollageGeometry, toCssColor } from "../providers/image/collage.js"
import { normalizeCollageLabels } from "../providers/image/collage-badges.js"

export const imageCollageBody = z.object({
  imageUrls: z
    .array(safeUrlSchema)
    .min(2, "At least 2 images required")
    .max(30, "At most 30 images"),
  layout: z.enum(["smart", "grid"]).optional().default("smart"),
  /**
   * Per-image size hints, index-aligned with `imageUrls`: 0 = auto ("don't
   * care"), 1 = big, 2 = medium, 3 = small. RELATIVE hints for the smart
   * layout's row packing (grid cells stay uniform by design). A shorter array
   * pads with auto; extra entries are ignored.
   */
  imageSizes: z
    .array(z.number().int().min(0).max(3))
    .max(30, "At most 30 size hints")
    .optional(),
  /**
   * Storyboard mode: stamp a 1-based sequence number (in `imageUrls` order) at
   * each image's top-right. NO default on purpose — an absent value stays
   * absent in the persisted `input_data` (a stamped `false` would surface as a
   * real "Numbered: off" setting in the client's result panel).
   */
  numbered: z.boolean().optional(),
  /**
   * Per-image captions, index-aligned with `imageUrls`, shown after the number
   * (or alone, e.g. `3 · Close-up`). `null`/"" = none. A shorter array pads
   * with none and extra entries are ignored (same tolerance as `imageSizes`),
   * so no length-must-equal constraint here.
   */
  imageLabels: z
    .array(z.string().max(80).nullable())
    .max(30, "At most 30 labels")
    .optional(),
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
  /**
   * Character Studio auto-attach (identity boards): when all three of
   * attachToCharacterId/attachToColumn/attachName are present, the worker
   * appends the finished collage to the character row server-side (same
   * pattern as generate-character-asset), so closing the studio mid-
   * generation never orphans the board. `boards` is the only valid target
   * from this route; `sourceImages` are the request's own imageUrls.
   */
  attachToCharacterId: z.string().uuid().optional(),
  attachToColumn: z.literal("boards").optional(),
  attachName: z.string().max(200).optional(),
  attachBoardType: z.enum(["looks", "identity"]).optional(),
  userId: z.string().uuid().optional(),
})

/**
 * The free layout preview.
 *
 * Deliberately NOT a subset of `imageCollageBody`: that object carries
 * `imageUrls` (min 2 / max 30), which this route has no use for — it is handed
 * DIMENSIONS the client already read from the images it is showing. The bounds
 * that matter are re-declared here rather than inherited.
 */
export const collageLayoutBody = z.object({
  /**
   * Displayed pixel dimensions, in the same order as the `imageUrls` the render
   * will receive. Min 2 because below that there is no collage at all, and
   * because `computeCollageLayout` throws on an empty array — which would be a
   * 500 rather than a 400. Bounded above so a hostile body cannot make the
   * layout iterate unboundedly.
   */
  dims: z
    .array(z.object({ w: z.number().int().positive().max(30000), h: z.number().int().positive().max(30000) }))
    .min(2, "At least 2 images required")
    .max(30, "At most 30 images"),
  imageSizes: z.array(z.number().int().min(0).max(3)).max(30, "At most 30 size hints").optional(),
  layout: z.enum(["smart", "grid"]).optional().default("smart"),
  /**
   * REQUIRED, unlike its sibling. The render's own default is 2K while this
   * route's family defaults 4K, and a preview built against the wrong canvas is
   * exact for a picture nobody is going to get. Making the caller say which one
   * removes the trap instead of documenting it.
   */
  resolution: z.enum(["2K", "4K"]),
  aspectRatio: z
    .string()
    .regex(/^([1-9]\d?):([1-9]\d?)$/, "Expected a W:H ratio like 4:3")
    .optional()
    .default("4:3"),
  gap: z.number().int().min(0).max(200).optional().default(24),
  backgroundColor: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, "Expected a #RRGGBB hex color")
    .optional()
    .default("#ffffff"),
})

/**
 * This route is FREE, and free is why it needs its own limit.
 *
 * Every other write path on this service is throttled by `creditGuard` — credit
 * reservation, the storage 413 and the daily cap all live inside it — and the
 * rate-limit plugin is registered `global: false`, so a route that declares
 * nothing has nothing. The client debounces; this is the backstop for a client
 * that does not.
 */
const layoutRateLimit = rateLimiter({ windowMs: 60_000, max: 60, keyPrefix: "collage-layout" })

/** BASE credits (pre-markup) by output resolution. 4K costs more compute. */
function estimateImageCollageCredits(resolution: unknown): number {
  return resolution === "4K" ? 4 : 2
}

export async function imageCollageRoutes(app: FastifyInstance) {
  /**
   * Pure compute: no job, no queue, no credits, no storage. Answers "where
   * would each of these images land" using the SAME function the renderer
   * calls, so a client can draw an exact preview instead of approximating one.
   *
   * Geometry is exact GIVEN THE SAME DIMENSIONS. Acquiring those dimensions is
   * the residual risk and is not closeable here: the render probes the
   * downloaded file, the caller reads the browser, and the two can disagree if
   * the object changes in between. Taking `imageUrls` and probing would be
   * exact by construction, at a download per keystroke — rejected.
   */
  app.post(
    "/v1/image-collage/layout",
    { preHandler: [layoutRateLimit] },
    async (req, reply) => {
      const parsed = collageLayoutBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }
      if (!req.userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const { dims, imageSizes, layout, resolution, aspectRatio, gap, backgroundColor } = parsed.data
      try {
        const { rects, canvasW, canvasH } = resolveCollageGeometry({
          dims,
          layout,
          resolution,
          aspectRatio,
          gap,
          imageSizes,
        })
        // `canvasW` is returned rather than assumed: the smart layout floats the
        // height and the clamp can rescale the width below the nominal target,
        // so the caller's scale factor has to come from here.
        return reply.send({ rects, canvasW, canvasH, backgroundColor: toCssColor(backgroundColor) })
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to compute collage layout")
      }
    },
  )

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

      const { imageUrls, imageSizes, numbered, imageLabels: rawImageLabels, layout, resolution, aspectRatio, gap, backgroundColor, attachToCharacterId, attachToColumn, attachName, attachBoardType, ...restBody } = parsed.data
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      // Sanitize captions HERE, before anything is persisted: the array goes
      // into jobs.input_data (JSONB), and Postgres rejects a `\u0000` outright —
      // so an unsanitized NUL in a caption would 500 job creation rather than
      // render. Same sanitizer the renderer and the workflow-run path use, so
      // what is stored is exactly what gets drawn; all-empty → key omitted.
      const imageLabels = normalizeCollageLabels(rawImageLabels)

      const modelIdentifier = "image-collage"

      const mcpClient = extractMcpClient(req.body)
      const { data: job, error } = await insertJob(req, {
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(
            {
              ...restBody,
              imageUrls,
              imageSizes,
              numbered,
              layout,
              resolution,
              aspectRatio,
              gap,
              backgroundColor,
              attachToCharacterId,
              attachToColumn,
              attachName,
              attachBoardType,
              ...(imageLabels ? { imageLabels } : {}),
            },
            "image-collage",
          ),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })

      if (error) {
        return sendInternalError(reply, req, error, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("image-collage", {
        jobId: job.id,
        imageUrls,
        imageSizes,
        ...(numbered !== undefined ? { numbered } : {}),
        ...(imageLabels ? { imageLabels } : {}),
        layout,
        resolution,
        aspectRatio,
        gap,
        backgroundColor,
        attachToCharacterId,
        attachToColumn,
        attachName,
        attachBoardType,
        usageLogId,
      })

      return { jobId: job.id }
    },
  )
}
