import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { maybeProxyLlmRouteToCloud } from "../lib/cloud-llm-proxy.js"
import { insertJob } from "../lib/insert-job.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { markJobCompleted } from "../workers/shared.js"
import { markJobFailed } from "../lib/job-failure.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { LLM_FEATURE_DEFAULTS, LLM_MODEL_IDS, buildLlmCreditIdentifier, resolveLlmCreditId } from "@nodaro/shared"
import { llmCompleteStructured, type LlmContentBlock } from "../lib/llm-client.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { sendInternalError } from "../lib/http-errors.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { OVERLAY_ANCHORS } from "../providers/image/overlay.js"

/**
 * "Put it where it doesn't get in the way": a vision LLM looks at the base
 * image and proposes a placement for one layer — an anchor, offsets and a
 * width in the node's own percent units — avoiding faces, the main subject
 * and the platform's unsafe strips. Billed as one image-to-text call; the
 * placement is applied by the canvas, never by the server.
 */
const placementBody = z.object({
  imageUrl: safeUrlSchema,
  /** The layer's width / height (1 = square). Used to keep the box in proportion. */
  layerAspect: z.number().min(0.05).max(20).optional().default(1),
  /** What the layer is, in words — a logo, a headline, a price badge, a QR… */
  intent: z.string().max(300).optional(),
  /** Always-visible region of the canvas as fractions, when a platform preset is active. */
  safeArea: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }).optional(),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
})

export const placementSchema = z.object({
  anchor: z.enum(OVERLAY_ANCHORS),
  x: z.number().min(-100).max(100),
  y: z.number().min(-100).max(100),
  width: z.number().min(1).max(100),
  reason: z.string().max(400),
})
export type SuggestedPlacement = z.infer<typeof placementSchema>

const SYSTEM_PROMPT = `You are an art director placing ONE graphic element (a logo, a headline, a badge, a QR code) on a photo or illustration.
Study the image: where are the faces, the main subject, the busiest textures, the text that is already there? Choose the spot where the element reads clearly and hides nothing important — usually calm, low-detail areas, often near an edge or a corner, balanced against the subject.
Answer with the placement in the compositor's units:
- anchor: one of top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right — the point on the image the element attaches to.
- x, y: offset from that anchor in PERCENT of the image width / height; on a right or bottom anchor a NEGATIVE value moves the element inward (a watermark in the bottom-right corner is anchor bottom-right, x -4, y -6).
- width: the element's width in percent of the image width (a logo 8–18, a headline 40–80, a badge 15–30).
- reason: one short sentence, plain language, saying why this spot.
Keep the element fully inside the image and inside the safe area when one is given.`

const suggestRateLimit = rateLimiter({ windowMs: 60_000, max: 20, keyPrefix: "image-overlay-suggest" })

export async function imageOverlayPlacementRoutes(app: FastifyInstance) {
  app.post(
    "/v1/image-overlay/suggest-placement",
    { preHandler: [suggestRateLimit, creditGuard((req) => resolveLlmCreditId("image-to-text", req.body))] },
    async (req, reply) => {
      // Keyless install with a live connection: the cloud runs the same
      // code, so forward the body and pass its answer straight back.
      if (await maybeProxyLlmRouteToCloud(req, reply, "/v1/image-overlay/suggest-placement", "image-overlay-suggest")) return

      const parsed = placementBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({ error: { code: "provider_unavailable", message: "LLM API key not configured" } })
      }

      const { imageUrl, layerAspect, intent, safeArea } = parsed.data
      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["image-to-text"]
      const modelIdentifier = buildLlmCreditIdentifier("image-to-text", llmModel)

      const { data: job, error: jobError } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData({ imageUrl, layerAspect, intent, safeArea }, "image-overlay-suggest"),
      })
      if (jobError) return sendInternalError(reply, req, jobError, "Failed to create job")

      await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return

      await markProviderCallStart(job.id, "anthropic-sync")

      try {
        // Pre-fetch to base64 so CDNs that block provider IPs still work; the
        // URL passed safeUrlSchema and safeFetch re-checks at connect time.
        let imageBlock: LlmContentBlock = { type: "image", url: imageUrl }
        try {
          const res = await safeFetch(imageUrl, { timeoutMs: 30_000 })
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer())
            const mediaType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim()
            imageBlock = { type: "image_base64", mediaType, data: buf.toString("base64") }
          }
        } catch {
          // fall back to the URL form
        }

        const ask = [
          `Element: ${intent?.trim() || "a logo"}.`,
          `Element proportions: width/height = ${layerAspect.toFixed(2)}.`,
          safeArea ? `Safe area (fractions of the image): x ${safeArea.x.toFixed(2)}, y ${safeArea.y.toFixed(2)}, w ${safeArea.w.toFixed(2)}, h ${safeArea.h.toFixed(2)}. Keep the element inside it.` : "",
          "Where should it go?",
        ].filter(Boolean).join("\n")

        const result = await llmCompleteStructured(
          {
            modelId: llmModel,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: [imageBlock, { type: "text", text: ask }] }],
            maxTokens: 400,
          },
          placementSchema,
          { schemaName: "placement" },
        )
        const placement = result.output

        // Text/JSON result, no media — but it still goes through the completion
        // funnel so the CAS, the result gate and the credit commit stay one path.
        const completed = await markJobCompleted(job.id, {
          output_data: { placement, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens } },
          provider_cost: result.providerCost ?? null,
        })
        if (completed) await commitReservedCreditsForJob(job.id)

        return reply.send({ jobId: job.id, placement })
      } catch (err) {
        const message = err instanceof Error ? err.message : "LLM call failed"
        if (await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message } } })) {
          await refundReservedCreditsForJob(job.id)
        }
        return reply.status(502).send({ error: { code: "llm_error", message: "Could not suggest a placement" } })
      }
    },
  )
}
