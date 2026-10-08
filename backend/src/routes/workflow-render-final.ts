/**
 * POST /v1/workflows/:id/render-final/estimate — the quote for an agent's
 * Render final (decided 2026-10-06): the nodes the run will execute, the
 * override it runs with, and what it will be charged. Nothing is created.
 *
 * The run itself is `renderFinal: { renderNodeId }` on
 * POST /v1/workflows/:id/run, which derives the same set by the same function
 * (`lib/render-final-run.ts`, over `@nodaro/render-rules`). The quote prices
 * the graph the run executes: the earlier execution's pinned overrides with
 * the render's Final over them (`continuationInputOverrides`, as the
 * orchestrator merges), and only the nodes the run executes. The run is the
 * authority on every other refusal (the Preview review, a locked field,
 * a run already going).
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { requireScope } from "../lib/scopes.js"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { workflowAccessFromRow } from "../lib/workflow-access.js"
import { toAccessRow } from "../lib/workflow-route-access.js"
import { sendInternalError } from "../lib/http-errors.js"
import { deriveRenderFinalRun, isRenderFinalRefusal, renderFinalCredits } from "../lib/render-final-run.js"
import { resolveBillingContext } from "../lib/billing-context.js"
import { hasCredits } from "../lib/config.js"
import { resolveWebSurfaceFlag } from "../middleware/credit-guard.js"
import {
  CONTINUATION_REFUSAL_MESSAGE,
  CONTINUATION_REFUSAL_STATUS,
  continuationInputOverrides,
  continuationRefusal,
  loadContinuationSource,
} from "../services/workflow-engine/run-continuation.js"

const params = z.object({ id: z.string().uuid() })
const body = z.object({
  renderNodeId: z.string().min(1),
  continueFromExecutionId: z.string().uuid(),
})

const quoteSchema = z.object({
  data: z.object({
    renderNodeId: z.string(),
    nodeIds: z.array(z.string()),
    inputOverrides: z.record(z.string(), z.record(z.string(), z.unknown())),
    estimatedCredits: z.number().nullable(),
    sufficient: z.boolean().nullable(),
    available: z.number().nullable(),
  }),
})

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/workflows/{id}/render-final/estimate",
  description:
    "Quote a Render final: the nodes it will execute (the Apply EDL render and every node after it; Camera Switch first in multicam), " +
    "the one-shot override it runs with, its estimated credits, and whether the payer can cover them (`sufficient`; `available` is the payer's " +
    "spendable balance, null when it is not the caller's to see or a workspace budget pays). The figures are null in an edition without credits. " +
    "Nothing is created or charged; a run the payer cannot cover is refused with 402 insufficient_credits.",
  security: [{ bearerAuth: [] }],
  request: {
    params,
    body: { content: { "application/json": { schema: body } } },
  },
  responses: {
    200: { description: "The quote", content: { "application/json": { schema: quoteSchema } } },
    400: { description: "Invalid body, an unknown node, a node that is not a render, or a continuation refused" },
    401: { description: "Unauthorized" },
    404: { description: "Workflow or execution not found" },
    409: { description: "The execution has not completed" },
  },
})

export async function workflowRenderFinalRoutes(app: FastifyInstance) {
  app.post("/v1/workflows/:id/render-final/estimate", { config: { workflowScope: { workflowParam: "id" } } }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "workflows:execute")
      if (err) return reply.status(err.statusCode).send(err.body)
    }
    const p = params.safeParse(req.params)
    if (!p.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid workflow ID" } })
    }
    const b = body.safeParse(req.body ?? {})
    if (!b.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: "Send { renderNodeId, continueFromExecutionId }: the render to finalize and the run that stopped at its preview",
        },
      })
    }
    const workflowId = p.data.id

    try {
      const { data: workflow, error } = await supabase
        // tenant-scope-ignore: authorization follows immediately, below.
        .from("workflows")
        .select("id, user_id, workspace_id, visibility, nodes, edges")
        .eq("id", workflowId)
        .maybeSingle()
      if (error || !workflow) {
        return reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
      }
      const access = await workflowAccessFromRow(req.userId, toAccessRow(workflow as unknown as Record<string, unknown>))
      if (access === "none") {
        return reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
      }

      const nodes = (workflow.nodes as ReadonlyArray<{ id: string; type: string; data?: Record<string, unknown> }> | null) ?? []
      const edges = (workflow.edges as ReadonlyArray<{ source: string; target: string }> | null) ?? []
      const derived = deriveRenderFinalRun(b.data.renderNodeId, nodes, edges)
      if (isRenderFinalRefusal(derived)) {
        return reply.status(derived.status).send({ error: { code: derived.code, message: derived.message } })
      }

      const source = await loadContinuationSource(b.data.continueFromExecutionId, { withStates: false, withPin: true })
      const refusal = continuationRefusal(source, { userId: req.userId, workflowId, nodeIds: derived.nodeIds })
      if (refusal) {
        return reply.status(CONTINUATION_REFUSAL_STATUS[refusal]).send({
          error: { code: refusal, message: CONTINUATION_REFUSAL_MESSAGE[refusal] },
        })
      }

      // The graph the run executes (the earlier run's pin, the render's Final
      // over it), priced and checked through the funnel the run's 402 reads,
      // under the payer the run would resolve.
      const credits = hasCredits() ? await renderFinalCredits({
        userId: req.userId,
        nodes,
        edges,
        runNodeIds: derived.nodeIds,
        overrides: continuationInputOverrides(source!, derived.inputOverrides),
        surface: {
          billingContext: await resolveBillingContext({
            userId: req.userId,
            workflowId,
            explicitWorkspaceId: req.workspaceId,
            internal: req.authKind === "internal",
          }),
          webFreeMode: await resolveWebSurfaceFlag(req),
        },
      }) : null

      return reply.send({
        data: {
          renderNodeId: derived.renderNodeId,
          nodeIds: derived.nodeIds,
          inputOverrides: derived.inputOverrides,
          estimatedCredits: credits?.estimatedCredits ?? null,
          sufficient: credits?.sufficient ?? null,
          available: credits?.available ?? null,
        },
      })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to quote the Render final")
    }
  })
}
