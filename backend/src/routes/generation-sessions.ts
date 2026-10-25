/**
 * /v1/sessions — generation sessions inside projects (migration 518).
 *
 * A creation tool shows Project -> its sessions -> each session's items. An
 * item is a link to one of the caller's jobs: born in the session (the job
 * funnel stamps `sessionId` from the generation request) or imported from
 * elsewhere. Removing an item moves its link to the Trash (migration 561);
 * deleting the job itself (`DELETE /v1/jobs/:id`) puts the job in the Trash,
 * out of every session until it is restored. The item routes live in
 * `generation-session-items.ts`.
 *
 * Owner-only throughout, and on the request's side of the workspace line, like
 * `/v1/projects`. A miss is always 404 — never 403 — so ids are no oracle.
 * Reads need `jobs:read`, writes `assets:write` for an OAuth app; first-party
 * and personal-key callers own their rows. A personal key limited to some
 * workflows reaches none of these routes (undeclared = refused).
 */
import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  EMPTY_PREVIEW,
  SESSION_COLS,
  afterKeyset,
  decodeCursor,
  encodeCursor,
  findOwnSession,
  loadPreviews,
  ownsProjectHere,
  toSessionResponse,
  type SessionRow,
} from "../lib/generation-sessions.js"
import {
  NO_PROJECT,
  createSessionBody,
  idParams,
  listSessionsQuery,
  updateSessionBody,
} from "../lib/generation-sessions-schemas.js"
import { WRITE_LIMIT, badCursor, badRequest, notFound, reader, unauthorized } from "./generation-sessions-http.js"
import { registerSessionItemRoutes } from "./generation-session-items.js"
// OpenAPI entries (module side effect, like every route file's registerPath).
import "./generation-sessions-docs.js"

export async function generationSessionRoutes(app: FastifyInstance) {
  app.post("/v1/sessions", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const parsed = createSessionBody.safeParse(req.body)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { projectId, title, tool } = parsed.data

    if (projectId) {
      const { owned, error } = await ownsProjectHere(req, req.userId, projectId)
      if (error) return sendInternalError(reply, req, error, "Failed to create session")
      if (!owned) return notFound(reply, "Project not found")
    }

    // The DB copies the project's workspace over this (migration 518's guard).
    const { data, error } = await supabase
      .from("generation_sessions")
      .insert({
        user_id: req.userId,
        project_id: projectId ?? null,
        workspace_id: req.workspaceId ?? null,
        title: title ?? null,
        tool,
      })
      .select(SESSION_COLS)
      .single()
    if (error) return sendInternalError(reply, req, error, "Failed to create session")
    return reply.status(201).send({ data: toSessionResponse(data as SessionRow, EMPTY_PREVIEW) })
  })

  app.get("/v1/sessions", async (req, reply) => {
    const userId = reader(req, reply)
    if (!userId) return
    const parsed = listSessionsQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { projectId, tool, includeArchived, limit = 50, cursor } = parsed.data
    const after = cursor ? decodeCursor(cursor) : null
    if (cursor && !after) return badCursor(reply)

    let query = supabase
      .from("generation_sessions")
      .select(SESSION_COLS)
      .eq("user_id", userId)
    if (req.workspaceId) {
      query = query.eq("workspace_id", req.workspaceId)
    } else {
      query = query.is("workspace_id", null)
    }
    // `none`: the sessions with no project (one never in a project, or whose
    // project was deleted).
    if (projectId === NO_PROJECT) query = query.is("project_id", null)
    else if (projectId) query = query.eq("project_id", projectId)
    if (tool) query = query.eq("tool", tool)
    if (includeArchived !== "true") query = query.is("archived_at", null)
    if (after) query = query.or(afterKeyset("created_at", "id", after))
    query = query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit)

    const { data, error } = await query
    if (error) return sendInternalError(reply, req, error, "Failed to list sessions")
    const rows = (data ?? []) as SessionRow[]
    const previews = await loadPreviews(rows, userId)
    if (previews.error) return sendInternalError(reply, req, previews.error, "Failed to list sessions")

    const last = rows[rows.length - 1]
    return {
      data: rows.map((r) => toSessionResponse(r, previews.data.get(r.id) ?? EMPTY_PREVIEW)),
      next: rows.length === limit && last ? encodeCursor({ at: last.created_at, id: last.id }) : null,
    }
  })

  app.get("/v1/sessions/:id", async (req, reply) => {
    const userId = reader(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)

    const { data, error } = await findOwnSession(req, userId, params.data.id)
    if (error) return sendInternalError(reply, req, error, "Failed to fetch session")
    if (!data) return notFound(reply)
    const previews = await loadPreviews([data], userId)
    if (previews.error) return sendInternalError(reply, req, previews.error, "Failed to fetch session")
    return { data: toSessionResponse(data, previews.data.get(data.id) ?? EMPTY_PREVIEW) }
  })

  app.patch("/v1/sessions/:id", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)
    const body = updateSessionBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)

    const found = await findOwnSession(req, req.userId, params.data.id)
    if (found.error) return sendInternalError(reply, req, found.error, "Failed to update session")
    if (!found.data) return notFound(reply)

    // A cover must be one of this session's LIVE items (and so the caller's own
    // job). Anything else is a 404, like every other miss here; the DB refuses
    // it too, a job in the Trash included (migration 561).
    const coverJobId = body.data.coverJobId
    if (typeof coverJobId === "string") {
      const { data: item, error: itemError } = await supabase
        .from("session_items")
        .select("job_id")
        .eq("session_id", found.data.id)
        .eq("job_id", coverJobId)
        .eq("user_id", req.userId)
        .is("removed_at", null)
        .maybeSingle()
      if (itemError) return sendInternalError(reply, req, itemError, "Failed to update session")
      if (!item) return notFound(reply, "Item not found")
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.data.title !== undefined) updates.title = body.data.title
    if (body.data.archived !== undefined) {
      updates.archived_at = body.data.archived ? (found.data.archived_at ?? new Date().toISOString()) : null
    }
    if (coverJobId !== undefined) updates.cover_job_id = coverJobId
    const { data, error } = await supabase
      .from("generation_sessions")
      .update(updates)
      .eq("id", found.data.id)
      .eq("user_id", req.userId)
      .select(SESSION_COLS)
      .single()
    // The item left the session between the check above and this write (another
    // request removed it, or its job was deleted), or its job is in the Trash:
    // the DB guard refuses with 42501, which is a miss like any other, never a 500.
    if (error && typeof coverJobId === "string" && (error as { code?: string }).code === "42501") {
      return notFound(reply, "Item not found")
    }
    if (error) return sendInternalError(reply, req, error, "Failed to update session")
    const row = data as SessionRow
    const previews = await loadPreviews([row], req.userId)
    if (previews.error) return sendInternalError(reply, req, previews.error, "Failed to update session")
    return { data: toSessionResponse(row, previews.data.get(row.id) ?? EMPTY_PREVIEW) }
  })

  // Deletes the session and its links, removed ones included (they leave the
  // Trash with it). Its jobs stay (their `session_id` becomes null) and stay
  // in every other session that holds them.
  app.delete("/v1/sessions/:id", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)

    const found = await findOwnSession(req, req.userId, params.data.id)
    if (found.error) return sendInternalError(reply, req, found.error, "Failed to delete session")
    if (!found.data) return notFound(reply)
    const { error } = await supabase
      .from("generation_sessions")
      .delete()
      .eq("id", found.data.id)
      .eq("user_id", req.userId)
    if (error) return sendInternalError(reply, req, error, "Failed to delete session")
    return { success: true }
  })

  registerSessionItemRoutes(app)
}
