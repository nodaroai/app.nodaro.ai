import { layerSplitMaxLayers, layerSplitPrompt, layerSplitSize } from "@nodaro/render-rules"
import type { UnitRoute } from "../kit.js"
import { creditGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../../lib/request-helpers.js"
import { extractMcpClient } from "../../lib/extract-mcp-client.js"
import { buildJobInputData } from "../../lib/job-input-data.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { insertJobIdempotent } from "../../lib/insert-job.js"
import { enqueueUnitJob } from "../../lib/enqueue-route-job.js"
import { LAYER_DECOMPOSITION_MODEL_KEY } from "../../providers/kie/models.js"
import { descriptor } from "./descriptor.generated.js"
import { quote, splitIntoLayersBody } from "./quote.js"

// POST /v1/split-into-layers: queue a video-queue job (worker.ts). The run holds
// the row for the most images it may return (its Max layers plus the base) at its
// size's tier, and settles on the images it really returned (worker.ts). Its
// preHandlers are the pricing chain quote.ts declares, the one POST /v1/quote runs.
// `sessionId` / `origin` in the body are read by the job funnel (insertJob).
export const route: UnitRoute = async function splitIntoLayersRoutes(app) {
  const body = splitIntoLayersBody()
  app.post("/v1/split-into-layers", {
    preHandler: [...quote.pricing.prechecks, creditGuard(quote.pricing.modelResolver, quote.pricing.opts)],
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
    // The id the guard checked, from the same resolver (CHECK === DEBIT, and what a quote answers).
    const creditId = quote.pricing.modelResolver(req)
    const mcpClient = extractMcpClient(req.body)

    // The row carries the request's Idempotency-Key (the credit guard keeps it on
    // `req.idempotencyKey`), so a retry with the same key answers the job the
    // first request started: found by the guard's `beforePricing` step at any age,
    // before any credit check (quote.ts), or losing the insert race here.
    let inserted: { row: { id: string }; created: boolean }
    try {
      inserted = await insertJobIdempotent<{ id: string }>(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(run, descriptor.type),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      }, req.idempotencyKey)
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to create job")
    }
    const job = inserted.row
    if (!inserted.created) {
      reply.header("X-Dedup-Hit", "1")
      return reply.code(200).send({ jobId: job.id, deduped: true })
    }
    const reservation = await reserveCreditsForJob(req, reply, job.id, creditId)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // The BullMQ job name is the node type: the video worker dispatches it to ./worker.ts.
    // `model` names the provider model to the pickup's safety check (a loosened filter keeps the run private).
    // A queue that refuses the job fails it, refunds it and frees its key at once (500).
    await enqueueUnitJob(req, reply, descriptor, { jobId: job.id, ...run, model: LAYER_DECOMPOSITION_MODEL_KEY, usageLogId })
    if (reply.sent) return
    return { jobId: job.id }
  })
}
