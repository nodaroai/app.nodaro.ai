import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  stripExportContent,
  validateSubWorkflowRoutes,
  type WorkflowExport,
} from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { ensureDefaultProject } from "../lib/default-project.js"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { requireScope } from "../lib/scopes.js"
import type { Scope } from "../lib/scopes.js"
import { formatZodError } from "../lib/zod-error.js"
import {
  asObjectArray,
  collectAssetIds,
  fetchExportAssets,
  reCreateAssets,
  remapNodeAssetIds,
  workflowExportSchema,
} from "../lib/workflow-assets.js"
import { migrateGenerateImageHandles } from "../lib/generate-image-handle-migration.js"

const workflowIdParams = z.object({
  id: z.string().uuid(),
})

const projectIdParams = z.object({
  projectId: z.string().uuid(),
})

const WorkflowSummary = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    projectId: z.string().uuid().nullable(),
    userId: z.string().uuid(),
    folderId: z.string().uuid().nullable().optional(),
    description: z.string().nullable().optional(),
    isTemplate: z.boolean().optional(),
    version: z.number().int().optional(),
    thumbnailUrl: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("WorkflowSummary")

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/projects/{projectId}/workflows",
  description: "List the authenticated user's workflows for a given project.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      projectId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "List of workflows",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(WorkflowSummary),
          }),
        },
      },
    },
    401: { description: "Unauthorized" },
  },
})

const createWorkflowBody = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  folderId: z.string().uuid().nullable().optional(),
  nodes: z.array(z.record(z.unknown())).optional(),
  edges: z.array(z.record(z.unknown())).optional(),
  settings: z.record(z.unknown()).optional(),
  sourcePrompt: z.string().max(10000).optional(),
})

// Project-less create. `projectId` is optional; when omitted the server
// resolves the caller's default project (lazy-creating one if needed).
const createWorkflowFlatBody = createWorkflowBody.extend({
  projectId: z.string().uuid().optional(),
})

const updateWorkflowBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  // Setting projectId moves the workflow to a different project owned by the
  // caller. folder_id is auto-cleared in that case since folders are scoped
  // to a single project (FK ON DELETE SET NULL would orphan otherwise).
  projectId: z.string().uuid().optional(),
  folderId: z.string().uuid().nullable().optional(),
  nodes: z.array(z.record(z.unknown())).optional(),
  edges: z.array(z.record(z.unknown())).optional(),
  settings: z.record(z.unknown()).optional(),
  sourcePrompt: z.string().max(10000).optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  // Optimistic concurrency token — when supplied, the row is updated
  // ONLY if its current `updated_at` matches. Mismatches return 409
  // with the actual current `updated_at` so the caller can refetch and
  // merge. Mirrors the MCP `update_workflow_json` contract; safe to
  // omit on legacy callers (last-write-wins fallback).
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
})

const listWorkflowsQuery = z.object({
  limit: z
    .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(1).max(500))
    .optional(),
})

const exportWorkflowQuery = z.object({
  assets: z
    .string()
    .optional()
    .transform((v) => v === "true"),
})

const importWorkflowBody = z.object({
  projectId: z.string().uuid(),
  workflow_json: workflowExportSchema,
})

const createSubWorkflowBody = z.object({
  name: z.string().min(1).max(200).default("Sub-workflow"),
})

const WORKFLOW_META_COLS =
  "id, project_id, user_id, folder_id, name, description, is_template, version, thumbnail_url, created_at, updated_at"

const WORKFLOW_FULL_COLS =
  "id, project_id, user_id, folder_id, name, description, is_template, version, thumbnail_url, source_prompt, nodes, edges, settings, parent_workflow_id, created_at, updated_at"

function toWorkflowMeta(row: Record<string, unknown>) {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    folderId: row.folder_id,
    name: row.name,
    description: row.description,
    isTemplate: row.is_template,
    version: row.version,
    thumbnailUrl: row.thumbnail_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toWorkflowFull(row: Record<string, unknown>) {
  return {
    ...toWorkflowMeta(row),
    sourcePrompt: row.source_prompt,
    nodes: row.nodes,
    edges: row.edges,
    settings: row.settings,
    parentWorkflowId: row.parent_workflow_id ?? null,
  }
}

// ── small response helpers ─────────────────────────────────────────────────
// All handlers return errors in `{ error: { code, message, ... } }` shape.
// These helpers keep the early-return ladders short and consistent.

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({
    error: { code: "unauthorized", message: "Authentication required" },
  })
}

function validationError(reply: FastifyReply, message: string) {
  return reply
    .status(400)
    .send({ error: { code: "validation_error", message } })
}

function internalError(reply: FastifyReply, message: string) {
  return reply
    .status(500)
    .send({ error: { code: "internal_error", message } })
}

function notFound(reply: FastifyReply, message: string) {
  return reply.status(404).send({ error: { code: "not_found", message } })
}

/**
 * Resolve the caller's userId, gate the request on a scope when an OAuth
 * developer-app token is in play, and return the userId. Returns `null` when
 * the request was already terminated by sending an auth/scope error.
 */
function authorize(
  req: FastifyRequest,
  reply: FastifyReply,
  scope?: Scope,
): string | null {
  if (!req.userId) {
    unauthorized(reply)
    return null
  }
  if (scope && req.appAuthorization) {
    const err = requireScope(req.appAuthorization.scopes, scope)
    if (err) {
      reply.status(err.statusCode).send(err.body)
      return null
    }
  }
  return req.userId
}

function parseWith<S extends z.ZodTypeAny>(
  reply: FastifyReply,
  schema: S,
  input: unknown,
  fallback: string,
): z.infer<S> | null {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  validationError(reply, parsed.error.issues[0]?.message ?? fallback)
  return null
}

/** Postgrest "no rows" code returned by `.single()`. */
const PGRST_NOT_FOUND = "PGRST116"

function checkSubWorkflowShape(
  reply: FastifyReply,
  nodes: unknown,
): boolean {
  if (!Array.isArray(nodes)) return true // nothing to validate
  const result = validateSubWorkflowRoutes(nodes as Parameters<typeof validateSubWorkflowRoutes>[0])
  if (result.ok) return true
  reply.status(400).send({
    error: {
      code: "invalid_sub_workflow",
      message: "Sub-workflow boundary nodes are not in a valid shape",
      details: result.errors,
    },
  })
  return false
}

export async function workflowRoutes(app: FastifyInstance) {
  // List workflows for a project
  app.get("/v1/projects/:projectId/workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    const params = parseWith(reply, projectIdParams, req.params, "Invalid project ID")
    if (!params) return

    const { data, error } = await supabase
      .from("workflows")
      .select(WORKFLOW_META_COLS)
      .eq("project_id", params.projectId)
      .eq("user_id", userId)
      .is("parent_workflow_id", null)
      .order("created_at", { ascending: false })

    if (error) return internalError(reply, error.message)
    return { data: (data ?? []).map(toWorkflowMeta) }
  })

  // Create workflow in a project
  app.post("/v1/projects/:projectId/workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const params = parseWith(reply, projectIdParams, req.params, "Invalid project ID")
    if (!params) return

    const body = parseWith(reply, createWorkflowBody, req.body, "Invalid request")
    if (!body) return

    if (body.nodes && !checkSubWorkflowShape(reply, body.nodes)) return

    if (body.nodes && body.edges) {
      body.edges = migrateGenerateImageHandles(
        body.nodes as unknown as ReadonlyArray<{ id: string; type?: string }>,
        body.edges as unknown as ReadonlyArray<{ id: string; source: string; target: string; targetHandle?: string | null }>,
      ) as unknown as typeof body.edges
    }

    const { data, error } = await supabase
      .from("workflows")
      .insert({
        project_id: params.projectId,
        user_id: userId,
        name: body.name,
        description: body.description ?? null,
        folder_id: body.folderId ?? null,
        nodes: body.nodes ?? [],
        edges: body.edges ?? [],
        settings: body.settings ?? {},
        source_prompt: body.sourcePrompt ?? null,
      })
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (error) return internalError(reply, error.message)
    return reply.status(201).send({ data: toWorkflowFull(data) })
  })

  // List ALL workflows owned by the caller, across every project. Used by
  // the SDK / CLI / MCP for a flat view; the frontend's "My Workflows" tab
  // hits Supabase directly for one fewer hop.
  app.get("/v1/workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    const query = parseWith(reply, listWorkflowsQuery, req.query ?? {}, "Invalid query")
    if (!query) return
    const limit = query.limit ?? 100

    const { data, error } = await supabase
      .from("workflows")
      .select(WORKFLOW_META_COLS)
      .eq("user_id", userId)
      .is("parent_workflow_id", null)
      .order("updated_at", { ascending: false })
      .limit(limit)

    if (error) return internalError(reply, error.message)
    return { data: (data ?? []).map(toWorkflowMeta) }
  })

  // Project-less workflow create. Body.projectId is optional — when omitted
  // the workflow lands in the caller's default project (lazy-created if it
  // does not yet exist). Powers the dashboard "+ New Workflow" quick-create.
  app.post("/v1/workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const body = parseWith(reply, createWorkflowFlatBody, req.body ?? {}, "Invalid request")
    if (!body) return

    if (body.nodes && !checkSubWorkflowShape(reply, body.nodes)) return

    if (body.nodes && body.edges) {
      body.edges = migrateGenerateImageHandles(
        body.nodes as unknown as ReadonlyArray<{ id: string; type?: string }>,
        body.edges as unknown as ReadonlyArray<{ id: string; source: string; target: string; targetHandle?: string | null }>,
      ) as unknown as typeof body.edges
    }

    let projectId = body.projectId

    if (projectId) {
      // Caller specified a project — verify ownership before insert.
      const { data: proj, error: projErr } = await supabase
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("user_id", userId)
        .maybeSingle()
      if (projErr) return internalError(reply, projErr.message)
      if (!proj) return notFound(reply, "Project not found")
    } else {
      // Resolve / lazy-create the default project.
      const resolved = await ensureDefaultProject(userId)
      if ("error" in resolved) return internalError(reply, resolved.error)
      projectId = resolved.projectId
    }

    const { data, error } = await supabase
      .from("workflows")
      .insert({
        project_id: projectId,
        user_id: userId,
        name: body.name,
        description: body.description ?? null,
        folder_id: body.folderId ?? null,
        nodes: body.nodes ?? [],
        edges: body.edges ?? [],
        settings: body.settings ?? {},
        source_prompt: body.sourcePrompt ?? null,
      })
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (error) return internalError(reply, error.message)
    return reply.status(201).send({ data: toWorkflowFull(data) })
  })

  // Get workflow by ID
  app.get("/v1/workflows/:id", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const { data, error } = await supabase
      .from("workflows")
      .select(WORKFLOW_FULL_COLS)
      .eq("id", params.id)
      .eq("user_id", userId)
      .single()

    if (error) {
      if (error.code === PGRST_NOT_FOUND) return notFound(reply, "Workflow not found")
      return internalError(reply, error.message)
    }
    return { data: toWorkflowFull(data) }
  })

  // Public (share-by-link) read — NO auth (listed in auth.ts PUBLIC_ROUTES).
  // OPT-IN ONLY: returns a workflow solely when its owner explicitly shared it
  // (`settings.studio.shared === true`), and only a TRIMMED projection (no
  // user_id / project_id / owner PII). Powers studio.nodaro.ai's read-only
  // `/example/:id` viewer. An unshared or missing id 404s identically (no
  // existence oracle). NOT user-scoped by design — sharing is by unguessable id.
  app.get("/v1/public/workflows/:id", async (req, reply) => {
    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const { data, error } = await supabase
      // tenant-scope-ignore: public share-by-link read, gated by the opt-in settings.studio.shared flag verified below (cross-tenant by design; a 404 hides unshared + missing alike)
      .from("workflows")
      .select(WORKFLOW_FULL_COLS)
      .eq("id", params.id)
      .single()

    if (error) {
      if (error.code === PGRST_NOT_FOUND) return notFound(reply, "Workflow not found")
      return internalError(reply, error.message)
    }

    const full = toWorkflowFull(data)
    const settings = full.settings as { studio?: { shared?: unknown } } | null | undefined
    if (settings?.studio?.shared !== true) {
      // Not shared → indistinguishable from not-found (don't leak existence).
      return notFound(reply, "Workflow not found")
    }

    // Trimmed public projection — only what the read-only viewer renders.
    return {
      data: {
        id: full.id,
        name: full.name,
        thumbnailUrl: full.thumbnailUrl,
        nodes: full.nodes,
        edges: full.edges,
        settings: full.settings,
      },
    }
  })

  // Update workflow
  app.patch("/v1/workflows/:id", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const body = parseWith(reply, updateWorkflowBody, req.body, "Invalid request")
    if (!body) return

    if (body.nodes && !checkSubWorkflowShape(reply, body.nodes)) return

    if (body.nodes && body.edges) {
      body.edges = migrateGenerateImageHandles(
        body.nodes as unknown as ReadonlyArray<{ id: string; type?: string }>,
        body.edges as unknown as ReadonlyArray<{ id: string; source: string; target: string; targetHandle?: string | null }>,
      ) as unknown as typeof body.edges
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.folderId !== undefined) updates.folder_id = body.folderId
    if (body.nodes !== undefined) updates.nodes = body.nodes
    if (body.edges !== undefined) updates.edges = body.edges
    if (body.settings !== undefined) updates.settings = body.settings
    if (body.sourcePrompt !== undefined) updates.source_prompt = body.sourcePrompt
    if (body.thumbnailUrl !== undefined) updates.thumbnail_url = body.thumbnailUrl

    // Cross-project move — verify caller owns the target project, then null
    // out folder_id (folders are project-scoped; a stale id would orphan).
    // An explicit folderId in the same request takes precedence and is
    // validated against the new project below by the FK.
    if (body.projectId !== undefined) {
      const { data: targetProject, error: targetErr } = await supabase
        .from("projects")
        .select("id")
        .eq("id", body.projectId)
        .eq("user_id", userId)
        .maybeSingle()
      if (targetErr) return internalError(reply, targetErr.message)
      if (!targetProject) return notFound(reply, "Project not found")
      updates.project_id = body.projectId
      if (body.folderId === undefined) updates.folder_id = null
    }

    let updateQuery = supabase
      .from("workflows")
      .update(updates)
      .eq("id", params.id)
      .eq("user_id", userId)
    if (body.expectedUpdatedAt) {
      updateQuery = updateQuery.eq("updated_at", body.expectedUpdatedAt)
    }

    const { data, error } = await updateQuery
      .select(WORKFLOW_FULL_COLS)
      .maybeSingle()

    // `.maybeSingle()` returns `{ data: null, error: null }` on 0 rows
    // (no PGRST116 to special-case). Any non-null error here is a real
    // DB failure — surface as 500.
    if (error) return internalError(reply, error.message)
    if (!data) {
      // 0 rows matched. If the caller opted into optimistic concurrency,
      // the row exists but `updated_at` shifted (another tab/device wrote
      // first) — return 409 with the current `updated_at` so the caller
      // can refetch + merge. If the caller did NOT supply
      // expectedUpdatedAt, the row truly doesn't exist (or isn't owned).
      if (body.expectedUpdatedAt) {
        const { data: current } = await supabase
          .from("workflows")
          .select("updated_at")
          .eq("id", params.id)
          .eq("user_id", userId)
          .maybeSingle()
        if (current?.updated_at) {
          return reply.status(409).send({
            error: {
              code: "workflow_conflict",
              message: "Workflow was updated by another writer",
              currentUpdatedAt: current.updated_at,
            },
          })
        }
      }
      return notFound(reply, "Workflow not found")
    }
    return { data: toWorkflowFull(data) }
  })

  // Delete workflow
  app.delete("/v1/workflows/:id", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const { error } = await supabase
      .from("workflows")
      .delete()
      .eq("id", params.id)
      .eq("user_id", userId)

    if (error) return internalError(reply, error.message)
    return { success: true }
  })

  // Export workflow as portable JSON bundle
  app.get("/v1/workflows/:id/export", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    const params = parseWith(reply, workflowIdParams, req.params, "Invalid workflow ID")
    if (!params) return

    const query = parseWith(reply, exportWorkflowQuery, req.query, "Invalid query")
    if (!query) return
    const includeAssets = query.assets

    const { data: wf, error } = await supabase
      .from("workflows")
      .select(WORKFLOW_FULL_COLS)
      .eq("id", params.id)
      .eq("user_id", userId)
      .single()

    if (error) {
      if (error.code === PGRST_NOT_FOUND) return notFound(reply, "Workflow not found")
      return internalError(reply, error.message)
    }

    const rawNodes = asObjectArray(wf.nodes)
    const result: WorkflowExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      name: wf.name as string,
      nodes: (includeAssets ? rawNodes : stripExportContent(rawNodes as any)) as any,
      edges: (wf.edges ?? []) as any,
      settings: (wf.settings ?? {}) as Record<string, unknown>,
    }

    if (includeAssets) {
      const ids = collectAssetIds(rawNodes)
      const assetsResult = await fetchExportAssets(ids, userId)
      if ("error" in assetsResult) return internalError(reply, assetsResult.error)
      result.assets = assetsResult
    }

    return reply.send(result)
  })

  // Import a workflow from a portable JSON bundle, re-creating bundled assets
  // (characters, objects, locations) under the caller's account.
  app.post("/v1/workflows/import", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const parsed = importWorkflowBody.safeParse(req.body)
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }

    const { projectId, workflow_json: wf } = parsed.data

    const { data: project, error: projError } = await supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single()

    if (projError || !project) return notFound(reply, "Project not found")

    // Re-create bundled assets, mapping old DB id → new DB id (node_id preserved).
    let assetIdMap: ReadonlyMap<string, string> = new Map()
    if (wf.assets) {
      const result = await reCreateAssets(wf.assets, userId, projectId)
      if (result instanceof Map) {
        assetIdMap = result
      } else {
        return internalError(reply, result.error.message)
      }
    }

    const remappedNodes = remapNodeAssetIds(wf.nodes, assetIdMap)

    const migratedEdges = migrateGenerateImageHandles(
      remappedNodes as Array<{ id: string; type?: string }>,
      (wf.edges ?? []) as Array<{ id: string; source: string; target: string; sourceHandle: string | null; targetHandle: string | null }>,
    )

    const { data: newWorkflow, error: wfError } = await supabase
      .from("workflows")
      .insert({
        project_id: projectId,
        user_id: userId,
        name: wf.name,
        nodes: remappedNodes,
        edges: migratedEdges,
        settings: wf.settings ?? {},
      })
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (wfError || !newWorkflow) {
      return internalError(reply, wfError?.message ?? "Failed to create workflow")
    }

    return reply
      .status(201)
      .send({ data: toWorkflowFull(newWorkflow as Record<string, unknown>) })
  })

  // Create a child sub-workflow under a parent
  app.post("/v1/workflows/:parentId/sub-workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return

    const params = parseWith(
      reply,
      z.object({ parentId: z.string().uuid() }),
      req.params,
      "Invalid parent workflow ID",
    )
    if (!params) return

    const body = parseWith(reply, createSubWorkflowBody, req.body ?? {}, "Invalid request")
    if (!body) return

    // 1. Verify caller owns the parent + grab its project_id
    const { data: parent, error: parentErr } = await supabase
      .from("workflows")
      .select("id, project_id, user_id")
      .eq("id", params.parentId)
      .eq("user_id", userId)
      .single()

    if (parentErr || !parent) return notFound(reply, "Parent workflow not found")

    // 2. Seed a default route — one input + one output sharing a routeId
    const routeId = crypto.randomUUID()
    const seededNodes = [
      {
        id: `input_${routeId}`,
        type: "sub-workflow-input",
        position: { x: 100, y: 200 },
        data: {
          label: "Inputs",
          routeId,
          ports: [{ id: "in_1", name: "input", mediaType: "any" }],
        },
      },
      {
        id: `output_${routeId}`,
        type: "sub-workflow-output",
        position: { x: 900, y: 200 },
        data: {
          label: "Outputs",
          routeId,
          ports: [{ id: "out_1", name: "output", mediaType: "any" }],
          visibleOutputPortId: "out_1",
        },
      },
    ]

    const { data: child, error: childErr } = await supabase
      .from("workflows")
      .insert({
        project_id: parent.project_id,
        user_id: userId,
        parent_workflow_id: parent.id,
        name: body.name,
        nodes: seededNodes,
        edges: [],
        settings: {},
      })
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (childErr) return internalError(reply, childErr.message)

    return reply.status(201).send({ data: toWorkflowFull(child) })
  })

  // Run workflow — handled by workflow-execution.ts route
  // (POST /v1/workflows/:id/run is registered there)
}
