import type { FastifyInstance } from "fastify"
import { assertCanvasExecutionAllowed, SequenceExecutionRequiredError } from "@nodaro/shared"
import { extractNodeId, extractWorkflowId } from "../lib/request-helpers.js"
import { loadWorkflowFor } from "../lib/workflow-route-access.js"

/** Backstop for older canvas clients which call a single-node media route.
 * Studio's reviewed production routes submit their own inputs without a canvas
 * nodeId. Client declarations cannot override the stored node's requirement. */
export function registerSequenceExecutionGuard(app: FastifyInstance): void {
  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "POST" || !req.userId) return
    const workflowId = extractWorkflowId(req.body)
    const nodeId = extractNodeId(req.body)
    if (!workflowId || !nodeId) return
    const loaded = await loadWorkflowFor(req, reply, req.userId, workflowId, "view",
      "id,user_id,workspace_id,visibility,nodes", "Failed to validate workflow execution")
    if (!loaded.ok) return reply
    const nodes = Array.isArray(loaded.row.nodes) ? loaded.row.nodes as Array<{ id: string; data?: unknown }> : []
    const node = nodes.find((node) => node.id === nodeId)
    if (!node) return
    try { assertCanvasExecutionAllowed([node]) }
    catch (error) {
      if (error instanceof SequenceExecutionRequiredError) return reply.status(400).send({
        error: { code: error.code, message: error.message, nodeIds: error.nodeIds },
      })
      throw error
    }
  })
}
