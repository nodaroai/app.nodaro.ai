/**
 * /v1/sessions — generation sessions inside projects (migration 518).
 *
 * A creation tool shows Project -> its sessions -> each session's items. An
 * item is a link to one of the caller's jobs: born in the session (the job
 * funnel stamps `sessionId` from the generation request) or imported from
 * elsewhere. Removing an item deletes only that link; deleting the job itself
 * (`DELETE /v1/jobs/:id`) removes it from every session.
 *
 * Owner-only throughout, and on the request's side of the workspace line, like
 * `/v1/projects`. A miss is always 404 — never 403 — so ids are no oracle.
 * Reads need `jobs:read`, writes `assets:write` for an OAuth app; first-party
 * and personal-key callers own their rows. A personal key limited to some
 * workflows reaches none of these routes (undeclared = refused).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { requireScope } from "../lib/scopes.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  EMPTY_PREVIEW,
  SESSION_COLS,
  SESSION_FEED_JOB_COLS,
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
  createSessionBody,
  idParams,
  importItemsBody,
  itemParams,
  listItemsQuery,
  listSessionsQuery,
  updateSessionBody,
} from "../lib/generation-sessions-schemas.js"
import { sanitizeJobForPublic, type JobRecord } from "./jobs.js"
import { CHILD_JOB_COLUMN } from "../lib/public-job-data.js"
// OpenAPI entries (module side effect, like every route file's registerPath).
import "./generation-sessions-docs.js"

const WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

function notFound(reply: FastifyReply, message = "Session not found") {
  return reply.status(404).send({ error: { code: "not_found", message } })
}

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

function badCursor(reply: FastifyReply) {
  return reply.status(400).send({ error: { code: "validation_error", message: "Invalid cursor" } })
}

/** The signed-in caller allowed to READ, or null after replying. */
function reader(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.userId) {
    unauthorized(reply)
    return null
  }
  if (req.appAuthorization) {
    const err = requireScope(req.appAuthorization.scopes, "jobs:read")
    if (err) {
      reply.status(err.statusCode).send(err.body)
      return null
    }
  }
  return req.userId
}

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
    if (projectId) query = query.eq("project_id", projectId)
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

    // A cover must be one of this session's items (and so the caller's own
    // job). Anything else is a 404, like every other miss here; the DB refuses
    // it too (migration 532).
    const coverJobId = body.data.coverJobId
    if (typeof coverJobId === "string") {
      const { data: item, error: itemError } = await supabase
        .from("session_items")
        .select("job_id")
        .eq("session_id", found.data.id)
        .eq("job_id", coverJobId)
        .eq("user_id", req.userId)
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
    // request removed it, or its job was deleted): the DB guard refuses with
    // 42501, which is a miss like any other, never a 500.
    if (error && typeof coverJobId === "string" && (error as { code?: string }).code === "42501") {
      return notFound(reply, "Item not found")
    }
    if (error) return sendInternalError(reply, req, error, "Failed to update session")
    const row = data as SessionRow
    const previews = await loadPreviews([row], req.userId)
    if (previews.error) return sendInternalError(reply, req, previews.error, "Failed to update session")
    return { data: toSessionResponse(row, previews.data.get(row.id) ?? EMPTY_PREVIEW) }
  })

  // Deletes the session and its links. Its jobs stay (their `session_id`
  // becomes null) and stay in every other session that holds them.
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

  // The feed: every item of the session, born-in and imported, newest first.
  app.get("/v1/sessions/:id/items", async (req, reply) => {
    const userId = reader(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)
    const parsed = listItemsQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { limit = 50, cursor } = parsed.data
    const after = cursor ? decodeCursor(cursor) : null
    if (cursor && !after) return badCursor(reply)

    const found = await findOwnSession(req, userId, params.data.id)
    if (found.error) return sendInternalError(reply, req, found.error, "Failed to list session items")
    if (!found.data) return notFound(reply)

    let query = supabase
      .from("session_items")
      .select(`job_id, kind, added_at, imported_from_session_id, job:jobs!job_id(${SESSION_FEED_JOB_COLS})`)
      .eq("session_id", found.data.id)
      .eq("user_id", userId)
    if (after) query = query.or(afterKeyset("added_at", "job_id", after))
    query = query.order("added_at", { ascending: false }).order("job_id", { ascending: false }).limit(limit)

    const { data, error } = await query
    if (error) return sendInternalError(reply, req, error, "Failed to list session items")
    const rows = (data ?? []) as unknown as FeedRow[]
    const titles = await sourceTitles(req, userId, rows)
    if (titles.error) return sendInternalError(reply, req, titles.error, "Failed to list session items")

    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"
    const last = rows[rows.length - 1]
    return {
      data: rows.flatMap((r) => {
        const job = Array.isArray(r.job) ? r.job[0] : r.job
        if (!job) return []
        // A child job is shown only through its parent: never in a non-admin's
        // feed, however it got there (CHILD_JOB_COLUMN).
        if (!isAdmin && (job as { parent_job_id?: string | null }).parent_job_id != null) return []
        const fromId = r.imported_from_session_id
        return [{
          jobId: r.job_id,
          addedAt: r.added_at,
          imported: r.kind === "imported",
          importedFrom: r.kind === "imported" && fromId
            ? { sessionId: fromId, title: titles.data.get(fromId) ?? null }
            : null,
          job: sanitizeJobForPublic(job, isAdmin),
        }]
      }),
      next: rows.length === limit && last ? encodeCursor({ at: last.added_at, id: last.job_id }) : null,
    }
  })

  // Import: link some of the caller's own jobs into this session. A link, never
  // a copy. All-or-nothing: one id that is not the caller's job refuses the
  // whole call (404), so nothing is half-imported and no id is an oracle.
  app.post("/v1/sessions/:id/items", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)
    const body = importItemsBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)

    const found = await findOwnSession(req, req.userId, params.data.id)
    if (found.error) return sendInternalError(reply, req, found.error, "Failed to import items")
    if (!found.data) return notFound(reply)

    const ids = [...new Set(body.data.jobIds)]
    // Same side of the workspace line as the session: a job paid by this
    // workspace into a workspace session, a personal one into a personal one.
    let jobsQuery = supabase
      .from("jobs")
      .select("id, session_id")
      .in("id", ids)
      .eq("user_id", req.userId)
      // A child job is not the caller's to import: it reads as a job that does
      // not exist, and so refuses the whole call (CHILD_JOB_COLUMN).
      .is(CHILD_JOB_COLUMN, null)
    if (req.workspaceId) {
      jobsQuery = jobsQuery.eq("workspace_id", req.workspaceId)
    } else {
      jobsQuery = jobsQuery.is("workspace_id", null)
    }
    const { data: jobs, error: jobsError } = await jobsQuery
    if (jobsError) return sendInternalError(reply, req, jobsError, "Failed to import items")
    const owned = (jobs ?? []) as Array<{ id: string; session_id: string | null }>
    if (owned.length !== ids.length) return notFound(reply, "One or more jobs not found")

    const targetId = found.data.id
    const rows = owned.map((j) => ({
      session_id: targetId,
      user_id: req.userId,
      job_id: j.id,
      kind: "imported",
      imported_from_session_id: j.session_id && j.session_id !== targetId ? j.session_id : null,
    }))
    // Already in the session (born there, or imported before): left as it is.
    const { data: inserted, error } = await supabase
      .from("session_items")
      .upsert(rows, { onConflict: "session_id,job_id", ignoreDuplicates: true })
      .select("job_id")
    if (error) return sendInternalError(reply, req, error, "Failed to import items")
    return reply.status(201).send({ data: { imported: (inserted ?? []).length, requested: ids.length } })
  })

  // Remove one item from this session: deletes the link only. The job, and
  // every other session holding it, are untouched.
  app.delete("/v1/sessions/:id/items/:jobId", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = itemParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)

    const found = await findOwnSession(req, req.userId, params.data.id)
    if (found.error) return sendInternalError(reply, req, found.error, "Failed to remove item")
    if (!found.data) return notFound(reply)
    const { data, error } = await supabase
      .from("session_items")
      .delete()
      .eq("session_id", found.data.id)
      .eq("job_id", params.data.jobId)
      .eq("user_id", req.userId)
      .select("job_id")
    if (error) return sendInternalError(reply, req, error, "Failed to remove item")
    if (!data || data.length === 0) return notFound(reply, "Item not found")
    return { success: true }
  })
}

interface FeedRow {
  job_id: string
  kind: "native" | "imported"
  added_at: string
  imported_from_session_id: string | null
  job: JobRecord | JobRecord[] | null
}

/** Titles of the sessions a page's imported items came from — the caller's
 *  own sessions on this side of the workspace line only (any other reads as an
 *  untitled source), so a title is never read across owners or contexts. */
async function sourceTitles(
  req: FastifyRequest,
  userId: string,
  rows: readonly FeedRow[],
): Promise<{ data: Map<string, string | null>; error: unknown }> {
  const ids = [...new Set(rows.map((r) => r.imported_from_session_id).filter((id): id is string => !!id))]
  const map = new Map<string, string | null>()
  if (ids.length === 0) return { data: map, error: null }
  let query = supabase
    .from("generation_sessions")
    .select("id, title")
    .in("id", ids)
    .eq("user_id", userId)
  if (req.workspaceId) {
    query = query.eq("workspace_id", req.workspaceId)
  } else {
    query = query.is("workspace_id", null)
  }
  const { data, error } = await query
  if (error) return { data: map, error }
  for (const s of (data ?? []) as Array<{ id: string; title: string | null }>) map.set(s.id, s.title)
  return { data: map, error: null }
}
