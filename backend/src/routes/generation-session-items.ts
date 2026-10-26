/**
 * A session's items (migrations 518 + 561) — registered by
 * `generationSessionRoutes`:
 *
 *   GET    /v1/sessions/:id/items                 the live feed; `?removed=true`: its Trash
 *   POST   /v1/sessions/:id/items                 import (a removed link comes back)
 *   DELETE /v1/sessions/:id/items/:jobId          remove: to the Trash; `?forever=true`: the link for good
 *   POST   /v1/sessions/:id/items/:jobId/restore  back from the Trash
 *   POST   /v1/sessions/:id/items/move            from another session, atomically
 *
 * An item is live when its link is not removed and its job is not in the
 * Trash. An item whose job is in the Trash is shown nowhere — not in the feed,
 * not in the session's Trash (the job's own Trash entry stands for it) — and
 * reads as not found here. Removing never touches the job.
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { supabase } from "../lib/supabase.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  FEED_LIVE_JOB_FILTER,
  SESSION_FEED_JOB_COLS,
  afterKeyset,
  decodeCursor,
  encodeCursor,
  findOwnSession,
} from "../lib/generation-sessions.js"
import {
  idParams,
  importItemsBody,
  itemParams,
  listItemsQuery,
  moveItemsBody,
  removeItemQuery,
} from "../lib/generation-sessions-schemas.js"
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN } from "../lib/public-job-data.js"
import { sanitizeJobForPublic, type JobRecord } from "./jobs.js"
import { WRITE_LIMIT, badCursor, badRequest, notFound, notInTrash, reader, unauthorized } from "./generation-sessions-http.js"

/** Undo is one call per item (an Undo toast, "restore all" from the Trash, MCP
 *  `restore_job_ids` up to 100): bounded generously, like the job Trash routes. */
const RESTORE_LIMIT = { rateLimit: { max: 120, timeWindow: "1 minute" } }

interface FeedRow {
  job_id: string
  kind: "native" | "imported"
  added_at: string
  removed_at: string | null
  imported_from_session_id: string | null
  job: JobRecord | JobRecord[] | null
}

/** One link of the caller's session, and whether its job is in the Trash. */
async function findLink(
  sessionId: string,
  jobId: string,
  userId: string,
): Promise<{ data: { removedAt: string | null; jobTrashed: boolean } | null; error: unknown }> {
  const { data, error } = await supabase
    .from("session_items")
    // trash-read: reads the job's Trash state to treat a trashed job's item as not found.
    .select(`removed_at, job:jobs!job_id(${TRASHED_JOB_COLUMN})`)
    .eq("session_id", sessionId)
    .eq("job_id", jobId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error || !data) return { data: null, error }
  const row = data as unknown as { removed_at: string | null; job: Record<string, unknown> | Array<Record<string, unknown>> | null }
  const job = Array.isArray(row.job) ? row.job[0] : row.job
  return { data: { removedAt: row.removed_at, jobTrashed: !job || job[TRASHED_JOB_COLUMN] != null }, error: null }
}

export function registerSessionItemRoutes(app: FastifyInstance): void {
  // The feed: every live item of the session, born-in and imported, newest
  // first — or, `removed=true`, its removed items, newest removal first.
  app.get("/v1/sessions/:id/items", async (req, reply) => {
    const userId = reader(req, reply)
    if (!userId) return
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)
    const parsed = listItemsQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { limit = 50, cursor } = parsed.data
    const removed = parsed.data.removed === "true"
    const after = cursor ? decodeCursor(cursor) : null
    if (cursor && !after) return badCursor(reply)

    const found = await findOwnSession(req, userId, params.data.id)
    if (found.error) return sendInternalError(reply, req, found.error, "Failed to list session items")
    if (!found.data) return notFound(reply)

    // The keyset follows the order: when it arrived, or when it was removed.
    const timeCol = removed ? "removed_at" : "added_at"
    let query = supabase
      .from("session_items")
      // `!inner` + the filter: an item whose job is in the Trash is no row at all.
      .select(`job_id, kind, added_at, removed_at, imported_from_session_id, job:jobs!job_id!inner(${SESSION_FEED_JOB_COLS})`)
      .eq("session_id", found.data.id)
      .eq("user_id", userId)
      .is(FEED_LIVE_JOB_FILTER, null)
    query = removed ? query.not("removed_at", "is", null) : query.is("removed_at", null)
    if (after) query = query.or(afterKeyset(timeCol, "job_id", after))
    query = query.order(timeCol, { ascending: false }).order("job_id", { ascending: false }).limit(limit)

    const { data, error } = await query
    if (error) return sendInternalError(reply, req, error, "Failed to list session items")
    const rows = (data ?? []) as unknown as FeedRow[]
    const titles = await sourceTitles(req, userId, rows)
    if (titles.error) return sendInternalError(reply, req, titles.error, "Failed to list session items")

    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"
    const last = rows[rows.length - 1]
    return {
      data: rows.flatMap((r) => feedItemOf(r, titles.data, isAdmin)),
      next: rows.length === limit && last
        ? encodeCursor({ at: (removed ? last.removed_at : last.added_at) ?? last.added_at, id: last.job_id })
        : null,
    }
  })

  // Import: link some of the caller's own jobs into this session. A link, never
  // a copy. All-or-nothing: one id that is not the caller's live job refuses
  // the whole call (404), so nothing is half-imported and no id is an oracle.
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
      // A child job is not the caller's to import, nor is a job in the Trash:
      // each reads as a job that does not exist, and so refuses the whole call.
      .is(CHILD_JOB_COLUMN, null)
      .is(TRASHED_JOB_COLUMN, null)
    if (req.workspaceId) {
      jobsQuery = jobsQuery.eq("workspace_id", req.workspaceId)
    } else {
      jobsQuery = jobsQuery.is("workspace_id", null)
    }
    const { data: jobs, error: jobsError } = await jobsQuery
    if (jobsError) return sendInternalError(reply, req, jobsError, "Failed to import items")
    const owned = (jobs ?? []) as Array<{ id: string; session_id: string | null }>
    if (owned.length !== ids.length) return notFound(reply, "One or more jobs not found")

    const linked = await linkJobs(found.data.id, req.userId, owned)
    if (linked.error) return sendInternalError(reply, req, linked.error, "Failed to import items")
    return reply.status(201).send({ data: { imported: linked.imported, requested: ids.length } })
  })

  // Remove one item from this session: its link goes to the session's Trash
  // (`?forever=true`: an item already there is deleted for good). The job, and
  // every other session holding it, are untouched.
  app.delete("/v1/sessions/:id/items/:jobId", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = itemParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)
    const query = removeItemQuery.safeParse(req.query ?? {})
    if (!query.success) return badRequest(reply, query.error)

    const found = await findOwnSession(req, req.userId, params.data.id)
    if (found.error) return sendInternalError(reply, req, found.error, "Failed to remove item")
    if (!found.data) return notFound(reply)
    const link = await findLink(found.data.id, params.data.jobId, req.userId)
    if (link.error) return sendInternalError(reply, req, link.error, "Failed to remove item")
    if (!link.data || link.data.jobTrashed) return notFound(reply, "Item not found")

    if (query.data.forever === "true") {
      if (!link.data.removedAt) return notInTrash(reply)
      const { data, error } = await supabase
        .from("session_items")
        .delete()
        .eq("session_id", found.data.id)
        .eq("job_id", params.data.jobId)
        .eq("user_id", req.userId)
        .not("removed_at", "is", null)
        .select("job_id")
      if (error) return sendInternalError(reply, req, error, "Failed to remove item")
      // Restored between the read and the delete: it is live again.
      if (!data || data.length === 0) return notInTrash(reply)
      return { success: true }
    }

    // Already removed: nothing to do (its removal time, and so its place in
    // the Trash, is kept).
    if (link.data.removedAt) return { success: true }
    const { error } = await supabase
      .from("session_items")
      .update({ removed_at: new Date().toISOString() })
      .eq("session_id", found.data.id)
      .eq("job_id", params.data.jobId)
      .eq("user_id", req.userId)
      .is("removed_at", null)
    if (error) return sendInternalError(reply, req, error, "Failed to remove item")
    return { success: true }
  })

  // Restore one removed item: live in the session again, where it was.
  app.post("/v1/sessions/:id/items/:jobId/restore", { preHandler: requireAppScope("assets:write"), config: RESTORE_LIMIT }, async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = itemParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)

    const found = await findOwnSession(req, req.userId, params.data.id)
    if (found.error) return sendInternalError(reply, req, found.error, "Failed to restore item")
    if (!found.data) return notFound(reply)
    const link = await findLink(found.data.id, params.data.jobId, req.userId)
    if (link.error) return sendInternalError(reply, req, link.error, "Failed to restore item")
    if (!link.data || link.data.jobTrashed) return notFound(reply, "Item not found")
    if (!link.data.removedAt) return { success: true }
    const { error } = await supabase
      .from("session_items")
      .update({ removed_at: null })
      .eq("session_id", found.data.id)
      .eq("job_id", params.data.jobId)
      .eq("user_id", req.userId)
      .not("removed_at", "is", null)
    if (error) return sendInternalError(reply, req, error, "Failed to restore item")
    return { success: true }
  })

  // Move: some live items of `fromSessionId` into this session, in one
  // transaction (migration 561's `move_session_items`): this session gets live
  // links, the source keeps removed ones (its Trash undoes the move). A target
  // in another project is how an item moves to another project. All or
  // nothing: any id that is not a live item of the source refuses the call.
  app.post("/v1/sessions/:id/items/move", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = idParams.safeParse(req.params)
    if (!params.success) return badRequest(reply, params.error)
    const body = moveItemsBody.safeParse(req.body)
    if (!body.success) return badRequest(reply, body.error)
    if (body.data.fromSessionId === params.data.id) {
      return reply.status(400).send({ error: { code: "validation_error", message: "fromSessionId is this session: there is nothing to move" } })
    }

    const { data, error } = await supabase.rpc("move_session_items", {
      p_user_id: req.userId,
      p_workspace_id: req.workspaceId ?? null,
      p_target_session_id: params.data.id,
      p_from_session_id: body.data.fromSessionId,
      p_job_ids: [...new Set(body.data.jobIds)],
    })
    if (error) return sendInternalError(reply, req, error, "Failed to move items")
    const result = (data ?? {}) as { moved?: unknown; error?: unknown }
    if (result.error === "session_not_found") return notFound(reply)
    if (result.error === "item_not_found") return notFound(reply, "One or more items not found")
    if (result.error === "same_session") {
      return reply.status(400).send({ error: { code: "validation_error", message: "fromSessionId is this session: there is nothing to move" } })
    }
    if (typeof result.moved !== "number") return sendInternalError(reply, req, new Error("Malformed move response"), "Failed to move items")
    return { data: { moved: result.moved } }
  })
}

/** One feed row as the API answers it, or none: a row whose job did not
 *  come back, or a child job for a non-admin (it is shown only through its
 *  parent, however it got into the session — CHILD_JOB_COLUMN). */
function feedItemOf(r: FeedRow, titles: ReadonlyMap<string, string | null>, isAdmin: boolean) {
  const job = Array.isArray(r.job) ? r.job[0] : r.job
  if (!job) return []
  if (!isAdmin && (job as unknown as Record<string, unknown>)[CHILD_JOB_COLUMN] != null) return []
  const fromId = r.imported_from_session_id
  return [{
    jobId: r.job_id,
    addedAt: r.added_at,
    removedAt: r.removed_at,
    imported: r.kind === "imported",
    importedFrom: r.kind === "imported" && fromId ? { sessionId: fromId, title: titles.get(fromId) ?? null } : null,
    job: sanitizeJobForPublic(job, isAdmin),
  }]
}

/**
 * Link the caller's own (already checked) jobs into a session. A removed link
 * comes back where it was — its kind, origin and place in the feed kept — so
 * importing an item from the session's own Trash is a restore; a link already
 * live is left as it is. Answers how many links were revived or added.
 */
async function linkJobs(
  sessionId: string,
  userId: string,
  jobs: ReadonlyArray<{ id: string; session_id: string | null }>,
): Promise<{ imported: number; error: unknown }> {
  const ids = jobs.map((j) => j.id)
  const { data: revived, error: reviveError } = await supabase
    .from("session_items")
    .update({ removed_at: null })
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .in("job_id", ids)
    .not("removed_at", "is", null)
    .select("job_id")
  if (reviveError) return { imported: 0, error: reviveError }
  const rows = jobs.map((j) => ({
    session_id: sessionId,
    user_id: userId,
    job_id: j.id,
    kind: "imported",
    imported_from_session_id: j.session_id && j.session_id !== sessionId ? j.session_id : null,
  }))
  // Already in the session (born there, imported before, or just revived): left as it is.
  const { data: inserted, error } = await supabase
    .from("session_items")
    .upsert(rows, { onConflict: "session_id,job_id", ignoreDuplicates: true })
    .select("job_id")
  if (error) return { imported: 0, error }
  return { imported: (revived ?? []).length + (inserted ?? []).length, error: null }
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
