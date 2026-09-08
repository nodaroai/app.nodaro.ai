import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import {
  OVERLAY_LAYER_KINDS,
  overlayTextStyleSchema,
  overlayQrStyleSchema,
  overlayShapeStyleSchema,
  overlayImageEffectsSchema,
  OVERLAY_PLATFORM_IDS,
  OVERLAY_MAX_VARIANTS, imageOverlayCredits } from "@nodaro/shared"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import {
  OVERLAY_ANCHORS,
  OVERLAY_BLENDS,
  OVERLAY_FITS,
  OVERLAY_MAX_LAYERS,
} from "../providers/image/overlay.js"

const hex6 = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB color")

/**
 * One layer of the composite. Every position/size is a PERCENTAGE of the base
 * image (x/width of its width, y/height of its height) so the same node works
 * on a 1K preview and a 4K render — the base's pixel size is decided upstream.
 * A negative x on a right anchor (or y on a bottom anchor) moves the layer
 * INWARD, which is the watermark case.
 */
export const overlayLayerSchema = z.object({
  /** What the layer is. Default "image" — the wired picture. */
  kind: z.enum(OVERLAY_LAYER_KINDS).optional().default("image"),
  /** Required for kind "image". */
  imageUrl: safeUrlSchema.optional(),
  text: overlayTextStyleSchema.optional(),
  qr: overlayQrStyleSchema.optional(),
  shape: overlayShapeStyleSchema.optional(),
  effects: overlayImageEffectsSchema.optional(),
  anchor: z.enum(OVERLAY_ANCHORS).optional().default("center"),
  x: z.number().min(-100).max(100).optional().default(0),
  y: z.number().min(-100).max(100).optional().default(0),
  width: z.number().min(1).max(100).optional().default(25),
  height: z.number().min(1).max(100).optional(),
  opacity: z.number().min(0).max(1).optional().default(1),
  rotation: z.number().min(-180).max(180).optional().default(0),
  blend: z.enum(OVERLAY_BLENDS).optional().default("over"),
  fit: z.enum(OVERLAY_FITS).optional().default("contain"),
  shadow: z
    .object({
      blur: z.number().min(0).max(200),
      offsetX: z.number().min(-200).max(200),
      offsetY: z.number().min(-200).max(200),
      color: hex6,
      opacity: z.number().min(0).max(1),
    })
    .optional(),
  roundedCorners: z.number().int().min(0).max(500).optional(),
  /** Render order — higher draws on top; absent = array order. */
  zIndex: z.number().int().min(0).max(100).optional(),
}).superRefine((layer, ctx) => {
  const need = (field: "imageUrl" | "text" | "qr" | "shape") => {
    if (layer[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: `A "${layer.kind}" layer needs ${field}` })
  }
  if (layer.kind === "image") need("imageUrl")
  if (layer.kind === "text") need("text")
  if (layer.kind === "qr") need("qr")
  if (layer.kind === "shape") need("shape")
})

export const imageOverlayBody = z.object({
  imageUrl: safeUrlSchema,
  layers: z
    .array(overlayLayerSchema)
    .min(1, "At least 1 overlay layer required")
    .max(OVERLAY_MAX_LAYERS, `At most ${OVERLAY_MAX_LAYERS} overlay layers`),
  /** Optional output canvas. Without it the output keeps the base's pixel size. */
  canvas: z
    .object({
      width: z.number().int().min(16).max(8192),
      height: z.number().int().min(16).max(8192),
      backgroundColor: hex6.optional().default("#000000"),
    })
    .optional(),
  baseFit: z.enum(["contain", "cover"]).optional().default("contain"),
  outputFormat: z.enum(["png", "jpg", "webp"]).optional().default("png"),
  /** Extra platform renders of the same composite (OVERLAY_PLATFORMS ids). */
  variants: z.array(z.enum(OVERLAY_PLATFORM_IDS)).max(OVERLAY_MAX_VARIANTS).optional(),
  /** The mask the job also emits (white = may change). Default "around" — the ring an AI finish may repaint. */
  maskMode: z.enum(["none", "layers", "around", "outside"]).optional().default("around"),
  /** Ring width for "around", px on the base. */
  maskSpread: z.number().int().min(1).max(400).optional().default(48),
  /** Text from the node's QR link handle — fills every QR layer with `qr.fromInput`. */
  qrText: z.string().max(2000).optional(),
}).superRefine((body, ctx) => {
  const wired = (body.qrText ?? "").trim().length > 0
  body.layers.forEach((layer, i) => {
    if (layer.kind !== "qr" || !layer.qr) return
    if (layer.qr.fromInput ? !wired : !layer.qr.text.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["layers", i, "qr", "text"],
        message: layer.qr.fromInput ? "This QR layer reads its link from the QR link handle — connect a text output to it" : "A QR layer needs a link or text",
      })
    }
  })
})

export type ImageOverlayBody = z.infer<typeof imageOverlayBody>

/** Local compute at a flat price — a burst limiter keeps one user from parking
 *  the shared ffmpeg slots behind a queue of 8K composites. */
const overlayRateLimit = rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: "image-overlay" })

export async function imageOverlayRoutes(app: FastifyInstance) {
  app.post(
    "/v1/image-overlay",
    {
      preHandler: [
        overlayRateLimit,
        // Base + 2 per extra platform render — the same formula the
        // orchestrator reserves (node-executor) and the canvas quotes.
        creditGuard(() => "image-overlay", { computeCredits: (body) => imageOverlayCredits((body as { variants?: unknown[] })?.variants) }),
      ],
    },
    async (req, reply) => {
      const parsed = imageOverlayBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { imageUrl, layers, canvas, baseFit, outputFormat, variants, maskMode, maskSpread, qrText, ...restBody } = parsed.data
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const modelIdentifier = "image-overlay"
      const mcpClient = extractMcpClient(req.body)
      const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(
          { ...restBody, imageUrl, layers, canvas, baseFit, outputFormat, maskMode, maskSpread, ...(variants?.length ? { variants } : {}), ...(qrText ? { qrText } : {}) },
          "image-overlay",
        ),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

      if (error) {
        return sendInternalError(reply, req, error, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("image-overlay", {
        jobId: job.id,
        imageUrl,
        layers,
        canvas,
        baseFit,
        outputFormat,
        ...(variants?.length ? { variants } : {}),
        maskMode,
        maskSpread,
        ...(qrText ? { qrText } : {}),
        usageLogId,
      })

      return { jobId: job.id }
    },
  )
}
