/**
 * /v1/sessions (routes/generation-sessions.ts).
 *
 * What must hold: every read and write is the caller's own row on the
 * request's side of the workspace line; a miss is 404 (never 403); an import
 * is all-or-nothing over the caller's OWN jobs; removing an item deletes only
 * the link; the feed's jobs go through the public sanitizer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { argOf, has, type QueryResult, type RecordedQuery } from "../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
  rpc: vi.fn(async (_fn: string, _args: unknown) => ({ data: [] as unknown[], error: null as unknown })),
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
import { encodeCursor } from "../../lib/generation-sessions.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const PROJECT = "00000000-0000-4000-8000-000000000010"
const SESSION = "00000000-0000-4000-8000-000000000020"
const OTHER_SESSION = "00000000-0000-4000-8000-000000000021"
const JOB_A = "00000000-0000-4000-8000-0000000000a1"
const JOB_B = "00000000-0000-4000-8000-0000000000b1"

const SESSION_ROW = {
  id: SESSION,
  user_id: OWNER,
  project_id: PROJECT,
  workspace_id: null,
  title: "Beach",
  tool: "create-image",
  created_at: "2026-10-15T10:00:00.000000+00:00",
  updated_at: "2026-10-15T10:05:00.000000+00:00",
  archived_at: null,
}

let app: FastifyInstance

function queries(table: string, op?: string): RecordedQuery[] {
  return db.log.filter((q) => q.table === table && (!op || argOf(q, op)))
}

beforeEach(async () => {
  db.log.length = 0
  db.rpc.mockClear()
  db.rpc.mockResolvedValue({ data: [], error: null })
  db.respond = () => ({ data: null, error: null })

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") req.appAuthorization = { scopes: scopes.split(" ") } as never
  })
  await app.register(generationSessionRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/sessions", () => {
  it("creates a personal session in the caller's own project", async () => {
    db.respond = (q) => {
      if (q.table === "projects") return { data: { id: PROJECT }, error: null }
      if (q.table === "generation_sessions") return { data: SESSION_ROW, error: null }
      return { data: null, error: null }
    }
    const res = await app.inject({
      method: "POST", url: "/v1/sessions", headers: { "x-user-id": OWNER },
      payload: { projectId: PROJECT, title: "Beach", tool: "create-image" },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toMatchObject({ id: SESSION, projectId: PROJECT, tool: "create-image", itemCount: 0, previewUrls: [] })

    const [projectLookup] = queries("projects")
    expect(has(projectLookup, "eq", "user_id", OWNER)).toBe(true)
    expect(has(projectLookup, "is", "workspace_id", null)).toBe(true)
    const [insert] = queries("generation_sessions", "insert")
    expect(argOf(insert, "insert")![0]).toMatchObject({ user_id: OWNER, project_id: PROJECT, workspace_id: null, tool: "create-image" })
  })

  it("404s a project that is not the caller's, and creates nothing", async () => {
    db.respond = () => ({ data: null, error: null })
    const res = await app.inject({
      method: "POST", url: "/v1/sessions", headers: { "x-user-id": OWNER },
      payload: { projectId: PROJECT, tool: "create-image" },
    })
    expect(res.statusCode).toBe(404)
    expect(queries("generation_sessions", "insert")).toHaveLength(0)
  })

  it("rejects a tool that is not a slug", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sessions", headers: { "x-user-id": OWNER },
      payload: { tool: "Create Image" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("an OAuth app needs assets:write to create", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sessions", headers: { "x-user-id": OWNER, "x-app-scopes": "jobs:read" },
      payload: { tool: "create-image" },
    })
    expect(res.statusCode).toBe(403)
    expect(queries("generation_sessions")).toHaveLength(0)
  })
})

describe("GET /v1/sessions", () => {
  it("lists the caller's own personal sessions with their previews", async () => {
    db.respond = () => ({ data: [SESSION_ROW], error: null })
    db.rpc.mockResolvedValue({
      data: [{ session_id: SESSION, item_count: "3", recent: [{ job_id: JOB_A, output_data: { imageUrl: "https://cdn/a.png" } }] }],
      error: null,
    })
    const res = await app.inject({ method: "GET", url: `/v1/sessions?projectId=${PROJECT}&limit=1`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data[0]).toMatchObject({ id: SESSION, itemCount: 3, previewUrls: ["https://cdn/a.png"] })
    expect(body.next).toBe(encodeCursor({ at: SESSION_ROW.created_at, id: SESSION }))

    const [list] = queries("generation_sessions")
    expect(has(list, "eq", "user_id", OWNER)).toBe(true)
    expect(has(list, "is", "workspace_id", null)).toBe(true)
    expect(has(list, "eq", "project_id", PROJECT)).toBe(true)
    expect(has(list, "is", "archived_at", null)).toBe(true)
  })

  it("400s a cursor it did not issue", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/sessions?cursor=nope", headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(400)
  })

  it("an OAuth app needs jobs:read to list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/sessions", headers: { "x-user-id": OWNER, "x-app-scopes": "assets:write" } })
    expect(res.statusCode).toBe(403)
  })

  it("401s without a caller", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/sessions" })
    expect(res.statusCode).toBe(401)
  })
})

describe("GET /v1/sessions/:id/items", () => {
  it("returns born-in and imported items, sanitized, with where an import came from", async () => {
    db.respond = (q) => {
      if (q.table === "generation_sessions" && has(q, "eq", "id", SESSION)) return { data: SESSION_ROW, error: null }
      if (q.table === "generation_sessions") return { data: [{ id: OTHER_SESSION, title: "Summer 2026" }], error: null }
      if (q.table === "session_items") {
        return {
          data: [
            { job_id: JOB_B, kind: "imported", added_at: "2026-10-15T11:00:00+00:00", imported_from_session_id: OTHER_SESSION,
              job: { id: JOB_B, status: "completed", user_id: OWNER, provider: "kie", provider_cost: 0.1, output_data: { imageUrl: "b" } } },
            { job_id: JOB_A, kind: "native", added_at: "2026-10-15T10:01:00+00:00", imported_from_session_id: null,
              job: { id: JOB_A, status: "completed", user_id: OWNER, output_data: { imageUrl: "a" } } },
          ],
          error: null,
        }
      }
      return { data: null, error: null }
    }
    const res = await app.inject({ method: "GET", url: `/v1/sessions/${SESSION}/items`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    const [imported, native] = res.json().data
    expect(imported).toMatchObject({ jobId: JOB_B, imported: true, importedFrom: { sessionId: OTHER_SESSION, title: "Summer 2026" } })
    expect(imported.job.provider).toBeUndefined()
    expect(imported.job.provider_cost).toBeUndefined()
    expect(native).toMatchObject({ jobId: JOB_A, imported: false, importedFrom: null })

    const [items] = queries("session_items")
    expect(has(items, "eq", "session_id", SESSION)).toBe(true)
    expect(has(items, "eq", "user_id", OWNER)).toBe(true)
  })

  it("404s a session that is not the caller's, and reads no items", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/sessions/${SESSION}/items`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(404)
    expect(queries("session_items")).toHaveLength(0)
  })
})

describe("POST /v1/sessions/:id/items (import)", () => {
  function respondWithJobs(jobs: Array<{ id: string; session_id: string | null }>) {
    db.respond = (q) => {
      if (q.table === "generation_sessions") return { data: SESSION_ROW, error: null }
      if (q.table === "jobs") return { data: jobs, error: null }
      if (q.table === "session_items") {
        const rows = argOf(q, "upsert")![0] as Array<{ job_id: string }>
        return { data: rows.map((r) => ({ job_id: r.job_id })), error: null }
      }
      return { data: null, error: null }
    }
  }

  it("links the caller's own jobs, remembering where each was born", async () => {
    respondWithJobs([{ id: JOB_A, session_id: OTHER_SESSION }, { id: JOB_B, session_id: SESSION }])
    const res = await app.inject({
      method: "POST", url: `/v1/sessions/${SESSION}/items`, headers: { "x-user-id": OWNER },
      payload: { jobIds: [JOB_A, JOB_B, JOB_A] },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data).toEqual({ imported: 2, requested: 2 })

    const [jobLookup] = queries("jobs")
    expect(has(jobLookup, "eq", "user_id", OWNER)).toBe(true)
    expect(has(jobLookup, "is", "workspace_id", null)).toBe(true)
    const [upsert] = queries("session_items", "upsert")
    expect(argOf(upsert, "upsert")).toEqual([
      [
        { session_id: SESSION, user_id: OWNER, job_id: JOB_A, kind: "imported", imported_from_session_id: OTHER_SESSION },
        { session_id: SESSION, user_id: OWNER, job_id: JOB_B, kind: "imported", imported_from_session_id: null },
      ],
      { onConflict: "session_id,job_id", ignoreDuplicates: true },
    ])
  })

  it("is all-or-nothing: one job that is not the caller's imports nothing (404)", async () => {
    respondWithJobs([{ id: JOB_A, session_id: null }])
    const res = await app.inject({
      method: "POST", url: `/v1/sessions/${SESSION}/items`, headers: { "x-user-id": OWNER },
      payload: { jobIds: [JOB_A, JOB_B] },
    })
    expect(res.statusCode).toBe(404)
    expect(queries("session_items")).toHaveLength(0)
  })

  it("caps a call at 100 ids", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
    const res = await app.inject({
      method: "POST", url: `/v1/sessions/${SESSION}/items`, headers: { "x-user-id": OWNER },
      payload: { jobIds: ids },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe("DELETE /v1/sessions/:id/items/:jobId (remove)", () => {
  it("deletes only the link, scoped to the caller", async () => {
    db.respond = (q) => {
      if (q.table === "generation_sessions") return { data: SESSION_ROW, error: null }
      if (q.table === "session_items") return { data: [{ job_id: JOB_A }], error: null }
      return { data: null, error: null }
    }
    const res = await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    const [del] = queries("session_items", "delete")
    expect(has(del, "eq", "session_id", SESSION)).toBe(true)
    expect(has(del, "eq", "job_id", JOB_A)).toBe(true)
    expect(has(del, "eq", "user_id", OWNER)).toBe(true)
    expect(queries("jobs")).toHaveLength(0)
  })

  it("404s an item that is not in the session", async () => {
    db.respond = (q) => {
      if (q.table === "generation_sessions") return { data: SESSION_ROW, error: null }
      return { data: [], error: null }
    }
    const res = await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}/items/${JOB_A}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(404)
  })
})

describe("PATCH and DELETE /v1/sessions/:id", () => {
  it("renames and archives the caller's own session; the project is not a field", async () => {
    db.respond = () => ({ data: SESSION_ROW, error: null })
    const res = await app.inject({
      method: "PATCH", url: `/v1/sessions/${SESSION}`, headers: { "x-user-id": OWNER },
      payload: { title: "Beach day", archived: true, projectId: PROJECT },
    })
    expect(res.statusCode).toBe(200)
    const [update] = queries("generation_sessions", "update")
    const set = argOf(update, "update")![0] as Record<string, unknown>
    expect(set.title).toBe("Beach day")
    expect(typeof set.archived_at).toBe("string")
    expect("project_id" in set).toBe(false)
    expect(has(update, "eq", "user_id", OWNER)).toBe(true)
  })

  it("404s deleting a session that is not the caller's, and deletes nothing", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/sessions/${SESSION}`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(404)
    expect(queries("generation_sessions", "delete")).toHaveLength(0)
  })
})
