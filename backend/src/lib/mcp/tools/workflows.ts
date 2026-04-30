import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { config } from "../../config.js"
import { registerTask } from "../tasks.js"

const readGate: ToolGate = { required: ["workflows:read"] }
const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterWorkflowsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Workflow tools.
 *
 * `list_workflows` queries Supabase directly (scoped to the session's
 * userId). `run_workflow` calls the existing `/v1/workflows/:id/run` route
 * via `app.inject()` — that route fully supports the internal-orchestrator
 * path (POST body carries `userId`).
 */
export function registerWorkflows({
  server,
  session,
  fastify,
}: RegisterWorkflowsOpts): void {
  if (passesGate(session, readGate)) {
    server.registerTool(
      "list_workflows",
      {
        title: "List Workflows",
        description:
          "List the authenticated user's workflows. Optional project_id filter; otherwise returns workflows across all projects.",
        inputSchema: {
          project_id: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z.string().optional().describe("ISO `created_at` from a prior result"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const limit = args.limit ?? 20
        let query = supabase
          .from("workflows")
          .select(
            "id, project_id, name, description, version, thumbnail_url, created_at, updated_at",
          )
          .eq("user_id", session.userId)
          .order("created_at", { ascending: false })
          .limit(limit)
        if (args.project_id) query = query.eq("project_id", args.project_id)
        if (args.cursor) query = query.lt("created_at", args.cursor)
        const { data, error } = await query
        if (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          }
        }
        const rows = data ?? []
        const last = rows[rows.length - 1]
        const nextCursor =
          rows.length === limit && last?.created_at ? (last.created_at as string) : null
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ data: rows, next_cursor: nextCursor }, null, 2),
            },
          ],
        }
      },
    )
  }

  if (passesGate(session, executeGate)) {
    server.registerTool(
      "run_workflow",
      {
        title: "Run Workflow",
        description:
          "Run a saved workflow. Returns an execution_id; poll via tasks/get with task_id=execution_id.",
        inputSchema: {
          workflow_id: z.string().uuid(),
          inputs: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Optional per-node input overrides (keyed by node id)"),
        },
        outputSchema: {
          executionId: z.string(),
          name: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/workflow",
        ui: {
          resourceUri: "ui://nodaro/widget/workflow",
          visibility: ["model", "app"],
        },
      },
      },
      async (args) => {
        const payload = {
          mcp_client: session.clientName,
          userId: session.userId,
          ...(args.inputs ? { inputOverrides: args.inputs } : {}),
        }
        const res = await fastify.inject({
          method: "POST",
          url: `/v1/workflows/${encodeURIComponent(args.workflow_id)}/run`,
          headers: {
            "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
          },
          payload,
        })
        if (res.statusCode >= 400) {
          return {
            content: [
              { type: "text", text: `Error from Nodaro: ${res.statusCode} ${res.body}` },
            ],
            isError: true,
          }
        }
        let executionId: string | undefined
        let workflowName: string | undefined
        try {
          const body = JSON.parse(res.body) as { executionId?: string }
          executionId = body.executionId
        } catch {
          /* fall through */
        }
        if (!executionId) {
          return {
            content: [
              {
                type: "text",
                text: `Submitted but couldn't parse execution_id: ${res.body}`,
              },
            ],
            isError: true,
          }
        }

        // Best-effort name lookup for the widget header. If the row was
        // deleted between run-creation and now (race), we fall back to a
        // generic "Workflow" label rather than failing the tool call.
        const { data: wf } = await supabase
          .from("workflows")
          .select("name")
          .eq("id", args.workflow_id)
          .maybeSingle()
        workflowName = (wf?.name as string | undefined) ?? "Workflow"

        registerTask({ taskId: executionId, userId: session.userId, kind: "workflow" })

        // Iframe template lives at ui://nodaro/widget/workflow (declared on
        // tool _meta.ui.resourceUri). Per-call data flows through
        // ui/notifications/tool-result via this structuredContent.
        return {
          content: [
            {
              type: "text" as const,
              text: `Started workflow execution ${executionId}. Track via tasks/get with task_id=${executionId}.`,
            },
          ],
          structuredContent: { executionId, name: workflowName },
          _meta: { task_id: executionId },
        }
      },
    )
  }
}
