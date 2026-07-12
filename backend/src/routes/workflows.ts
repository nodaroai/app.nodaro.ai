import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { stripExportContent, stripTransientRuntimeData, validateSubWorkflowRoutes, type WorkflowExport } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { ensureDefaultProject } from "../lib/default-project.js"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { requireScope } from "../lib/scopes.js"
import type { Scope } from "../lib/scopes.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
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
  nodes: z.array(z.record(z.string(), z.unknown())).optional(),
  edges: z.array(z.record(z.string(), z.unknown())).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  sourcePrompt: z.string().max(10000).optional(),
})

// Project-less create. `projectId` is optional; when omitted the server
// resolves the caller's default project (lazy-creating one if needed).
/**
 * Studio's slug in `client_apps`. The only slug the platform names directly
 * (it has a dedicated dashboard tab + the legacy `?studio=true` param); every
 * other client app is handled generically through the registry.
 */
const STUDIO_APP_SLUG = "studio"

const createWorkflowFlatBody = createWorkflowBody.extend({
  projectId: z.string().uuid().optional(),
  // Which client app is creating this workflow (SDK callers: 'studio',
  // 'voice-changer-pro', …). Omitted = native, created in app.nodaro.ai itself.
  // Validated against the client_apps registry below — an unknown slug is a 400,
  // never a silently-unclassified row.
  appSlug: z.string().min(1).max(64).optional(),
})

const updateWorkflowBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  // Setting projectId moves the workflow to a different project owned by the
  // caller. folder_id is auto-cleared in that case since folders are scoped
  // to a single project (FK ON DELETE SET NULL would orphan otherwise).
  projectId: z.string().uuid().optional(),
  folderId: z.string().uuid().nullable().optional(),
  nodes: z.array(z.record(z.string(), z.unknown())).optional(),
  edges: z.array(z.record(z.string(), z.unknown())).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  sourcePrompt: z.string().max(10000).optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
  // Optimistic concurrency token — when supplied, the row is updated
  // ONLY if its current `updated_at` matches. Mismatches return 409
  // with the actual current `updated_at` so the caller can refetch and
  // merge. Mirrors the MCP `update_workflow_json` contract; safe to
  // omit on legacy callers (last-write-wins fallback).
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  // Integer CAS against workflows.version (bumped by DB trigger on every
  // content change — migration 218). Preferred over expectedUpdatedAt:
  // monotonic, precision-proof, tamper-proof.
  expectedVersion: z.number().int().min(1).optional(),
  // Delta-save protocol (P3, migration 219): id-keyed whole-node/edge delta
  // applied atomically against baseVersion by apply_workflow_delta. Mutually
  // exclusive with every full-body content field above.
  delta: z
    .object({
      baseVersion: z.number().int().min(1),
      upsertNodes: z.array(z.record(z.string(), z.unknown())).optional(),
      deleteNodeIds: z.array(z.string()).optional(),
      upsertEdges: z.array(z.record(z.string(), z.unknown())).optional(),
      deleteEdgeIds: z.array(z.string()).optional(),
      set: z
        .object({
          name: z.string().min(1).max(200).optional(),
          settings: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
    })
    .optional(),
})

/** ids of an upsert array; null when any element lacks a string id. */
function deltaIds(arr: ReadonlyArray<Record<string, unknown>> | undefined): string[] | null {
  if (!arr) return []
  const ids: string[] = []
  for (const item of arr) {
    if (typeof item.id !== "string" || item.id.length === 0) return null
    ids.push(item.id)
  }
  return ids
}

const listWorkflowsQuery = z.object({
  limit: z
    .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(1).max(500))
    .optional(),
  // Admin-only: return every user's workflows (mirrors GET /v1/projects?viewAll=true).
  viewAll: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  // Scope the list to one client app's workflows (workflows.app_slug).
  app: z.string().min(1).max(64).optional(),
  // Legacy alias for `?app=studio`, kept so existing callers (the dashboard's
  // "Studio Workflows" tab) keep working. Resolved into `app` below.
  studio: z
    .string()
    .optional()
    .transform((v) => v === "true"),
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
  "id, project_id, user_id, folder_id, name, description, is_template, version, thumbnail_url, source_prompt, nodes, edges, settings, parent_workflow_id, app_slug, created_at, updated_at"

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
    // Client app that created this workflow; null = native. Lets an SDK caller
    // read back the classification it asked for.
    appSlug: row.app_slug ?? null,
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

function notFound(reply: FastifyReply, message: string) {
  return reply.status(404).send({ error: { code: "not_found", message } })
}

/**
 * Verify an `appSlug` exists in the `client_apps` registry.
 *
 * Unknown slugs are rejected at write time (400) rather than stored: a row whose
 * app is unregistered would be invisible everywhere (the workflow-list rule
 * fails closed on unknown slugs), so silently accepting one would hand the
 * caller a workflow they can never see. Better to tell them immediately. The DB
 * has the same FK constraint; this turns its 500 into an actionable 400.
 */
async function clientAppExists(slug: string): Promise<{ ok: boolean; error?: unknown }> {
  const { data, error } = await supabase
    .from("client_apps")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle()
  if (error) return { ok: false, error }
  return { ok: data !== null }
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

    if (error) return sendInternalError(reply, req, error, "Failed to fetch workflows")
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

    if (error) return sendInternalError(reply, req, error, "Failed to create workflow")
    return reply.status(201).send({ data: toWorkflowFull(data) })
  })

  // List ALL workflows owned by the caller, across every project. Used by
  // the SDK / CLI / MCP for a flat view; the frontend's "My Workflows" tab
  // hits Supabase directly for one fewer hop.
  //
  // `?app=<slug>` scopes the list to one client app's workflows (`?studio=true`
  // is a legacy alias for `?app=studio`).
  //
  // DO NOT CHANGE THE DEFAULT. With no `app` param this returns EVERYTHING the
  // caller owns, native and client-app rows alike. voice-changer-pro lists its
  // own conversions through exactly this call with no param — making the default
  // "native only" (to mirror the dashboard's visibility rule) would blank vcp's
  // conversion list in production the moment it deployed. That flip is Phase 2
  // and is gated on an SDK release that sends `?app=voice-changer-pro`. Until
  // every deployed client passes its slug, the default stays permissive.
  app.get("/v1/workflows", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return

    const query = parseWith(reply, listWorkflowsQuery, req.query ?? {}, "Invalid query")
    if (!query) return
    const limit = query.limit ?? (query.viewAll ? 500 : 100)

    // `?studio=true` is the legacy spelling of `?app=studio`; an explicit `?app=`
    // wins if both are somehow sent.
    const appSlug = query.app ?? (query.studio ? STUDIO_APP_SLUG : undefined)

    // Admin "All users" view — mirrors GET /v1/projects?viewAll=true. Returns
    // every user's top-level workflows (optionally scoped to one client app)
    // with owner emails. Powers the dashboard "Studio Workflows" tab when an
    // admin flips the "All users" switch.
    if (query.viewAll) {
      const isAdmin = await checkIsAdmin(userId)
      if (!isAdmin) {
        return reply.status(403).send({
          error: { code: "forbidden", message: "Admin access required" },
        })
      }

      let allQuery = supabase
        // tenant-scope-ignore: deliberate cross-tenant read, admin-gated above.
        .from("workflows")
        .select(WORKFLOW_META_COLS)
        .is("parent_workflow_id", null)
        .order("updated_at", { ascending: false })
        .limit(limit)
      if (appSlug) {
        allQuery = allQuery.eq("app_slug", appSlug)
      }
      const { data, error } = await allQuery
      if (error) return sendInternalError(reply, req, error, "Failed to fetch workflows")

      const rows = data ?? []
      const ownerIds = [...new Set(rows.map((r) => r.user_id as string))]
      const emailMap = new Map<string, string>()
      if (ownerIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", ownerIds)
        for (const p of profiles ?? []) {
          emailMap.set(p.id as string, p.email as string)
        }
      }

      return {
        data: rows.map((row) => ({
          ...toWorkflowMeta(row),
          ownerEmail: emailMap.get(row.user_id as string) ?? "Unknown",
        })),
        currentUserId: userId,
      }
    }

    let listQuery = supabase
      .from("workflows")
      .select(WORKFLOW_META_COLS)
      .eq("user_id", userId)
      .is("parent_workflow_id", null)
      .order("updated_at", { ascending: false })
      .limit(limit)
    if (appSlug) {
      listQuery = listQuery.eq("app_slug", appSlug)
    }
    const { data, error } = await listQuery

    if (error) return sendInternalError(reply, req, error, "Failed to fetch workflows")
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

    // Classify the row's origin. An unregistered slug is rejected here rather
    // than persisted — see clientAppExists.
    if (body.appSlug) {
      const app = await clientAppExists(body.appSlug)
      if (app.error) return sendInternalError(reply, req, app.error, "Failed to create workflow")
      if (!app.ok) {
        return validationError(
          reply,
          `Unknown appSlug '${body.appSlug}'. Register the app in client_apps first.`,
        )
      }
    }

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
      if (projErr) return sendInternalError(reply, req, projErr, "Failed to create workflow")
      if (!proj) return notFound(reply, "Project not found")
    } else {
      // Resolve / lazy-create the default project.
      const resolved = await ensureDefaultProject(userId)
      if ("error" in resolved) return sendInternalError(reply, req, resolved.error, "Failed to create workflow")
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
        // NULL = native (created in app.nodaro.ai itself).
        app_slug: body.appSlug ?? null,
      })
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (error) return sendInternalError(reply, req, error, "Failed to create workflow")
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
      return sendInternalError(reply, req, error, "Failed to fetch workflow")
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
      return sendInternalError(reply, req, error, "Failed to fetch workflow")
    }

    const full = toWorkflowFull(data)
    const settings = full.settings as { studio?: { shared?: unknown } } | null | undefined
    // NOTE: this is NOT the origin signal that `workflows.app_slug` replaced.
    // `settings.studio.shared` is a PER-ROW opt-in the owner sets to publish one
    // workflow by link — a fact neither `app_slug` (per-row origin) nor
    // `client_apps.workflows_listed` (per-app) can express. Do not "finish the
    // migration" by deleting this check: without it every workflow in the
    // database becomes readable by id, with no auth.
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

    if (body.delta) {
      // Mutually exclusive with full-body fields — a mixed request is
      // ambiguous about which representation wins.
      const mixed =
        body.nodes !== undefined || body.edges !== undefined || body.settings !== undefined ||
        body.name !== undefined || body.description !== undefined || body.folderId !== undefined ||
        body.projectId !== undefined || body.sourcePrompt !== undefined ||
        body.thumbnailUrl !== undefined || body.expectedUpdatedAt !== undefined ||
        body.expectedVersion !== undefined
      if (mixed) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "delta is mutually exclusive with full-body fields" },
        })
      }
      const upsertNodeIds = deltaIds(body.delta.upsertNodes)
      const upsertEdgeIds = deltaIds(body.delta.upsertEdges)
      if (!upsertNodeIds || !upsertEdgeIds) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "every delta upsert needs a non-empty string id" },
        })
      }
      const dupNode = upsertNodeIds.length !== new Set(upsertNodeIds).size
      const dupEdge = upsertEdgeIds.length !== new Set(upsertEdgeIds).size
      const nodeOverlap = (body.delta.deleteNodeIds ?? []).some((id) => upsertNodeIds.includes(id))
      const edgeOverlap = (body.delta.deleteEdgeIds ?? []).some((id) => upsertEdgeIds.includes(id))
      if (dupNode || dupEdge || nodeOverlap || edgeOverlap) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "delta ids must be unique and delete/upsert sets disjoint" },
        })
      }

      // NOTE: sub-workflow route validation needs the FULL graph and is not
      // possible on a partial delta — the editor maintains the invariant
      // client-side, and the full-save path keeps the server-side check.
      const { data: rpcData, error: rpcError } = await supabase.rpc("apply_workflow_delta", {
        p_workflow_id: params.id,
        p_base_version: body.delta.baseVersion,
        // Server-side strip mirrors the full-body path: transient run-state
        // never persists, whichever protocol carries the nodes.
        p_upsert_nodes: stripTransientRuntimeData(
          (body.delta.upsertNodes ?? []) as Array<{ data?: Record<string, unknown> }>,
        ),
        p_delete_node_ids: body.delta.deleteNodeIds ?? [],
        p_upsert_edges: body.delta.upsertEdges ?? [],
        p_delete_edge_ids: body.delta.deleteEdgeIds ?? [],
        p_set: body.delta.set ?? null,
        p_user_id: userId,
      })
      if (rpcError) return sendInternalError(reply, req, rpcError, "Failed to update workflow")
      const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
        | { ok: boolean; version: number | null; updated_at: string | null }
        | undefined
      if (!row) return sendInternalError(reply, req, "apply_workflow_delta returned no row", "Failed to update workflow")
      if (!row.ok) {
        if (row.version == null) return notFound(reply, "Workflow not found")
        return reply.status(409).send({
          error: {
            code: "workflow_conflict",
            message: "Workflow was updated by another writer",
            currentVersion: row.version,
            currentUpdatedAt: row.updated_at,
          },
        })
      }
      return { data: { id: params.id, version: row.version, updatedAt: row.updated_at } }
    }

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
    if (body.nodes !== undefined) {
      // Server-side strip of transient run-state (status/jobId/progress):
      // pre-P0 clients still send it, and persisted phantom "running" state
      // is what seeded false cross-tab conflicts. Results stay untouched.
      updates.nodes = stripTransientRuntimeData(body.nodes as Array<{ data?: Record<string, unknown> }>)
    }
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
      if (targetErr) return sendInternalError(reply, req, targetErr, "Failed to update workflow")
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
    if (body.expectedVersion !== undefined) {
      updateQuery = updateQuery.eq("version", body.expectedVersion)
    }

    const { data, error } = await updateQuery
      .select(WORKFLOW_FULL_COLS)
      .maybeSingle()

    // `.maybeSingle()` returns `{ data: null, error: null }` on 0 rows
    // (no PGRST116 to special-case). Any non-null error here is a real
    // DB failure — surface as 500.
    if (error) return sendInternalError(reply, req, error, "Failed to update workflow")
    if (!data) {
      // 0 rows matched. If the caller opted into optimistic concurrency,
      // the row exists but `updated_at` shifted (another tab/device wrote
      // first) — return 409 with the current `updated_at` so the caller
      // can refetch + merge. If the caller did NOT supply
      // expectedUpdatedAt, the row truly doesn't exist (or isn't owned).
      if (body.expectedUpdatedAt || body.expectedVersion !== undefined) {
        const { data: current } = await supabase
          .from("workflows")
          .select("updated_at, version")
          .eq("id", params.id)
          .eq("user_id", userId)
          .maybeSingle()
        if (current?.updated_at) {
          return reply.status(409).send({
            error: {
              code: "workflow_conflict",
              message: "Workflow was updated by another writer",
              currentUpdatedAt: current.updated_at,
              currentVersion: (current as { version?: number }).version,
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

    if (error) return sendInternalError(reply, req, error, "Failed to delete workflow")
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
      return sendInternalError(reply, req, error, "Failed to export workflow")
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
      if ("error" in assetsResult) return sendInternalError(reply, req, assetsResult.error, "Failed to export workflow")
      result.assets = assetsResult
    }

    return reply.send(result)
  })

  // Import a workflow from a portable JSON bundle, re-creating bundled assets
  // (characters, objects, creatures, locations) under the caller's account.
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
        return sendInternalError(reply, req, result.error, "Failed to import workflow")
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
      return sendInternalError(reply, req, wfError, "Failed to create workflow")
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

    if (childErr) return sendInternalError(reply, req, childErr, "Failed to create sub-workflow")

    return reply.status(201).send({ data: toWorkflowFull(child) })
  })

  // Run workflow — handled by workflow-execution.ts route
  // (POST /v1/workflows/:id/run is registered there)
}
