/**
 * A session's items and the Trash (routes/generation-session-items.ts,
 * migration 561).
 *
 * What must hold: removing stamps `removed_at` (never deletes the link or
 * touches the job); delete-for-good only deletes a removed link (409
 * `not_in_trash` otherwise); restore clears the stamp; an item whose job is in
 * the Trash is not found; the feed reads live links of live jobs only, and
 * `removed=true` the removed ones; import revives a removed link; a move is one
 * call to `move_session_items` with the caller's identity and workspace, its
 * error codes mapped to 404 / 400. Every route is the caller's own session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { argOf, has, type QueryResult, type RecordedQuery } from "../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
  rpc: vi.fn(async (_fn: string, _args: unknown) => ({ data: [] as unknown, error: null as unknown })),
}))

vi.mock("../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../lib/__tests__/fake-supabase-query.js")
  return {
    supabase: {
      from: makeFakeFrom(db.log, (q) => db.respond!(q)),
      rpc: (fn: string, args: unknown) => db.rpc(fn, args),
    },
  }
})

import { generationSessionRoutes } from "../generation-sessions.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const WORKSPACE = "00000000-0000-4000-8000-0000000000f1"
const SESSION = "00000000-0000-4000-8000-000000000020"
const OTHER_SESSION = "00000000-0000-4000-8000-000000000021"
const JOB_A = "00000000-0000-4000-8000-0000000000a1"
const JOB_B = "00000000-0000-4000-8000-0000000000b1"

const SESSION_ROW = {
  id: SESSION, user_id: OWNER, project_id: null, workspace_id: null, title: "Beach", tool: "create-image",
  created_at: "2026-10-15T10:00:00.000000+00:00", updated_at: "2026-10-15T10:05:00.000000+00:00", archived_at: null,
}

let app: FastifyInstance

function queries(table: string, op?: string): RecordedQuery[] {
  return db.log.filter((q) => q.table === table && (!op || argOf(q, op)))
}

/** The session is the caller's; the link (if any) answers `link`. */
function withLink(link: { removed_at: string | null; job: { deleted_at: string | null } } | null, writes: QueryResult = { data: [{ job_id: JOB_A }], error: null }) {
  db.respond = (q) => {
    if (q.table === "generation_sessions") return { data: SESSION_ROW, error: null }
    if (q.table === "session_items" && (argOf(q, "update") || argOf(q, "delete"))) return writes
    if (q.table === "session_items") return { data: link, error: null }
    return { data: null, error: null }
  }
}

beforeEach(async () => {
  db.log.length = 0
  db.rpc.mockReset()
  db.rpc.mockResolvedValue({ data: [], error: null })
  db.respond = () => ({ data: null, error: null })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const ws = req.headers["x-workspace-id"]
    if (typeof ws === "string") req.workspaceId = ws
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") req.appAuthorization = { scopes: scopes.split(" ") } as never
  })
  await app.register(generationSessionRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const as = { "x-user-id": OWNER }

describe("DELETE /v1/sessions/:id/items/:jobId — to the session's Trash", () => {
  it("stamps removed_at on the caller's live link; the link and the job stay", async () => {
    withLink({ removed_at: null, job: { deleted_at: null } })
    const res = await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}`, headers: as })
    expect(res.statusCode).toBe(200)
    const [update] = queries("session_items", "update")
    expect(typeof (argOf(update!, "update")![0] as Record<string, unknown>).removed_at).toBe("string")
    expect(has(update!, "eq", "session_id", SESSION)).toBe(true)
    expect(has(update!, "eq", "job_id", JOB_A)).toBe(true)
    expect(has(update!, "eq", "user_id", OWNER)).toBe(true)
    expect(has(update!, "is", "removed_at", null)).toBe(true)
    expect(queries("session_items", "delete")).toHaveLength(0)
    expect(queries("jobs")).toHaveLength(0)
  })

  it("an item already removed answers success without restamping", async () => {
    withLink({ removed_at: "2026-10-20T00:00:00Z", job: { deleted_at: null } })
    const res = await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}`, headers: as })
    expect(res.statusCode).toBe(200)
    expect(queries("session_items", "update")).toHaveLength(0)
  })

  it("404s an item that is not in the session, and one whose job is in the Trash", async () => {
    withLink(null)
    expect((await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}`, headers: as })).statusCode).toBe(404)
    withLink({ removed_at: null, job: { deleted_at: "2026-10-20T00:00:00Z" } })
    expect((await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}`, headers: as })).statusCode).toBe(404)
    expect(queries("session_items", "update")).toHaveLength(0)
  })

  it("404s a session that is not the caller's, and touches no link", async () => {
    db.respond = () => ({ data: null, error: null })
    const res = await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}`, headers: as })
    expect(res.statusCode).toBe(404)
    expect(queries("session_items")).toHaveLength(0)
  })

  it("an OAuth app needs assets:write", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}`, headers: { ...as, "x-app-scopes": "jobs:read" },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe("DELETE …/items/:jobId?forever=true", () => {
  it("409s not_in_trash for a live item, and deletes nothing", async () => {
    withLink({ removed_at: null, job: { deleted_at: null } })
    const res = await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}?forever=true`, headers: as })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_in_trash")
    expect(queries("session_items", "delete")).toHaveLength(0)
  })

  it("deletes a removed link for good — only while it is still removed — and never the job", async () => {
    withLink({ removed_at: "2026-10-20T00:00:00Z", job: { deleted_at: null } })
    const res = await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}?forever=true`, headers: as })
    expect(res.statusCode).toBe(200)
    const [del] = queries("session_items", "delete")
    expect(has(del!, "eq", "user_id", OWNER)).toBe(true)
    expect(has(del!, "not", "removed_at", "is", null)).toBe(true)
    expect(queries("jobs")).toHaveLength(0)
  })

  it("409s when the item was restored between the read and the delete", async () => {
    withLink({ removed_at: "2026-10-20T00:00:00Z", job: { deleted_at: null } }, { data: [], error: null })
    const res = await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}?forever=true`, headers: as })
    expect(res.statusCode).toBe(409)
  })
})

describe("POST /v1/sessions/:id/items/:jobId/restore", () => {
  it("clears removed_at on the caller's removed link", async () => {
    withLink({ removed_at: "2026-10-20T00:00:00Z", job: { deleted_at: null } })
    const res = await app.inject({ method: "POST", url: `/v1/sessions/${SESSION}/items/${JOB_A}/restore`, headers: as })
    expect(res.statusCode).toBe(200)
    const [update] = queries("session_items", "update")
    expect(argOf(update!, "update")![0]).toEqual({ removed_at: null })
    expect(has(update!, "eq", "user_id", OWNER)).toBe(true)
  })

  it("a live item answers success; a missing one or a deleted job 404s", async () => {
    withLink({ removed_at: null, job: { deleted_at: null } })
    expect((await app.inject({ method: "POST", url: `/v1/sessions/${SESSION}/items/${JOB_A}/restore`, headers: as })).statusCode).toBe(200)
    expect(queries("session_items", "update")).toHaveLength(0)
    withLink(null)
    expect((await app.inject({ method: "POST", url: `/v1/sessions/${SESSION}/items/${JOB_A}/restore`, headers: as })).statusCode).toBe(404)
    withLink({ removed_at: "2026-10-20T00:00:00Z", job: { deleted_at: "2026-10-21T00:00:00Z" } })
    expect((await app.inject({ method: "POST", url: `/v1/sessions/${SESSION}/items/${JOB_A}/restore`, headers: as })).statusCode).toBe(404)
  })
})

describe("GET /v1/sessions/:id/items", () => {
  it("the feed reads live links of live jobs, newest first", async () => {
    db.respond = (q) => (q.table === "generation_sessions" ? { data: SESSION_ROW, error: null } : { data: [], error: null })
    const res = await app.inject({ method: "GET", url: `/v1/sessions/${SESSION}/items`, headers: as })
    expect(res.statusCode).toBe(200)
    const [feed] = queries("session_items")
    expect(String(argOf(feed!, "select")![0])).toContain("job:jobs!job_id!inner(")
    expect(has(feed!, "is", "job.deleted_at", null)).toBe(true)
    expect(has(feed!, "is", "removed_at", null)).toBe(true)
    expect(has(feed!, "order", "added_at", { ascending: false })).toBe(true)
  })

  it("removed=true reads the removed links, newest removal first, each with removedAt", async () => {
    db.respond = (q) => {
      if (q.table === "generation_sessions") return { data: SESSION_ROW, error: null }
      return {
        data: [{
          job_id: JOB_A, kind: "native", added_at: "2026-10-15T10:00:00+00:00", removed_at: "2026-10-20T10:00:00+00:00",
          imported_from_session_id: null, job: { id: JOB_A, status: "completed", user_id: OWNER, parent_job_id: null },
        }],
        error: null,
      }
    }
    const res = await app.inject({ method: "GET", url: `/v1/sessions/${SESSION}/items?removed=true&limit=1`, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data[0]).toMatchObject({ jobId: JOB_A, removedAt: "2026-10-20T10:00:00+00:00" })
    const [feed] = queries("session_items")
    expect(has(feed!, "not", "removed_at", "is", null)).toBe(true)
    expect(has(feed!, "order", "removed_at", { ascending: false })).toBe(true)
    expect(has(feed!, "is", "job.deleted_at", null)).toBe(true)
    expect(res.json().next).not.toBeNull()
  })
})

describe("POST /v1/sessions/:id/items — import", () => {
  it("revives a removed link and imports the rest; the jobs must be live", async () => {
    db.respond = (q) => {
      if (q.table === "generation_sessions") return { data: SESSION_ROW, error: null }
      if (q.table === "jobs") return { data: [{ id: JOB_A, session_id: SESSION }, { id: JOB_B, session_id: null }], error: null }
      if (q.table === "session_items" && argOf(q, "update")) return { data: [{ job_id: JOB_A }], error: null }
      if (q.table === "session_items" && argOf(q, "upsert")) return { data: [{ job_id: JOB_B }], error: null }
      return { data: null, error: null }
    }
    const res = await app.inject({ method: "POST", url: `/v1/sessions/${SESSION}/items`, headers: as, payload: { jobIds: [JOB_A, JOB_B] } })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toEqual({ imported: 2, requested: 2 })
    const [jobs] = queries("jobs")
    expect(has(jobs!, "is", "deleted_at", null)).toBe(true)
    const [revive] = queries("session_items", "update")
    expect(argOf(revive!, "update")![0]).toEqual({ removed_at: null })
    expect(has(revive!, "not", "removed_at", "is", null)).toBe(true)
  })
})

describe("POST /v1/sessions/:id/items/move", () => {
  it("is one move_session_items call with the caller, the workspace, the target and the source", async () => {
    db.rpc.mockResolvedValue({ data: { moved: 2 }, error: null })
    const res = await app.inject({
      method: "POST", url: `/v1/sessions/${SESSION}/items/move`, headers: { ...as, "x-workspace-id": WORKSPACE },
      payload: { jobIds: [JOB_A, JOB_B, JOB_A], fromSessionId: OTHER_SESSION },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { moved: 2 } })
    expect(db.rpc).toHaveBeenCalledWith("move_session_items", {
      p_user_id: OWNER, p_workspace_id: WORKSPACE, p_target_session_id: SESSION, p_from_session_id: OTHER_SESSION, p_job_ids: [JOB_A, JOB_B],
    })
  })

  it("maps the function's refusals: sessions and items 404, the same session 400", async () => {
    const move = () => app.inject({ method: "POST", url: `/v1/sessions/${SESSION}/items/move`, headers: as, payload: { jobIds: [JOB_A], fromSessionId: OTHER_SESSION } })
    db.rpc.mockResolvedValue({ data: { error: "session_not_found" }, error: null })
    expect((await move()).statusCode).toBe(404)
    db.rpc.mockResolvedValue({ data: { error: "item_not_found" }, error: null })
    expect((await move()).statusCode).toBe(404)
    db.rpc.mockResolvedValue({ data: { error: "same_session" }, error: null })
    expect((await move()).statusCode).toBe(400)
  })

  it("400s a move from the session into itself without calling the database", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/sessions/${SESSION}/items/move`, headers: as, payload: { jobIds: [JOB_A], fromSessionId: SESSION } })
    expect(res.statusCode).toBe(400)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it("an OAuth app needs assets:write", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/sessions/${SESSION}/items/move`, headers: { ...as, "x-app-scopes": "jobs:read" },
      payload: { jobIds: [JOB_A], fromSessionId: OTHER_SESSION },
    })
    expect(res.statusCode).toBe(403)
    expect(db.rpc).not.toHaveBeenCalled()
  })
})

describe("GET /v1/sessions — projectId=none and removedCount", () => {
  it("none lists the sessions with no project, each with its Trash count", async () => {
    db.respond = () => ({ data: [SESSION_ROW], error: null })
    db.rpc.mockResolvedValue({ data: [{ session_id: SESSION, item_count: "2", removed_count: "3", recent: [] }], error: null })
    const res = await app.inject({ method: "GET", url: "/v1/sessions?projectId=none", headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data[0]).toMatchObject({ itemCount: 2, removedCount: 3 })
    const [list] = queries("generation_sessions")
    expect(has(list!, "is", "project_id", null)).toBe(true)
  })
})
