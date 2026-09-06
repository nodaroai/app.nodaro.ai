import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import {
  toProductionSummary,
  toProductionView,
  type ViewableWorkflow,
} from "@nodaro/studio-production"
import type {
  StudioListProductionsResponse,
  StudioPlanIssue,
  StudioProductionView,
} from "@nodaro/shared"

import { sendInternalError } from "../lib/http-errors.js"
import { requireScope, type Scope } from "../lib/scopes.js"
import { supabase } from "../lib/supabase.js"
import {
  loadWorkflowFor,
  WORKFLOW_ACCESS_COLS,
} from "../lib/workflow-route-access.js"
import { mentionCandidatesFor } from "../lib/studio-productions/candidates.js"
import {
  landPlan,
  serializeAppend,
  serializeCreate,
} from "../lib/studio-productions/land-plan.js"
import { ensureStudioProject } from "../lib/studio-productions/project.js"
import { studioProductionSkill } from "../lib/studio-productions/skill.js"
import { validatePlan } from "../lib/studio-productions/validate.js"

/**
 * `/v1/studio/productions` — the platform as the studio production's reader and
 * writer.
 *
 * A production is a workflow whose `settings.studio` holds the shots, and until
 * now the only code that could read that document ran in a browser tab. These
 * routes run the SAME codec (`@nodaro/studio-production`) server-side, so an
 * agent, the studio app and the copilot all see one production rather than
 * three opinions about one row.
 *
 * Phase 0 lands the read half plus the two ways a production comes into
 * existence: the skill an author reads, the free validation loop, the list, the
 * create-from-plan, and the get. Editing, generating and sharing arrive with
 * their own routes.
 *
 * Every route is owner-checked through `loadWorkflowFor`, which answers 404 —
 * never 403 — to a caller who cannot see the row, so an id cannot be probed.
 */

// ── request schemas ────────────────────────────────────────────────────────

const productionIdParams = z.object({ id: z.string().uuid("Invalid production ID") })

const planBody = z.object({
  plan: z.record(z.string(), z.unknown()),
})

const listQuery = z.object({
  limit: z
    .preprocess(
      (v) => (typeof v === "string" ? Number(v) : v),
      z.number().int().min(1).max(100),
    )
    .optional(),
  cursor: z.string().optional(),
  /** Include the rows the dashboard hides. Off by default — see D12. */
  includeArchived: z
    .string()
    .optional()
    .transform((v) => v === "true"),
})

const getQuery = z.object({
  detail: z.enum(["summary", "full"]).optional(),
  shot_id: z.string().optional(),
})

const createBody = z.object({
  name: z.string().min(1).max(200).optional(),
  plan: z.record(z.string(), z.unknown()).optional(),
})

const importBody = z.object({
  plan: z.record(z.string(), z.unknown()),
  mode: z.literal("append").optional(),
})

// ── small shared helpers (the same shapes routes/workflows.ts uses) ─────────

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({
    error: { code: "unauthorized", message: "Authentication required" },
  })
}

function validationError(reply: FastifyReply, message: string, path?: string) {
  return reply.status(400).send({
    error: { code: "validation_error", message, ...(path ? { path } : {}) },
  })
}

function notFound(reply: FastifyReply) {
  return reply
    .status(404)
    .send({ error: { code: "not_found", message: "Production not found" } })
}

function authorize(req: FastifyRequest, reply: FastifyReply, scope?: Scope): string | null {
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

/**
 * The columns a production read needs.
 *
 * `WORKFLOW_ACCESS_COLS` is not optional decoration: `toAccessRow` THROWS when
 * one of the four is missing, deliberately, because `row.workspace_id ?? null`
 * on a column nobody selected would read as "this is personal" — the permissive
 * answer, invented from an absence.
 */
const PRODUCTION_COLS = `${WORKFLOW_ACCESS_COLS}, name, thumbnail_url, version, nodes, edges, settings, updated_at`
const SUMMARY_COLS = `${WORKFLOW_ACCESS_COLS}, name, thumbnail_url, version, settings, updated_at`

/** A workflow row as the codec wants it. */
function asViewable(row: Record<string, unknown>): ViewableWorkflow {
  return {
    id: row.id as string,
    name: (row.name as string) ?? "",
    version: (row.version as number) ?? 1,
    updatedAt: (row.updated_at as string) ?? new Date(0).toISOString(),
    thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
    nodes: (row.nodes as ViewableWorkflow["nodes"]) ?? [],
    edges: (row.edges as ViewableWorkflow["edges"]) ?? [],
    settings: (row.settings as Record<string, unknown>) ?? {},
  }
}

/** Is this workflow a studio production at all? */
function isProduction(row: Record<string, unknown>): boolean {
  const settings = row.settings as { studio?: unknown } | null | undefined
  return !!settings && typeof settings === "object" && settings.studio !== undefined
}

export async function studioProductionRoutes(app: FastifyInstance): Promise<void> {
  // ── the skill (ungated: reading the format costs nothing and is the first
  //    thing any author needs) ───────────────────────────────────────────────
  app.get("/v1/studio/productions/skill", async (req, reply) => {
    const userId = authorize(req, reply)
    if (!userId) return
    return { data: studioProductionSkill() }
  })

  // ── validate: free, persists nothing, resolves against the caller's library ─
  app.post("/v1/studio/productions/validate", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return
    const body = parseWith(reply, planBody, req.body ?? {}, "Invalid plan")
    if (!body) return

    try {
      const candidates = await mentionCandidatesFor(userId)
      return { data: validatePlan(body.plan, candidates) }
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to validate plan")
    }
  })

  // ── list: the caller's own Studio project ──────────────────────────────────
  app.get("/v1/studio/productions", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return
    const query = parseWith(reply, listQuery, req.query ?? {}, "Invalid query")
    if (!query) return

    const limit = query.limit ?? 25
    try {
      const projectId = await ensureStudioProject(userId)
      let q = supabase
        .from("workflows")
        .select(SUMMARY_COLS)
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        // One extra row decides whether there is a next page without a count.
        .limit(limit + 1)
      if (query.cursor) q = q.lt("updated_at", query.cursor)

      const { data, error } = await q
      if (error) return sendInternalError(reply, req, error, "Failed to list productions")

      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
      const summaries = rows
        .filter(isProduction)
        .map((row) => toProductionSummary(asViewable(row)))
        // Archived is a SOFT HIDE the dashboard honours; an agent that listed
        // them would resurrect rows the user deliberately put away (D12).
        .filter((s) => query.includeArchived || !s.archived)

      const page = summaries.slice(0, limit)
      const body: StudioListProductionsResponse = {
        data: page,
        ...(summaries.length > limit && page.length > 0
          ? { nextCursor: page[page.length - 1].updatedAt }
          : {}),
      }
      return { data: body }
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to list productions")
    }
  })

  // ── create, optionally from a plan ─────────────────────────────────────────
  app.post("/v1/studio/productions", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return
    const body = parseWith(reply, createBody, req.body ?? {}, "Invalid request")
    if (!body) return

    try {
      const landed = body.plan
        ? landPlan(body.plan, {
            candidates: await mentionCandidatesFor(userId),
            fallbackName: body.name,
          })
        : undefined
      if (landed && !landed.ok) return validationError(reply, landed.error, landed.path)

      const projectId = await ensureStudioProject(userId)
      const graph = landed?.ok ? serializeCreate(landed) : undefined
      const { data, error } = await supabase
        .from("workflows")
        .insert({
          project_id: projectId,
          user_id: userId,
          name: landed?.name ?? body.name?.trim() ?? "Untitled production",
          nodes: graph?.nodes ?? [],
          edges: graph?.edges ?? [],
          // An empty production still carries `settings.studio`: it is what
          // makes the row a PRODUCTION rather than a bare workflow, and what
          // the `app_slug` inference reads.
          settings: graph?.settings ?? { studio: { version: 3, shots: [], shotOrder: [] } },
          app_slug: "studio",
        })
        .select(PRODUCTION_COLS)
        .single()

      if (error || !data) {
        return sendInternalError(reply, req, error, "Failed to create production")
      }

      const view = toProductionView(asViewable(data as Record<string, unknown>), {
        detail: "full",
      })
      return reply.status(201).send({
        data: {
          production: view,
          ...(landed?.ok
            ? {
                warnings: landed.result.warnings.map(toPlanIssue),
                summary: {
                  shotsAdded: landed.result.shots.length,
                  castEnrolled: Object.keys(view.cast ?? {}).length,
                  castBound: landed.result.summary.castBound,
                },
              }
            : {}),
        },
      })
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to create production")
    }
  })

  // ── get ────────────────────────────────────────────────────────────────────
  app.get("/v1/studio/productions/:id", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:read")
    if (!userId) return
    const params = parseWith(reply, productionIdParams, req.params, "Invalid production ID")
    if (!params) return
    const query = parseWith(reply, getQuery, req.query ?? {}, "Invalid query")
    if (!query) return

    const loaded = await loadWorkflowFor(
      req,
      reply,
      userId,
      params.id,
      "view",
      PRODUCTION_COLS,
      "Failed to fetch production",
    )
    if (!loaded.ok) return
    // A workflow that is not a production is not a production the caller can
    // see — the same 404 an unreachable row gets, for the same reason.
    if (!isProduction(loaded.row)) return notFound(reply)

    const view: StudioProductionView = toProductionView(asViewable(loaded.row), {
      detail: query.detail ?? "summary",
      ...(query.shot_id ? { shotId: query.shot_id } : {}),
    })
    return { data: { production: view } }
  })

  // ── import a plan into a production that already exists ────────────────────
  app.post("/v1/studio/productions/:id/import", async (req, reply) => {
    const userId = authorize(req, reply, "workflows:write")
    if (!userId) return
    const params = parseWith(reply, productionIdParams, req.params, "Invalid production ID")
    if (!params) return
    const body = parseWith(reply, importBody, req.body ?? {}, "Invalid plan")
    if (!body) return

    const loaded = await loadWorkflowFor(
      req,
      reply,
      userId,
      params.id,
      "edit",
      PRODUCTION_COLS,
      "Failed to fetch production",
    )
    if (!loaded.ok) return
    if (!isProduction(loaded.row)) return notFound(reply)

    try {
      const landed = landPlan(body.plan, {
        candidates: await mentionCandidatesFor(userId),
      })
      if (!landed.ok) return validationError(reply, landed.error, landed.path)

      const appended = serializeAppend(asViewable(loaded.row), landed)
      const { data, error } = await supabase
        // tenant-scope-ignore: authorized by loadWorkflowFor(..., "edit") above.
        .from("workflows")
        .update({
          nodes: appended.nodes,
          edges: appended.edges,
          settings: appended.settings,
        })
        .eq("id", params.id)
        .select(PRODUCTION_COLS)
        .maybeSingle()
      if (error) return sendInternalError(reply, req, error, "Failed to import plan")
      if (!data) return notFound(reply)

      const view = toProductionView(asViewable(data as Record<string, unknown>), {
        detail: "full",
      })
      return {
        data: {
          production: view,
          warnings: landed.result.warnings.map(toPlanIssue),
          summary: {
            shotsAdded: landed.result.shots.length,
            castEnrolled: Object.keys(view.cast ?? {}).length,
            castBound: landed.result.summary.castBound,
          },
        },
      }
    } catch (error) {
      return sendInternalError(reply, req, error, "Failed to import plan")
    }
  })
}

function toPlanIssue(warning: { message: string; path?: string; code: string }): StudioPlanIssue {
  return {
    path: warning.path ?? "",
    message: warning.message,
    hint: warning.code,
  }
}
