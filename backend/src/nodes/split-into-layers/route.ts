import { z } from "zod"
import { LAYER_SPLIT_MAX_LAYERS, LAYER_SPLIT_PROMPT_MAX, layerSplitHoldCreditId, layerSplitMaxLayers, layerSplitPrompt, layerSplitSize } from "@nodaro/render-rules"
import type { UnitRoute } from "../kit.js"
import { safeUrlSchema } from "../../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../../lib/request-helpers.js"
import { extractMcpClient } from "../../lib/extract-mcp-client.js"
import { buildJobInputData } from "../../lib/job-input-data.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { insertJob } from "../../lib/insert-job.js"
import { videoQueue } from "../../lib/queue.js"
import { LAYER_DECOMPOSITION_MODEL_KEY } from "../../providers/kie/models.js"
import { descriptor } from "./descriptor.generated.js"

/** The sizes the node declares (its `size` app field's options, unit.json) — the one list a run may name. */
function declaredSizes(): [string, ...string[]] {
  const field = descriptor.appFields?.find((f) => f.field === "size")
  const values = field && field.kind === "select" ? field.options.map((o) => o.value) : []
  if (values.length === 0) throw new Error(`${descriptor.type}: unit.json declares no size app field`)
  return values as [string, ...string[]]
}

// One image, how many layers at most, the size and an optional "what to
// separate" description. The caller is req.userId (auth), never the body.
// The size enum is the node's declared one (its app field). Max layers keeps
// the node's own 1-99 here on purpose: the 1-20 slider is the app's.
function splitIntoLayersBody() {
  return z.object({
    imageUrl: safeUrlSchema,
    maxLayers: z.number().int().min(LAYER_SPLIT_MAX_LAYERS.min).max(LAYER_SPLIT_MAX_LAYERS.max).optional(),
    size: z.enum(declaredSizes()).optional(),
    prompt: z.string().max(LAYER_SPLIT_PROMPT_MAX).optional(),
    userId: z.string().uuid().optional(),
  })
}

// POST /v1/split-into-layers: queue a video-queue job (worker.ts). The run holds
// the row for the most images it may return (its Max layers plus the base) at its
// size's tier, and settles on the images it really returned (worker.ts).
export const route: UnitRoute = async function splitIntoLayersRoutes(app) {
  const body = splitIntoLayersBody()
  app.post("/v1/split-into-layers", {
    preHandler: [
      // Validate FIRST, so a malformed request hears the 400 that names its
      // problem rather than a 402.
      async (req, reply) => {
        const parsed = body.safeParse(req.body)
        if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      },
      creditGuard((req) => layerSplitHoldCreditId(descriptor.type, req.body as Record<string, unknown> | undefined)),
    ],
  }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const { userId: _bodyUserId, ...input } = parsed.data
    const run = {
      imageUrl: input.imageUrl,
      maxLayers: layerSplitMaxLayers(input.maxLayers),
      size: layerSplitSize(input.size),
      ...(layerSplitPrompt(input.prompt) ? { prompt: layerSplitPrompt(input.prompt) } : {}),
    }
    const creditId = layerSplitHoldCreditId(descriptor.type, run)
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(run, descriptor.type),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })
    if (error) return sendInternalError(reply, req, error, "Failed to create job")
    const reservation = await reserveCreditsForJob(req, reply, job.id, creditId)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // The BullMQ job name is the node type: the video worker dispatches it to ./worker.ts.
    // `model` names the provider model to the pickup's safety check (a loosened filter keeps the run private).
    await videoQueue.add(descriptor.type, { jobId: job.id, ...run, model: LAYER_DECOMPOSITION_MODEL_KEY, usageLogId })
    return { jobId: job.id }
  })
}
