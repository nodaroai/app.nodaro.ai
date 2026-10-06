/**
 * MCP `render_final` — an agent's Render final (decided 2026-10-06).
 *
 * A workflow whose Apply EDL render reads Proxy stops at that preview for a
 * person to review in the editor. Once they have, Render final runs the
 * render at Final for that run only, and everything after it. The SERVER
 * derives what runs — the render, its tail, Camera Switch first in multicam —
 * by the editor's own rule (`renderFinal` on POST /v1/workflows/:id/run), so
 * the agent sends only the render's id and the execution it continues.
 *
 * Price confirmation follows `start_recast`: without `confirm` the tool
 * returns the quote (POST /v1/workflows/:id/render-final/estimate — nothing
 * is created or charged); `confirm: true`, only after the user accepted it,
 * runs. The quote says whether the payer can cover it; the run route refuses
 * one it cannot with a 402 before any execution exists, and every refusal
 * comes back as a tool error.
 *
 * Writing the review (`editedEdl`) is not this tool's: an agent's review is a
 * later decision.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { McpSession } from "../session.js"
import { mcpInject } from "../internal-request.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { registerTask } from "../tasks.js"
import { hasCredits } from "../../config.js"
import { loadMcpWorkflow } from "./_workflow-access.js"
import { clientRequestIdSchema, errorResult, idempotencyHeaders } from "./_verb-helpers.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterRenderFinalOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

interface Quote {
  renderNodeId: string
  nodeIds: string[]
  estimatedCredits: number | null
  /** Whether the payer can cover it; null without credits. */
  sufficient?: boolean | null
  /** The payer's spendable balance, when it is the caller's to see. */
  available?: number | null
}

export function registerRenderFinal({ server, session, fastify }: RegisterRenderFinalOpts): void {
  if (!passesGate(session, executeGate)) return

  server.registerTool(
    "render_final",
    {
      title: "Render Final",
      description:
        "Render the final of an Apply EDL render whose run stopped at its Preview, once the user reviewed it: the render at Final for this run only, and every node after it (in multicam, Camera Switch first). " +
        "The server picks the nodes; the Edit Plan is not run again (its plan with the user's review applied is used). " +
        "It continues the execution that stopped at the preview: every node it does not run hands on that execution's output. " +
        "Without `confirm` it returns the PRICE QUOTE only (nothing is charged); with `confirm: true` — only after the user accepted the quoted credits — it runs. " +
        "Returns an execution id: read it with get_app_run.",
      inputSchema: {
        workflow_id: z.string().uuid(),
        render_node_id: z.string().min(1).describe("The id of the Apply EDL render node to finalize (get_workflow_json)."),
        execution_id: z
          .string()
          .uuid()
          .describe("The execution that stopped at the preview — your own completed run of this workflow. Its outputs feed every node the Render final does not run."),
        confirm: z
          .boolean()
          .optional()
          .describe("true ONLY after the user accepted the quoted credits in this conversation."),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      // Visibility + the mcp-project floor, as run_workflow; the run route is
      // the authority on whether a paid run may start.
      const loaded = await loadMcpWorkflow(session, args.workflow_id, "view", "name")
      if (!loaded.ok) return { content: [{ type: "text" as const, text: loaded.message }], isError: true as const }

      // Quote first, always: it also checks the render and the execution.
      const est = await mcpInject(fastify, session, {
        method: "POST",
        url: `/v1/workflows/${encodeURIComponent(args.workflow_id)}/render-final/estimate`,
        payload: {
          userId: session.userId,
          renderNodeId: args.render_node_id,
          continueFromExecutionId: args.execution_id,
        },
      })
      if (est.statusCode >= 400) return errorResult(est.statusCode, est.body)
      const quote = (JSON.parse(est.body) as { data: Quote }).data

      if (args.confirm !== true) {
        const billed = quote.estimatedCredits !== null && hasCredits()
        const price = billed
          ? `costs about ${quote.estimatedCredits} credits`
          : "is not billed in credits on this edition"
        const next =
          billed && quote.sufficient === false
            ? `The user's credits cannot cover it${typeof quote.available === "number" ? ` (${quote.available} available)` : ""}: ` +
              "tell them, and run it only after they have added credits — until then the run is refused with insufficient credits."
            : "Present this to the user; call render_final again with confirm: true once they accept."
        return {
          content: [
            {
              type: "text" as const,
              text: `Render final of "${quote.renderNodeId}" runs ${quote.nodeIds.length} node(s) (${quote.nodeIds.join(", ")}) and ${price}. ${next}`,
            },
          ],
          structuredContent: { ...quote, confirmed: false },
        }
      }

      const res = await mcpInject(fastify, session, {
        method: "POST",
        url: `/v1/workflows/${encodeURIComponent(args.workflow_id)}/run`,
        payload: {
          mcp_client: session.clientName,
          userId: session.userId,
          renderFinal: { renderNodeId: args.render_node_id },
          continueFromExecutionId: args.execution_id,
        },
        headers: idempotencyHeaders(args.client_request_id),
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      let executionId: string | undefined
      try {
        executionId = (JSON.parse(res.body) as { executionId?: string }).executionId
      } catch {
        /* fall through */
      }
      if (!executionId) {
        return { content: [{ type: "text" as const, text: "Render final was submitted, but its execution id could not be read." }], isError: true as const }
      }
      registerTask({ taskId: executionId, userId: session.userId, kind: "workflow" })
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Started Render final execution ${executionId} (${quote.nodeIds.length} node(s)). ` +
              "Read it with get_app_run(execution_id) — an EXECUTION id, not a job id: it lists every node's status and media once it completes.",
          },
        ],
        structuredContent: { executionId, nodeIds: quote.nodeIds, estimatedCredits: quote.estimatedCredits, confirmed: true },
      }
    },
  )
}
