import { sunoSpeechRun } from "@nodaro/render-rules"
import type { UnitRoute } from "../kit.js"
import { creditGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../../lib/request-helpers.js"
import { extractMcpClient } from "../../lib/extract-mcp-client.js"
import { buildJobInputData } from "../../lib/job-input-data.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { insertJob } from "../../lib/insert-job.js"
import { enqueueUnitJob } from "../../lib/enqueue-route-job.js"
import { descriptor } from "./descriptor.generated.js"
import { quote, sunoSpeechBody } from "./quote.js"

// POST /v1/suno-speech: queue a video-queue job (worker.ts) that asks Suno
// Speech for one run — two takes — and holds the node's flat row. Its
// preHandlers are the pricing chain quote.ts declares, the one POST /v1/quote
// runs. The run sent is the mode's own fields, trimmed (sunoSpeechRun); the
// content guard reads it in the job funnel (insertJob), before the hold.
export const route: UnitRoute = async function sunoSpeechRoutes(app) {
  const body = sunoSpeechBody()
  app.post("/v1/suno-speech", {
    preHandler: [...quote.pricing.prechecks, creditGuard(quote.pricing.modelResolver, quote.pricing.opts)],
  }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const run = sunoSpeechRun(parsed.data)
    const creditId = quote.pricing.modelResolver(req)
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData({ ...run }, descriptor.type),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })
    if (error) return sendInternalError(reply, req, error, "Failed to create job")
    const reservation = await reserveCreditsForJob(req, reply, job.id, creditId)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // On the unit's queue, under its type: the video worker dispatches it to ./worker.ts.
    // A queue that refuses the job fails it, refunds it and frees its key at once (500).
    await enqueueUnitJob(req, reply, descriptor, { jobId: job.id, ...run, usageLogId })
    if (reply.sent) return
    return { jobId: job.id }
  })
}
