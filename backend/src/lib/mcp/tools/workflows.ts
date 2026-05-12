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

/** Coerce a stored `nodes`/`edges` jsonb column into an array of plain objects. */
function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (v): v is Record<string, unknown> => v !== null && typeof v === "object",
  )
}

interface AssetVariant {
  name: string
  url: string
}

const assetVariantSchema = z.object({ name: z.string(), url: z.string() })

const exportCharacterSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  gender: z.string().nullish(),
  style: z.string().nullish(),
  baseOutfit: z.string().nullish(),
  sourceImageUrl: z.string().nullish(),
  expressions: z.array(assetVariantSchema).optional(),
  poses: z.array(assetVariantSchema).optional(),
  lightingVariations: z.array(assetVariantSchema).optional(),
})

const exportObjectSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  style: z.string().nullish(),
  sourceImageUrl: z.string().nullish(),
  angles: z.array(assetVariantSchema).optional(),
  materials: z.array(assetVariantSchema).optional(),
  variations: z.array(assetVariantSchema).optional(),
})

const exportLocationSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  style: z.string().nullish(),
  sourceImageUrl: z.string().nullish(),
  timeOfDay: z.array(assetVariantSchema).optional(),
  weather: z.array(assetVariantSchema).optional(),
  angles: z.array(assetVariantSchema).optional(),
})

/** Mirrors `workflowExportSchema` in `backend/src/routes/workflows.ts`. */
const workflowExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  name: z.string().min(1).max(200),
  nodes: z.array(z.record(z.unknown())),
  edges: z.array(z.record(z.unknown())),
  settings: z.record(z.unknown()).optional(),
  assets: z
    .object({
      characters: z.array(exportCharacterSchema),
      objects: z.array(exportObjectSchema),
      locations: z.array(exportLocationSchema),
    })
    .optional(),
})

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
          "List the workflows in the mcp project (the project MCP tools manage). Workflows in your other projects are not visible here — use export_workflow + import_workflow to bring one in.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
          cursor: z.string().optional().describe("ISO `created_at` from a prior result"),
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

        const rawNodes = asObjectArray((wf as Record<string, unknown>).nodes)
        const exportNodes = includeAssets
          ? rawNodes
          : stripExportContent(rawNodes as unknown as GenericNode[])

        const result: WorkflowExport = {
          version: 1,
          exportedAt: new Date().toISOString(),
          name: (wf as Record<string, unknown>).name as string,
          nodes: exportNodes as unknown as GenericNode[],
          edges: ((wf as Record<string, unknown>).edges ??
            []) as WorkflowExport["edges"],
          settings: ((wf as Record<string, unknown>).settings ?? {}) as Record<
            string,
            unknown
          >,
        }

        if (includeAssets) {
          const characterIds: string[] = []
          const objectIds: string[] = []
          const locationIds: string[] = []
          for (const node of rawNodes) {
            const data = (node.data ?? {}) as Record<string, unknown>
            if (node.type === "character" && typeof data.characterDbId === "string")
              characterIds.push(data.characterDbId)
            if (node.type === "object" && typeof data.objectDbId === "string")
              objectIds.push(data.objectDbId)
            if (node.type === "location" && typeof data.locationDbId === "string")
              locationIds.push(data.locationDbId)
          }

          const [charsRes, objsRes, locsRes] = await Promise.all([
            characterIds.length > 0
              ? supabase
                  .from("characters")
                  .select(
                    "id, node_id, name, description, gender, style, base_outfit, source_image_url, expressions, poses, lighting_variations",
                  )
                  .in("id", characterIds)
                  .eq("user_id", session.userId)
              : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
            objectIds.length > 0
              ? supabase
                  .from("objects")
                  .select(
                    "id, node_id, name, description, style, source_image_url, angles, materials, variations",
                  )
                  .in("id", objectIds)
                  .eq("user_id", session.userId)
              : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
            locationIds.length > 0
              ? supabase
                  .from("locations")
                  .select(
                    "id, node_id, name, description, style, source_image_url, time_of_day, weather, angles",
                  )
                  .in("id", locationIds)
                  .eq("user_id", session.userId)
              : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
          ])
          if (charsRes.error || objsRes.error || locsRes.error) {
            const msg = (charsRes.error ?? objsRes.error ?? locsRes.error)?.message
            return err(`Error: ${msg}`)
          }

          const cv = (v: unknown): AssetVariant[] =>
            Array.isArray(v) ? (v as AssetVariant[]) : []
          result.assets = {
            characters: (charsRes.data ?? []).map((c) => {
              const r = c as Record<string, unknown>
              return {
                id: r.id as string,
                nodeId: r.node_id as string,
                name: r.name as string,
                description: (r.description ?? null) as string | null,
                gender: (r.gender ?? null) as string | null,
                style: (r.style ?? null) as string | null,
                baseOutfit: (r.base_outfit ?? null) as string | null,
                sourceImageUrl: (r.source_image_url ?? null) as string | null,
                expressions: cv(r.expressions),
                poses: cv(r.poses),
                lightingVariations: cv(r.lighting_variations),
              }
            }),
            objects: (objsRes.data ?? []).map((o) => {
              const r = o as Record<string, unknown>
              return {
                id: r.id as string,
                nodeId: r.node_id as string,
                name: r.name as string,
                description: (r.description ?? null) as string | null,
                style: (r.style ?? null) as string | null,
                sourceImageUrl: (r.source_image_url ?? null) as string | null,
                angles: cv(r.angles),
                materials: cv(r.materials),
                variations: cv(r.variations),
              }
            }),
            locations: (locsRes.data ?? []).map((l) => {
              const r = l as Record<string, unknown>
              return {
                id: r.id as string,
                nodeId: r.node_id as string,
                name: r.name as string,
                description: (r.description ?? null) as string | null,
                style: (r.style ?? null) as string | null,
                sourceImageUrl: (r.source_image_url ?? null) as string | null,
                timeOfDay: cv(r.time_of_day),
                weather: cv(r.weather),
                angles: cv(r.angles),
              }
            }),
          }
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
        const row = existing as Record<string, unknown>
        if (
          args.expected_updated_at !== undefined &&
          row.updated_at !== args.expected_updated_at
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
        const assetIdMap = new Map<string, string>()
        if (wf.assets) {
          for (const c of wf.assets.characters) {
            const { data: created, error } = await supabase
              .from("characters")
              .insert({
                user_id: session.userId,
                node_id: c.nodeId,
                project_id: mcpProjectId,
                name: c.name,
                description: c.description ?? null,
                gender: c.gender ?? null,
                style: c.style ?? null,
                base_outfit: c.baseOutfit ?? null,
                source_image_url: c.sourceImageUrl ?? null,
                expressions: c.expressions ?? [],
                poses: c.poses ?? [],
                lighting_variations: c.lightingVariations ?? [],
              })
              .select("id")
              .single()
            if (error || !created) {
              return err(`Error creating character: ${error?.message ?? "unknown"}`)
            }
            assetIdMap.set(c.id, (created as Record<string, unknown>).id as string)
          }
          for (const o of wf.assets.objects) {
            const { data: created, error } = await supabase
              .from("objects")
              .insert({
                user_id: session.userId,
                node_id: o.nodeId,
                project_id: mcpProjectId,
                name: o.name,
                description: o.description ?? null,
                style: o.style ?? null,
                source_image_url: o.sourceImageUrl ?? null,
                angles: o.angles ?? [],
                materials: o.materials ?? [],
                variations: o.variations ?? [],
              })
              .select("id")
              .single()
            if (error || !created) {
              return err(`Error creating object: ${error?.message ?? "unknown"}`)
            }
            assetIdMap.set(o.id, (created as Record<string, unknown>).id as string)
          }
          for (const l of wf.assets.locations) {
            const { data: created, error } = await supabase
              .from("locations")
              .insert({
                user_id: session.userId,
                node_id: l.nodeId,
                project_id: mcpProjectId,
                name: l.name,
                description: l.description ?? null,
                style: l.style ?? null,
                source_image_url: l.sourceImageUrl ?? null,
                time_of_day: l.timeOfDay ?? [],
                weather: l.weather ?? [],
                angles: l.angles ?? [],
              })
              .select("id")
              .single()
            if (error || !created) {
              return err(`Error creating location: ${error?.message ?? "unknown"}`)
            }
            assetIdMap.set(l.id, (created as Record<string, unknown>).id as string)
          }
        }

        // Remap entity DB-id references on nodes to the freshly-created rows.
        const remappedNodes = wf.nodes.map((node) => {
          const n = node as Record<string, unknown>
          const data = { ...((n.data ?? {}) as Record<string, unknown>) }
          for (const field of ["characterDbId", "objectDbId", "locationDbId"] as const) {
            const oldId = data[field]
            if (typeof oldId === "string" && assetIdMap.has(oldId)) {
              data[field] = assetIdMap.get(oldId)
            }
          }
          return { ...n, data }
        })

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

        const workflowName = ((wfRow as Record<string, unknown>).name as string | undefined) ?? "Workflow"

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
