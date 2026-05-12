import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { stripExportContent, type WorkflowExport } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { requireScope } from "../lib/scopes.js"

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

const updateWorkflowBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  folderId: z.string().uuid().nullable().optional(),
  nodes: z.array(z.record(z.unknown())).optional(),
  edges: z.array(z.record(z.unknown())).optional(),
  settings: z.record(z.unknown()).optional(),
  sourcePrompt: z.string().max(10000).optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
})

const exportWorkflowQuery = z.object({
  assets: z
    .string()
    .optional()
    .transform((v) => v === "true"),
})

const WORKFLOW_META_COLS =
  "id, project_id, user_id, folder_id, name, description, is_template, version, thumbnail_url, created_at, updated_at"

const WORKFLOW_FULL_COLS =
  "id, project_id, user_id, folder_id, name, description, is_template, version, thumbnail_url, source_prompt, nodes, edges, settings, created_at, updated_at"

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
  }
}

export async function workflowRoutes(app: FastifyInstance) {
  // List workflows for a project
  app.get("/v1/projects/:projectId/workflows", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "workflows:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }

    const parsed = projectIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid project ID",
        },
      })
    }

    const { projectId } = parsed.data

    const { data, error } = await supabase
      .from("workflows")
      .select(WORKFLOW_META_COLS)
      .eq("project_id", projectId)
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: (data ?? []).map(toWorkflowMeta) }
  })

  // Create workflow in a project
  app.post("/v1/projects/:projectId/workflows", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = projectIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message:
            paramsParsed.error.issues[0]?.message ?? "Invalid project ID",
        },
      })
    }

    const bodyParsed = createWorkflowBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { projectId } = paramsParsed.data
    const { name, description, folderId, nodes, edges, settings, sourcePrompt } =
      bodyParsed.data

    const { data, error } = await supabase
      .from("workflows")
      .insert({
        project_id: projectId,
        user_id: req.userId,
        name,
        description: description ?? null,
        folder_id: folderId ?? null,
        nodes: nodes ?? [],
        edges: edges ?? [],
        settings: settings ?? {},
        source_prompt: sourcePrompt ?? null,
      })
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return reply.status(201).send({ data: toWorkflowFull(data) })
  })

  // Get workflow by ID
  app.get("/v1/workflows/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = workflowIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid workflow ID",
        },
      })
    }

    const { id } = parsed.data

    const { data, error } = await supabase
      .from("workflows")
      .select(WORKFLOW_FULL_COLS)
      .eq("id", id)
      .eq("user_id", req.userId)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Workflow not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: toWorkflowFull(data) }
  })

  // Update workflow
  app.patch("/v1/workflows/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = workflowIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message:
            paramsParsed.error.issues[0]?.message ?? "Invalid workflow ID",
        },
      })
    }

    const bodyParsed = updateWorkflowBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { id } = paramsParsed.data
    const body = bodyParsed.data

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (body.name !== undefined) updates.name = body.name
    if (body.description !== undefined) updates.description = body.description
    if (body.folderId !== undefined) updates.folder_id = body.folderId
    if (body.nodes !== undefined) updates.nodes = body.nodes
    if (body.edges !== undefined) updates.edges = body.edges
    if (body.settings !== undefined) updates.settings = body.settings
    if (body.sourcePrompt !== undefined)
      updates.source_prompt = body.sourcePrompt
    if (body.thumbnailUrl !== undefined)
      updates.thumbnail_url = body.thumbnailUrl

    const { data, error } = await supabase
      .from("workflows")
      .update(updates)
      .eq("id", id)
      .eq("user_id", req.userId)
      .select(WORKFLOW_FULL_COLS)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Workflow not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { data: toWorkflowFull(data) }
  })

  // Delete workflow
  app.delete("/v1/workflows/:id", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = workflowIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid workflow ID",
        },
      })
    }

    const { id } = parsed.data

    const { error } = await supabase
      .from("workflows")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })

  // Export workflow as portable JSON bundle
  app.get("/v1/workflows/:id/export", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "workflows:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }

    const paramsParsed = workflowIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid workflow ID" } })
    }
    const queryParsed = exportWorkflowQuery.safeParse(req.query)
    if (!queryParsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid query" } })
    }

    const { id } = paramsParsed.data
    const includeAssets = queryParsed.data.assets

    const { data: wf, error } = await supabase
      .from("workflows")
      .select(WORKFLOW_FULL_COLS)
      .eq("id", id)
      .eq("user_id", req.userId)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({ error: { code: "not_found", message: "Workflow not found" } })
      }
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    const rawNodes = (wf.nodes ?? []) as Record<string, unknown>[]
    const exportNodes = includeAssets ? rawNodes : stripExportContent(rawNodes as any)

    const result: WorkflowExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      name: wf.name as string,
      nodes: exportNodes as any,
      edges: (wf.edges ?? []) as any,
      settings: (wf.settings ?? {}) as Record<string, unknown>,
    }

    if (includeAssets) {
      const characterIds: string[] = []
      const objectIds: string[] = []
      const locationIds: string[] = []

      for (const node of rawNodes) {
        const data = (node.data ?? {}) as Record<string, unknown>
        if (node.type === "character" && data.characterDbId) characterIds.push(data.characterDbId as string)
        if (node.type === "object" && data.objectDbId) objectIds.push(data.objectDbId as string)
        if (node.type === "location" && data.locationDbId) locationIds.push(data.locationDbId as string)
      }

      const [charsRes, objsRes, locsRes] = await Promise.all([
        characterIds.length > 0
          ? supabase.from("characters").select("id, node_id, name, description, gender, style, base_outfit, source_image_url, expressions, poses, lighting_variations").in("id", characterIds)
          : Promise.resolve({ data: [], error: null }),
        objectIds.length > 0
          ? supabase.from("objects").select("id, node_id, name, description, style, source_image_url, angles, materials, variations").in("id", objectIds)
          : Promise.resolve({ data: [], error: null }),
        locationIds.length > 0
          ? supabase.from("locations").select("id, node_id, name, description, style, source_image_url, time_of_day, weather, angles").in("id", locationIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      result.assets = {
        characters: (charsRes.data ?? []).map((c: any) => ({
          id: c.id, nodeId: c.node_id, name: c.name, description: c.description,
          gender: c.gender, style: c.style, baseOutfit: c.base_outfit,
          sourceImageUrl: c.source_image_url, expressions: c.expressions ?? [],
          poses: c.poses ?? [], lightingVariations: c.lighting_variations ?? [],
        })),
        objects: (objsRes.data ?? []).map((o: any) => ({
          id: o.id, nodeId: o.node_id, name: o.name, description: o.description,
          style: o.style, sourceImageUrl: o.source_image_url,
          angles: o.angles ?? [], materials: o.materials ?? [], variations: o.variations ?? [],
        })),
        locations: (locsRes.data ?? []).map((l: any) => ({
          id: l.id, nodeId: l.node_id, name: l.name, description: l.description,
          style: l.style, sourceImageUrl: l.source_image_url,
          timeOfDay: l.time_of_day ?? [], weather: l.weather ?? [], angles: l.angles ?? [],
        })),
      }
    }

    return reply.send(result)
  })

  // Run workflow — handled by workflow-execution.ts route
  // (POST /v1/workflows/:id/run is registered there)
}
