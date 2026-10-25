/**
 * GET /v1/trash (routes/trash.ts, lib/trash-listing.ts).
 *
 * What must hold: the page is one `list_trash` call scoped to the caller and
 * the request's side of the workspace line, with the scope mapped exactly
 * (`projectId=none` is the no-project flag, never a project id); entries come
 * back newest first in both kinds, removed with their session and deleted with
 * their purge date, jobs through the public sanitizer, read as the caller's
 * own; the cursor round-trips and a foreign one is a 400; reads need jobs:read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { has, type QueryResult, type RecordedQuery } from "../../lib/__tests__/fake-supabase-query.js"

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

import { trashRoutes } from "../trash.js"
import { decodeTrashCursor, encodeTrashCursor } from "../../lib/trash-listing.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const WORKSPACE = "00000000-0000-4000-8000-0000000000f1"
const PROJECT = "00000000-0000-4000-8000-000000000010"
const SESSION = "00000000-0000-4000-8000-000000000020"
const JOB_A = "00000000-0000-4000-8000-0000000000a1"
const JOB_B = "00000000-0000-4000-8000-0000000000b1"

let app: FastifyInstance

beforeEach(async () => {
  db.log.length = 0
  db.rpc.mockReset()
  db.rpc.mockResolvedValue({ data: [], error: null })
  db.respond = () => ({ data: [], error: null })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const ws = req.headers["x-workspace-id"]
    if (typeof ws === "string") req.workspaceId = ws
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") req.appAuthorization = { scopes: scopes.split(" ") } as never
  })
  await app.register(trashRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const as = { "x-user-id": OWNER }

describe("GET /v1/trash", () => {
  it("maps the scope onto one list_trash call for the caller and their workspace", async () => {
    await app.inject({
      method: "GET", url: `/v1/trash?tool=create-image&projectId=${PROJECT}&type=generate-image,edit-image&limit=10`,
      headers: { ...as, "x-workspace-id": WORKSPACE },
    })
    expect(db.rpc).toHaveBeenCalledWith("list_trash", {
      p_user_id: OWNER, p_workspace_id: WORKSPACE, p_tool: "create-image", p_project_id: PROJECT, p_no_project: false,
      p_types: ["generate-image", "edit-image"], p_before_at: null, p_before_key: null, p_limit: 10,
    })
  })

  it("projectId=none is the no-project flag, never a project id; no scope is everywhere", async () => {
    await app.inject({ method: "GET", url: "/v1/trash?projectId=none", headers: as })
    expect(db.rpc).toHaveBeenLastCalledWith("list_trash", expect.objectContaining({ p_project_id: null, p_no_project: true, p_workspace_id: null }))
    await app.inject({ method: "GET", url: "/v1/trash", headers: as })
    expect(db.rpc).toHaveBeenLastCalledWith("list_trash", expect.objectContaining({ p_project_id: null, p_no_project: false, p_tool: null, p_types: null, p_limit: 50 }))
  })

  it("answers both kinds in the function's order, with session, purge date and sanitized jobs", async () => {
    db.rpc.mockResolvedValue({
      data: [
        { kind: "deleted", at: "2026-10-25T10:00:00+00:00", job_id: JOB_B, session_id: null, sort_key: `d:${JOB_B}` },
        { kind: "removed", at: "2026-10-24T10:00:00+00:00", job_id: JOB_A, session_id: SESSION, sort_key: `r:${SESSION}:${JOB_A}` },
      ],
      error: null,
    })
    db.respond = (q) => {
      if (q.table === "jobs") {
        return {
          data: [
            { id: JOB_A, status: "completed", user_id: OWNER, provider: "kie", deleted_at: null, input_data: { type: "generate-image", userId: OWNER } },
            { id: JOB_B, status: "completed", user_id: OWNER, provider: "kie", deleted_at: "2026-10-25T10:00:00+00:00" },
          ],
          error: null,
        }
      }
      if (q.table === "generation_sessions") return { data: [{ id: SESSION, title: "Beach", project_id: PROJECT }], error: null }
      return { data: [], error: null }
    }
    const res = await app.inject({ method: "GET", url: "/v1/trash", headers: as })
    expect(res.statusCode).toBe(200)
    const [deleted, removed] = res.json().data
    expect(deleted).toMatchObject({ kind: "deleted", deletedAt: "2026-10-25T10:00:00+00:00", purgeAt: "2026-11-24T10:00:00.000Z" })
    expect(deleted.job).toMatchObject({ id: JOB_B, deleted_at: "2026-10-25T10:00:00+00:00" })
    expect(deleted.job.provider).toBeUndefined()
    expect(removed).toMatchObject({ kind: "removed", removedAt: "2026-10-24T10:00:00+00:00", session: { id: SESSION, title: "Beach", projectId: PROJECT } })
    expect(removed.job.input_data).toEqual({ type: "generate-image" })
    // The jobs and the sessions are read as the caller's own.
    const jobs = db.log.find((q) => q.table === "jobs")!
    expect(has(jobs, "eq", "user_id", OWNER)).toBe(true)
    expect(has(jobs, "is", "parent_job_id", null)).toBe(true)
    const sessions = db.log.find((q) => q.table === "generation_sessions")!
    expect(has(sessions, "eq", "user_id", OWNER)).toBe(true)
  })

  it("a full page carries the cursor of its last row, which round-trips into the next call", async () => {
    db.rpc.mockResolvedValue({
      data: [{ kind: "deleted", at: "2026-10-25T10:00:00.123456+00:00", job_id: JOB_B, session_id: null, sort_key: `d:${JOB_B}` }],
      error: null,
    })
    db.respond = (q) => (q.table === "jobs" ? { data: [{ id: JOB_B, status: "completed", user_id: OWNER }], error: null } : { data: [], error: null })
    const first = await app.inject({ method: "GET", url: "/v1/trash?limit=1", headers: as })
    const next = first.json().next as string
    expect(decodeTrashCursor(next)).toEqual({ at: "2026-10-25T10:00:00.123456+00:00", key: `d:${JOB_B}` })
    await app.inject({ method: "GET", url: `/v1/trash?limit=1&cursor=${next}`, headers: as })
    expect(db.rpc).toHaveBeenLastCalledWith("list_trash", expect.objectContaining({ p_before_at: "2026-10-25T10:00:00.123456+00:00", p_before_key: `d:${JOB_B}` }))
  })

  it("an entry whose job is gone (purged meanwhile) is dropped, and the page still pages on", async () => {
    db.rpc.mockResolvedValue({ data: [{ kind: "deleted", at: "2026-10-25T10:00:00+00:00", job_id: JOB_B, session_id: null, sort_key: `d:${JOB_B}` }], error: null })
    db.respond = () => ({ data: [], error: null })
    const res = await app.inject({ method: "GET", url: "/v1/trash?limit=1", headers: as })
    expect(res.json().data).toEqual([])
    expect(res.json().next).not.toBeNull()
  })

  it("400s a cursor this server did not issue, a bad tool and a bad projectId", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/trash?cursor=nope", headers: as })).statusCode).toBe(400)
    const forged = Buffer.from(JSON.stringify(["2026-10-25T10:00:00Z", "x:1"])).toString("base64url")
    expect((await app.inject({ method: "GET", url: `/v1/trash?cursor=${forged}`, headers: as })).statusCode).toBe(400)
    expect((await app.inject({ method: "GET", url: "/v1/trash?tool=Create%20Image", headers: as })).statusCode).toBe(400)
    expect((await app.inject({ method: "GET", url: "/v1/trash?projectId=all", headers: as })).statusCode).toBe(400)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it("an OAuth app needs jobs:read; no caller is 401", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/trash", headers: { ...as, "x-app-scopes": "assets:write" } })).statusCode).toBe(403)
    expect((await app.inject({ method: "GET", url: "/v1/trash" })).statusCode).toBe(401)
    expect(db.rpc).not.toHaveBeenCalled()
  })
})

describe("the Trash cursor", () => {
  it("round-trips both kinds of key", () => {
    for (const key of [`d:${JOB_A}`, `r:${SESSION}:${JOB_A}`]) {
      const c = { at: "2026-10-25 10:00:00.5+00", key }
      expect(decodeTrashCursor(encodeTrashCursor(c))).toEqual(c)
    }
  })
  it("refuses a time that is not Postgres's shape", () => {
    expect(decodeTrashCursor(encodeTrashCursor({ at: "(now)", key: `d:${JOB_A}` }))).toBeNull()
  })
})

