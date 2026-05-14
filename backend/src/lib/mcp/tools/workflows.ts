import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import {
  stripExportContent,
  type GenericNode,
  type WorkflowExport,
} from "@nodaro/shared"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { config } from "../../config.js"
import { registerTask } from "../tasks.js"
import { ensureMcpProject } from "./_mcp-project.js"
import {
  asObjectArray,
  collectAssetIds,
  fetchExportAssets,
  reCreateAssets,
  remapNodeAssetIds,
  workflowExportSchema,
} from "../../workflow-assets.js"

const readGate: ToolGate = { required: ["workflows:read"] }
const writeGate: ToolGate = { required: ["workflows:write"] }
const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterWorkflowsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/** Standard MCP error shape — keep callers terse. */
function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

function ok(text: string, structuredContent?: Record<string, unknown>) {
  return structuredContent
    ? { content: [{ type: "text" as const, text }], structuredContent }
    : { content: [{ type: "text" as const, text }] }
}

/**
 * Workflow tools.
 *
 * Every workflow tool except `export_workflow` is scoped to the session's
 * auto-created "mcp" project (`ensureMcpProject()`): list/get/create/run plus
 * delete/get_workflow_json/update_workflow_json/import only ever see workflows
 * that live in that project. `export_workflow` is the one exception — it can
 * read any of the caller's workflows so a user can pull an existing project's
 * workflow into the MCP project via export → import.
 *
 * `run_workflow` calls the existing `/v1/workflows/:id/run` route via
 * `fastify.inject()` (the route supports the internal-orchestrator path with
 * `userId` in the body); the rest query Supabase directly, scoped by
 * `user_id` (the service-role client bypasses RLS).
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
          "List the workflows in the mcp project (the project MCP tools manage). Workflows in your other projects are not visible here — use export_workflow + import_workflow to bring one in. By default returns only top-level workflows; pass `include_sub_workflows: true` to also surface child sub-workflows.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z.string().optional().describe("ISO `created_at` from a prior result"),
          include_sub_workflows: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              "Include child sub-workflows (workflows with parent_workflow_id) in the result. Defaults to false — only top-level workflows are returned.",
            ),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const mcpProjectId = await ensureMcpProject(session)
        const limit = args.limit ?? 20
        let query = supabase
          .from("workflows")
          .select(
            "id, project_id, name, description, version, thumbnail_url, created_at, updated_at",
          )
          .eq("user_id", session.userId)
          .eq("project_id", mcpProjectId)
          .order("created_at", { ascending: false })
          .limit(limit)
        if (!args.include_sub_workflows) {
          query = query.is("parent_workflow_id", null)
        }
        if (args.cursor) query = query.lt("created_at", args.cursor)
        const { data, error } = await query
        if (error) return err(`Error: ${error.message}`)
        const rows = data ?? []
        const last = rows[rows.length - 1]
        const nextCursor =
          rows.length === limit && last?.created_at ? (last.created_at as string) : null
        return ok(JSON.stringify({ data: rows, next_cursor: nextCursor }, null, 2))
      },
    )

    server.registerTool(
      "get_workflow",
      {
        title: "Get Workflow",
        description:
          "Get a workflow's metadata (name, description, version, timestamps) from the mcp project.",
        inputSchema: { workflow_id: z.string().uuid() },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const mcpProjectId = await ensureMcpProject(session)
        const { data, error } = await supabase
          .from("workflows")
          .select(
            "id, project_id, name, description, version, thumbnail_url, created_at, updated_at",
          )
          .eq("id", args.workflow_id)
          .eq("user_id", session.userId)
          .maybeSingle()
        if (error) return err(`Error: ${error.message}`)
        if (!data) return err("Workflow not found")
        if ((data as Record<string, unknown>).project_id !== mcpProjectId) {
          return err("Workflow not found in mcp project")
        }
        return ok(JSON.stringify({ data }, null, 2))
      },
    )

    server.registerTool(
      "get_workflow_json",
      {
        title: "Get Workflow JSON",
        description:
          "Get the full React Flow JSON for a workflow in the mcp project. Returns nodes, edges, settings, name, and updated_at for use with update_workflow_json.",
        inputSchema: { workflow_id: z.string().uuid() },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const mcpProjectId = await ensureMcpProject(session)
        const { data, error } = await supabase
          .from("workflows")
          .select("id, project_id, name, nodes, edges, settings, updated_at")
          .eq("id", args.workflow_id)
          .eq("user_id", session.userId)
          .eq("project_id", mcpProjectId)
          .maybeSingle()
        if (error) return err(`Error: ${error.message}`)
        if (!data) return err("Workflow not found in mcp project")
        const row = data as Record<string, unknown>
        return ok(
          JSON.stringify(
            {
              name: row.name,
              nodes: row.nodes ?? [],
              edges: row.edges ?? [],
              settings: row.settings ?? {},
              updated_at: row.updated_at,
            },
            null,
            2,
          ),
        )
      },
    )

    server.registerTool(
      "export_workflow",
      {
        title: "Export Workflow",
        description:
          "Export a workflow as a portable JSON bundle. Works on any of your workflows (not just the mcp project). Use with_assets=true to include character, object, and location data.",
        inputSchema: {
          workflow_id: z.string().uuid(),
          with_assets: z
            .boolean()
            .optional()
            .describe(
              "When true, includes character/object/location entity data in the export. Default false (template mode).",
            ),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const includeAssets = args.with_assets === true
        const { data: wf, error } = await supabase
          .from("workflows")
          .select("id, name, nodes, edges, settings")
          .eq("id", args.workflow_id)
          .eq("user_id", session.userId)
          .maybeSingle()
        if (error) return err(`Error: ${error.message}`)
        if (!wf) return err("Workflow not found")

        const row = wf as Record<string, unknown>
        const rawNodes = asObjectArray(row.nodes)
        const result: WorkflowExport = {
          version: 1,
          exportedAt: new Date().toISOString(),
          name: row.name as string,
          nodes: (includeAssets
            ? rawNodes
            : stripExportContent(rawNodes as unknown as GenericNode[])) as unknown as GenericNode[],
          edges: (row.edges ?? []) as WorkflowExport["edges"],
          settings: (row.settings ?? {}) as Record<string, unknown>,
        }

        if (includeAssets) {
          const ids = collectAssetIds(rawNodes)
          const assetsResult = await fetchExportAssets(ids, session.userId)
          if ("error" in assetsResult) return err(`Error: ${assetsResult.error}`)
          result.assets = assetsResult
        }

        return ok(JSON.stringify(result, null, 2))
      },
    )
  }

  if (passesGate(session, writeGate)) {
    server.registerTool(
      "create_workflow",
      {
        title: "Create Workflow",
        description:
          "Create a new (empty or seeded) workflow in the mcp project. Returns the new workflow id.",
        inputSchema: {
          name: z.string().min(1).max(200),
          description: z.string().max(2000).optional(),
          nodes: z.array(z.record(z.unknown())).optional(),
          edges: z.array(z.record(z.unknown())).optional(),
          settings: z.record(z.unknown()).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (args) => {
        const mcpProjectId = await ensureMcpProject(session)
        const { data, error } = await supabase
          .from("workflows")
          .insert({
            project_id: mcpProjectId,
            user_id: session.userId,
            name: args.name,
            description: args.description ?? null,
            nodes: args.nodes ?? [],
            edges: args.edges ?? [],
            settings: args.settings ?? {},
          })
          .select("id, name, created_at, updated_at")
          .single()
        if (error || !data) return err(`Error: ${error?.message ?? "Failed to create workflow"}`)
        const row = data as Record<string, unknown>
        return ok(
          `Created workflow "${row.name as string}" (id ${row.id as string}) in the mcp project.`,
          { id: row.id, name: row.name },
        )
      },
    )

    server.registerTool(
      "delete_workflow",
      {
        title: "Delete Workflow",
        description:
          "Delete a workflow from the mcp project. Workflows in other projects are not visible via MCP.",
        inputSchema: { workflow_id: z.string().uuid() },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async (args) => {
        const mcpProjectId = await ensureMcpProject(session)
        const { data: existing, error: lookupError } = await supabase
          .from("workflows")
          .select("id, project_id")
          .eq("id", args.workflow_id)
          .eq("user_id", session.userId)
          .maybeSingle()
        if (lookupError) return err(`Error: ${lookupError.message}`)
        if (!existing || (existing as Record<string, unknown>).project_id !== mcpProjectId) {
          return err("Workflow not found in mcp project")
        }
        const { error } = await supabase
          .from("workflows")
          .delete()
          .eq("id", args.workflow_id)
          .eq("user_id", session.userId)
        if (error) return err(`Error: ${error.message}`)
        return ok(`Deleted workflow ${args.workflow_id} from the mcp project.`, {
          id: args.workflow_id,
          deleted: true,
        })
      },
    )

    server.registerTool(
      "update_workflow_json",
      {
        title: "Update Workflow JSON",
        description:
          "Replace the full node graph of a workflow in the mcp project. Supply expected_updated_at (from get_workflow_json) to enable optimistic concurrency control.",
        inputSchema: {
          workflow_id: z.string().uuid(),
          nodes: z.array(z.record(z.unknown())),
          edges: z.array(z.record(z.unknown())),
          settings: z.record(z.unknown()).optional(),
          expected_updated_at: z
            .string()
            .optional()
            .describe(
              "Optimistic concurrency — the updated_at from get_workflow_json. If provided and the DB updated_at doesn't match, returns a conflict error.",
            ),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (args) => {
        const mcpProjectId = await ensureMcpProject(session)
        const { data: existing, error: lookupError } = await supabase
          .from("workflows")
          .select("id, project_id, updated_at")
          .eq("id", args.workflow_id)
          .eq("user_id", session.userId)
          .eq("project_id", mcpProjectId)
          .maybeSingle()
        if (lookupError) return err(`Error: ${lookupError.message}`)
        if (!existing) return err("Workflow not found in mcp project")
        const existingRow = existing as Record<string, unknown>
        if (
          args.expected_updated_at !== undefined &&
          existingRow.updated_at !== args.expected_updated_at
        ) {
          return err(
            "Workflow was modified since you last read it. Fetch the latest JSON with get_workflow_json and retry.",
          )
        }
        const updates: Record<string, unknown> = {
          nodes: args.nodes,
          edges: args.edges,
          updated_at: new Date().toISOString(),
        }
        if (args.settings !== undefined) updates.settings = args.settings
        const { data, error } = await supabase
          .from("workflows")
          .update(updates)
          .eq("id", args.workflow_id)
          .eq("user_id", session.userId)
          .select("id, name, updated_at")
          .single()
        if (error || !data) return err(`Error: ${error?.message ?? "Failed to update workflow"}`)
        const updated = data as Record<string, unknown>
        return ok(
          `Updated workflow ${args.workflow_id} (${(updated.nodes as unknown[] | undefined)?.length ?? args.nodes.length} nodes).`,
          { id: updated.id, name: updated.name, updated_at: updated.updated_at },
        )
      },
    )

    server.registerTool(
      "import_workflow",
      {
        title: "Import Workflow",
        description:
          "Import a workflow from a JSON bundle (from export_workflow) into the mcp project. Re-creates any bundled character/object/location assets under your account.",
        inputSchema: {
          workflow_json: z.string().describe("The JSON string from export_workflow"),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (args) => {
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(args.workflow_json)
        } catch {
          return err("workflow_json is not valid JSON.")
        }
        const parsed = workflowExportSchema.safeParse(parsedJson)
        if (!parsed.success) {
          return err(
            `Not a valid workflow bundle: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
          )
        }
        const wf = parsed.data
        const mcpProjectId = await ensureMcpProject(session)

        // Re-create bundled assets, mapping old DB id → new DB id (node_id preserved).
        let assetIdMap: ReadonlyMap<string, string> = new Map()
        if (wf.assets) {
          const result = await reCreateAssets(wf.assets, session.userId, mcpProjectId)
          if (result instanceof Map) {
            assetIdMap = result
          } else {
            return err(`Error creating ${result.error.kind}: ${result.error.message}`)
          }
        }

        const remappedNodes = remapNodeAssetIds(wf.nodes, assetIdMap)

        const { data: newWorkflow, error: wfError } = await supabase
          .from("workflows")
          .insert({
            project_id: mcpProjectId,
            user_id: session.userId,
            name: wf.name,
            nodes: remappedNodes,
            edges: wf.edges ?? [],
            settings: wf.settings ?? {},
          })
          .select("id, name, created_at, updated_at")
          .single()
        if (wfError || !newWorkflow) {
          return err(`Error: ${wfError?.message ?? "Failed to create workflow"}`)
        }
        const row = newWorkflow as Record<string, unknown>
        return ok(
          `Imported workflow "${row.name as string}" (id ${row.id as string}) into the mcp project.`,
          { id: row.id, name: row.name },
        )
      },
    )
  }

  if (passesGate(session, executeGate)) {
    server.registerTool(
      "run_workflow",
      {
        title: "Run Workflow",
        description:
          "Run a saved workflow from the mcp project. Returns an execution_id",
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
          "ui/resourceUri": "ui://nodaro/widget/v3/workflow",
          ui: {
            resourceUri: "ui://nodaro/widget/v3/workflow",
            visibility: ["model", "app"],
          },
        },
      },
      async (args) => {
        const mcpProjectId = await ensureMcpProject(session)
        const { data: wfRow, error: wfErr } = await supabase
          .from("workflows")
          .select("name, project_id")
          .eq("id", args.workflow_id)
          .eq("user_id", session.userId)
          .maybeSingle()
        if (wfErr) return err(`Error: ${wfErr.message}`)
        if (!wfRow || (wfRow as Record<string, unknown>).project_id !== mcpProjectId) {
          return err("Workflow not found in mcp project")
        }

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
          return err(`Error from Nodaro: ${res.statusCode} ${res.body}`)
        }
        let executionId: string | undefined
        try {
          const body = JSON.parse(res.body) as { executionId?: string }
          executionId = body.executionId
        } catch {
          /* fall through */
        }
        if (!executionId) {
          return err(`Submitted but couldn't parse execution_id: ${res.body}`)
        }

        const workflowName =
          ((wfRow as Record<string, unknown>).name as string | undefined) ?? "Workflow"

        registerTask({ taskId: executionId, userId: session.userId, kind: "workflow" })

        // Iframe template lives at ui://nodaro/widget/v3/workflow (declared on
        // tool _meta.ui.resourceUri). Per-call data flows through
        // ui/notifications/tool-result via this structuredContent.
        return {
          content: [
            {
              type: "text" as const,
              text: `Started workflow execution ${executionId}.`,
            },
          ],
          structuredContent: { executionId, name: workflowName },
        }
      },
    )
  }
}
