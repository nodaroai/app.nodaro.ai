import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { hasCredits } from "../../config.js"
import { findCloudOnlyNodeTypes, cloudOnlyRejectionMessage } from "../../cloud-only-nodes.js"
import { findDeniedNodeTypes, deniedNodeRejectionMessage } from "../../surface-deny.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import { stripExportContent, stripTransientRuntimeData, normalizeNodeModelParams, describeNodeAdjustments, type GenericNode, type WorkflowExport } from "@nodaro/shared"
import type { McpSession } from "../session.js"
import { mcpInject } from "../internal-request.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"
import { config } from "../../config.js"
import { registerTask } from "../tasks.js"
import { ensureMcpProject } from "./_mcp-project.js"
import { loadMcpWorkflow } from "./_workflow-access.js"
import { canChangeWorkflowVisibility } from "../../workflow-access.js"
import { changesStudioPublishFlag } from "../../studio-audience.js"
import {
  asObjectArray,
  collectAssetIds,
  fetchExportAssets,
  reCreateAssets,
  remapNodeAssetIds,
  workflowExportSchema,
} from "../../workflow-assets.js"
import { migrateGenerateImageHandles } from "../../generate-image-handle-migration.js"
import { findUnroutableMedia, rehostForeignMedia } from "../../media-portability.js"


/** Refuse Cloud-only node types on editions that can't run them, plus any node
 *  the deployment surface profile denies (B1, business+) — an agent-authored
 *  workflow never passes through the node pickers. The deny check runs on every
 *  edition the gate is open for, so it is not behind the hasCredits() early-out. */
function cloudOnlyGuard(nodes: unknown): string | null {
  const denied = findDeniedNodeTypes(nodes as ReadonlyArray<{ type?: unknown }> | undefined)
  if (denied.length > 0) return deniedNodeRejectionMessage(denied)
  if (hasCredits()) return null
  const found = findCloudOnlyNodeTypes(nodes as ReadonlyArray<{ type?: unknown }> | undefined)
  return found.length > 0 ? cloudOnlyRejectionMessage(found) : null
}

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
 * Turn a route's error response (relayed through `mcpInject`) into readable MCP
 * text. When the body is our standard `{ error: { message } }` envelope — a
 * 403 "only the owner or a workspace admin", a 503 "could not be recorded" —
 * that friendly message IS the answer and the model should see it verbatim.
 * Anything else falls back to the status + raw body.
 */
function mcpRouteError(statusCode: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } }
    if (typeof parsed.error?.message === "string" && parsed.error.message.length > 0) {
      return parsed.error.message
    }
  } catch {
    /* not JSON — fall through */
  }
  return `Error from Nodaro: ${statusCode} ${body}`
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
 * `mcpInject()` (the route supports the internal-orchestrator path with
 * `userId` in the body); the rest query Supabase directly, scoped by
 * `user_id` (the service-role client bypasses RLS).
 */
export function registerWorkflows({
  server,
  session,
  fastify,
}: RegisterWorkflowsOpts): void {
  // An in-app session is pinned to the open workflow's project, where "the
  // mcp project" would be a misleading place to tell the model to look.
  const projectNoun = session.scopedProjectId ? "in this project" : "in mcp project"

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
        const loaded = await loadMcpWorkflow(
          session,
          args.workflow_id,
          "view",
          "id, project_id, name, description, version, thumbnail_url, created_at, updated_at",
        )
        if (!loaded.ok) return err(loaded.message)
        return ok(JSON.stringify({ data: loaded.row }, null, 2))
      },
    )

    server.registerTool(
      "get_workflow_json",
      {
        title: "Get Workflow JSON",
        description:
          "Get the full React Flow JSON for a workflow in the mcp project. Returns nodes, edges, settings, name, updated_at and version (pass it back as expected_version to update_workflow_json).",
        inputSchema: { workflow_id: z.string().uuid() },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        const loaded = await loadMcpWorkflow(
          session,
          args.workflow_id,
          "view",
          "id, project_id, name, nodes, edges, settings, updated_at, version",
        )
        if (!loaded.ok) return err(loaded.message)
        const row = loaded.row
        return ok(
          JSON.stringify(
            {
              name: row.name,
              nodes: row.nodes ?? [],
              edges: row.edges ?? [],
              settings: row.settings ?? {},
              updated_at: row.updated_at,
              // The CAS token `update_workflow_json` asks for as `expected_version`
              // — the doc promised it here long before the read side supplied it.
              version: row.version,
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
        // `export_workflow` reaches any of the caller's workflows, so no "mcp"
        // project floor — but in a workspace it is still an access-gated `view`.
        const loaded = await loadMcpWorkflow(
          session,
          args.workflow_id,
          "view",
          "id, name, nodes, edges, settings",
          { personalProjectFloor: false },
        )
        if (!loaded.ok) return err(loaded.message)
        const row = loaded.row
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

        // Same portability note the REST export carries (#866).
        const unreachableMedia = findUnroutableMedia(result.nodes)
        if (unreachableMedia.length > 0) result.portability = { unreachableMedia }

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
          "Create a new (empty or seeded) workflow in the mcp project. Returns the new workflow id." +
          " Any AI prompt node's `data` may carry `promptPrefix` / `promptSuffix` — pre/post text wrapped around its prompt at run time (settings-only; see get_node_skill for the node's fields).",
        inputSchema: {
          name: z.string().min(1).max(200),
          description: z.string().max(2000).optional(),
          nodes: z.array(z.record(z.string(), z.unknown())).optional(),
          edges: z.array(z.record(z.string(), z.unknown())).optional(),
          settings: z.record(z.string(), z.unknown()).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (args) => {
        const mcpProjectId = await ensureMcpProject(session)
        const cloudOnlyErr = cloudOnlyGuard(args.nodes)
        if (cloudOnlyErr) return err(cloudOnlyErr)

        const { data, error } = await supabase
          .from("workflows")
          .insert({
            project_id: mcpProjectId,
            user_id: session.userId,
            name: args.name,
            description: args.description ?? null,
            // Heal impossible provider/parameter pairs at the write boundary —
            // same reason as update_workflow_json: an agent-authored node never
            // renders the config panel, so nothing else ever snaps its values.
            nodes: normalizeNodeModelParams(
              (args.nodes ?? []) as Array<{ id?: unknown; type?: unknown; data?: unknown }>,
            ).nodes,
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
        // Workspace context: the delete goes through the REST route, which
        // carries the whole P10 delete invariant that must not be reimplemented
        // here — `canDeleteWorkflow` (an editor grant may change work, never
        // end it), the refusal to delete a personal workflow on someone else's
        // behalf, the write-ahead audit entry (or a 503 when it cannot be
        // recorded), and the cascade RPC keyed by the CREATOR's id. Routing
        // through `mcpInject` reuses all of it; the workspace header travels
        // automatically, and a DELETE carries no body, so the caller's identity
        // rides the `x-internal-user-id` header the auth hook reads for
        // bodyless internal injects.
        if (session.workspaceId) {
          const res = await mcpInject(fastify, session, {
            method: "DELETE",
            url: `/v1/workflows/${encodeURIComponent(args.workflow_id)}`,
            headers: { "x-internal-user-id": session.userId },
          })
          if (res.statusCode >= 400) return err(mcpRouteError(res.statusCode, res.body))
          return ok(`Deleted workflow ${args.workflow_id}.`, {
            id: args.workflow_id,
            deleted: true,
          })
        }

        // No workspace (every caller today, and every caller while
        // ORGS_ENABLED is off): unchanged — creator plus the isolated "mcp"
        // project, a raw delete with no audit. Byte-identical to before P11.
        const mcpProjectId = await ensureMcpProject(session)
        const { data: existing, error: lookupError } = await supabase
          .from("workflows")
          .select("id, project_id")
          .eq("id", args.workflow_id)
          .eq("user_id", session.userId)
          .maybeSingle()
        if (lookupError) return err(`Error: ${lookupError.message}`)
        if (!existing || (existing as Record<string, unknown>).project_id !== mcpProjectId) {
          return err(`Workflow not found ${projectNoun}`)
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
          "Update a workflow in the mcp project: replace its node graph (nodes + edges together), and/or its settings, and/or its thumbnail_url. All content fields are optional — e.g. pass only thumbnail_url to set the preview image without re-sending the graph. Supply expected_updated_at or expected_version (from get_workflow_json) to enable optimistic concurrency control." +
          " Any AI prompt node's `data` may carry `promptPrefix` / `promptSuffix` — pre/post text wrapped around its prompt at run time (settings-only; see get_node_skill for the node's fields).",
        inputSchema: {
          workflow_id: z.string().uuid(),
          nodes: z.array(z.record(z.string(), z.unknown())).optional(),
          edges: z.array(z.record(z.string(), z.unknown())).optional(),
          settings: z.record(z.string(), z.unknown()).optional(),
          thumbnail_url: z
            .string()
            .url()
            .nullable()
            .optional()
            .describe(
              "Public URL of the workflow's thumbnail/preview image, or null to clear it. Must be an already-hosted image URL.",
            ),
          expected_updated_at: z
            .string()
            .optional()
            .describe(
              "Optimistic concurrency — the updated_at from get_workflow_json. If provided and the DB updated_at doesn't match, returns a conflict error.",
            ),
          expected_version: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe(
              "Integer CAS — the version from get_workflow_json. Preferred over expected_updated_at (monotonic counter bumped by the DB on every content change).",
            ),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (args) => {
        // Fork on workspace, exactly as the by-id reads do. In a workspace the
        // P10 seam decides who may write (`edit` access) and the write is scoped
        // to the id alone; with no workspace the long-standing creator + "mcp"
        // -project scoping is kept, byte-identical to before P11. `edit` here
        // means a view-only member gets "not found", the same answer these
        // tools have always given for a workflow the caller may not reach.
        const isWorkspace = session.workspaceId !== undefined
        let mcpProjectId: string | null = null
        let storedSettings: unknown
        if (isWorkspace) {
          const loaded = await loadMcpWorkflow(session, args.workflow_id, "edit", "id, settings")
          if (!loaded.ok) return err(loaded.message)
          storedSettings = loaded.row.settings
        } else {
          mcpProjectId = await ensureMcpProject(session)
        }

        // nodes + edges are a unit (the handle migration needs both). Allow
        // neither (metadata-only update) or both — never just one.
        const hasNodes = args.nodes !== undefined
        const hasEdges = args.edges !== undefined
        if (hasNodes !== hasEdges) {
          return err("Provide both `nodes` and `edges` together, or neither.")
        }
        const cloudOnlyUpdateErr = cloudOnlyGuard(args.nodes)
        if (cloudOnlyUpdateErr) return err(cloudOnlyUpdateErr)
        if (!hasNodes && args.settings === undefined && args.thumbnail_url === undefined) {
          return err(
            "Nothing to update — provide nodes+edges, settings, and/or thumbnail_url.",
          )
        }

        // Audience gate — workspace only. A settings write that would change WHO
        // can reach the workflow (`studio.shared` opens the no-auth public read;
        // `presentationSettings.shareReadOnly` widens who may spend the owner's
        // credits through a share link) is asked of `canChangeWorkflowVisibility`
        // — the same authority the two REST PATCH paths ask. MCP update is a
        // third settings door and has no RLS underneath it, so without this an
        // edit-level member could publish the creator's work to the whole class,
        // or the open internet, in one write. With no workspace the caller is the
        // creator, who passes that check by definition, so the gate is skipped.
        if (
          isWorkspace &&
          args.settings !== undefined &&
          changesStudioPublishFlag(args.settings, storedSettings)
        ) {
          if (!(await canChangeWorkflowVisibility(session.userId, args.workflow_id))) {
            return err(
              "Only the owner or a workspace admin can change who this workflow is shared with.",
            )
          }
        }

        const updates: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        }
        let nodeAdjustments: ReturnType<typeof normalizeNodeModelParams>["adjustments"] = []
        if (hasNodes) {
          const migratedEdges = migrateGenerateImageHandles(
            args.nodes as Array<{ id: string; type?: string }>,
            args.edges as Array<{ id: string; source: string; target: string; sourceHandle: string | null; targetHandle: string | null }>,
          )
          // Server-side strip of transient run-state (status/jobId/progress) —
          // agent-authored graphs must never seed phantom "running" state.
          const stripped = stripTransientRuntimeData(args.nodes as Array<{ data?: Record<string, unknown> }>)
          // …and heal impossible provider/parameter pairs. An agent writing JSON
          // never renders the config panel, so the panel's provider-aware
          // dropdown and its stale-value snap never run for these nodes. Left
          // alone, a pair like gpt-image + 16:9 survives to the provider call
          // and aborts the whole run at generate-time (incident 2026-08-09).
          const healed = normalizeNodeModelParams(stripped as Array<{ id?: unknown; type?: unknown; data?: unknown }>)
          nodeAdjustments = healed.adjustments
          updates.nodes = healed.nodes
          updates.edges = migratedEdges
        }
        if (args.settings !== undefined) updates.settings = args.settings
        if (args.thumbnail_url !== undefined) updates.thumbnail_url = args.thumbnail_url
        // Atomic optimistic concurrency: fold the version check INTO the UPDATE
        // (no read-then-write race). When expected_updated_at is provided it is
        // part of the match, so a concurrent writer that bumped updated_at between
        // the caller's read and this write makes the UPDATE match 0 rows instead
        // of silently clobbering their edit. Mirrors update_character / update_location
        // and the REST PATCH /v1/workflows/:id.
        let query = supabase
          .from("workflows")
          .update(updates)
          .eq("id", args.workflow_id)
        // The no-workspace floor: creator + "mcp" project. In a workspace the
        // row was already access-judged by `loadMcpWorkflow` above, so the write
        // is scoped to the id alone (the row may belong to another member).
        if (!isWorkspace) {
          query = query.eq("user_id", session.userId).eq("project_id", mcpProjectId!)
        }
        if (args.expected_updated_at !== undefined) {
          query = query.eq("updated_at", args.expected_updated_at)
        }
        if (args.expected_version !== undefined) {
          query = query.eq("version", args.expected_version)
        }
        const { data, error } = await query.select("id, name, updated_at, version").maybeSingle()
        if (error) return err(`Error: ${error.message}`)
        if (!data) {
          // 0 rows matched. Distinguish a stale-version conflict from a genuine
          // not-found (only does the extra read on this rare path).
          if (args.expected_updated_at !== undefined || args.expected_version !== undefined) {
            let existsQuery = supabase
              .from("workflows")
              .select("id")
              .eq("id", args.workflow_id)
            if (!isWorkspace) {
              existsQuery = existsQuery.eq("user_id", session.userId).eq("project_id", mcpProjectId!)
            }
            const { data: stillExists } = await existsQuery.maybeSingle()
            if (stillExists) {
              return err(
                "Workflow was modified since you last read it. Fetch the latest JSON with get_workflow_json and retry.",
              )
            }
          }
          return err(`Workflow not found ${projectNoun}`)
        }
        const updated = data as Record<string, unknown>
        const changed: string[] = []
        if (hasNodes) changed.push(`${args.nodes!.length} nodes`)
        if (args.settings !== undefined) changed.push("settings")
        if (args.thumbnail_url !== undefined) changed.push("thumbnail")
        // Tell the agent what we corrected. Silently healing would leave it
        // believing it wrote 16:9 and re-sending the same pair next turn.
        const healNote =
          nodeAdjustments.length > 0
            ? `\n\nAdjusted ${nodeAdjustments.length} parameter(s) the selected model does not accept:\n` +
              describeNodeAdjustments(nodeAdjustments).map((l) => `  - ${l}`).join("\n")
            : ""
        return ok(
          `Updated workflow ${args.workflow_id} (${changed.join(", ")}).${healNote}`,
          {
            id: updated.id,
            name: updated.name,
            updated_at: updated.updated_at,
            version: updated.version,
            ...(nodeAdjustments.length > 0 ? { adjustments: nodeAdjustments } : {}),
          },
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

        // Heal impossible provider/parameter pairs on the way in — an imported
        // bundle can carry values authored against a different model (or a
        // hand-edited JSON), and nothing downstream re-checks them.
        const remappedNodes = normalizeNodeModelParams(
          remapNodeAssetIds(wf.nodes, assetIdMap) as Array<{ id?: unknown; type?: unknown; data?: unknown }>,
        ).nodes

        const migratedEdges = migrateGenerateImageHandles(
          remappedNodes as Array<{ id: string; type?: string }>,
          (wf.edges ?? []) as Array<{ id: string; source: string; target: string; sourceHandle: string | null; targetHandle: string | null }>,
        )

        const { data: newWorkflow, error: wfError } = await supabase
          .from("workflows")
          .insert({
            project_id: mcpProjectId,
            user_id: session.userId,
            name: wf.name,
            nodes: remappedNodes,
            edges: migratedEdges,
            settings: wf.settings ?? {},
          })
          .select("id, name, created_at, updated_at")
          .single()
        if (wfError || !newWorkflow) {
          return err(`Error: ${wfError?.message ?? "Failed to create workflow"}`)
        }
        const row = newWorkflow as Record<string, unknown>

        // Same as the REST import (#866): media the bundle points at elsewhere
        // is copied onto this instance AFTER the row exists (a failed copy is
        // never a lost import); what could not be copied is reported below.
        const { nodes: portableNodes, report: importReport } = await rehostForeignMedia(remappedNodes, session.userId)
        if (importReport.rehosted > 0) {
          const { error: updError } = await supabase
            .from("workflows")
            .update({ nodes: portableNodes })
            .eq("id", row.id as string)
            .eq("user_id", session.userId)
          if (updError) {
            importReport.notes = [...(importReport.notes ?? []), `Media was copied onto this instance, but the workflow could not be updated to use the copies (${updError.message}).`]
          }
        }
        const mediaNotes = [
          importReport.rehosted > 0 ? `${importReport.rehosted} media file(s) copied onto this instance.` : "",
          importReport.unreachable.length > 0
            ? `${importReport.unreachable.length} media URL(s) point at a private host this instance cannot reach — those nodes need their media re-uploaded here: ${importReport.unreachable.map((m) => `${m.nodeLabel ?? m.nodeId} (${m.field})`).join(", ")}.`
            : "",
          importReport.skipped.length > 0
            ? `${importReport.skipped.length} media URL(s) skipped: ${importReport.skipped.map((m) => `${m.nodeLabel ?? m.nodeId} (${m.field}): ${m.reason}`).join("; ")}.`
            : "",
          ...(importReport.notes ?? []),
        ].filter(Boolean)
        return ok(
          [`Imported workflow "${row.name as string}" (id ${row.id as string}) into the mcp project.`, ...mediaNotes].join(" "),
          { id: row.id, name: row.name, importReport },
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
            .describe(
              "Optional per-node input overrides, keyed by node id. The value may be a bare scalar/array (e.g. \"blue car\" or [\"a\",\"b\"]) — it's written to that node's main input field — OR an object mapping specific fields to values (e.g. { \"prompt\": \"...\" }).",
            ),
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
          "ui/resourceUri": "ui://nodaro/widget/v4/workflow",
          ui: {
            resourceUri: "ui://nodaro/widget/v4/workflow",
            visibility: ["model", "app"],
          },
        },
      },
      async (args) => {
        // Access + existence via the P10 seam (workspace-aware); the ROUTE's
        // `canRunWorkflow` is the authority on whether a paid run may start —
        // running spends money and is stricter than viewing — so `view` is
        // enough here to confirm the caller can see it and to fetch the name.
        // A view-only workspace member therefore passes this gate and is
        // refused by the route with a reason, not a generic "not found". In
        // the no-workspace case `loadMcpWorkflow` keeps the mcp-project floor,
        // byte-identical to the pre-check this replaces.
        const loaded = await loadMcpWorkflow(session, args.workflow_id, "view", "name")
        if (!loaded.ok) return err(loaded.message)
        const wfRow = loaded.row

        const payload = {
          mcp_client: session.clientName,
          userId: session.userId,
          ...(args.inputs ? { inputOverrides: args.inputs } : {}),
        }
        const res = await mcpInject(fastify, session, {
          method: "POST",
          url: `/v1/workflows/${encodeURIComponent(args.workflow_id)}/run`,
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

        // Iframe template lives at ui://nodaro/widget/v4/workflow (declared on
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
