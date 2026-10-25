/**
 * DELETE /v1/jobs/:id (to the Trash, `?forever=true`) and POST
 * /v1/jobs/:id/restore (routes/job-trash.ts, lib/job-trash.ts).
 *
 * What must hold: a delete only stamps `deleted_at` (never deletes, never
 * refunds) and is the caller's own non-child job; a retried delete keeps the
 * purge date; delete-for-good refuses a live job (409 `not_in_trash`) and goes
 * through the one job delete, re-checked under its lock; restore clears the
 * stamp; an OAuth app needs `assets:write`; a miss is 404.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { argOf, has, type QueryResult, type RecordedQuery } from "../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))
const deleteJob = vi.hoisted(() => vi.fn(async (_args: unknown) => true))

vi.mock("../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})
vi.mock("../../lib/workflow-delete.js", () => ({ deleteJobWithPrivateMedia: deleteJob }))

import { registerJobTrashRoutes } from "../job-trash.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const JOB = "00000000-0000-4000-8000-0000000000a1"

let app: FastifyInstance

function jobsQueries(op?: string): RecordedQuery[] {
  return db.log.filter((q) => q.table === "jobs" && (!op || argOf(q, op)))
}

beforeEach(async () => {
  db.log.length = 0
  deleteJob.mockReset()
  deleteJob.mockResolvedValue(true)
  db.respond = () => ({ data: null, error: null })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const role = req.headers["x-role"]
    if (typeof role === "string") req.userRole = role as never
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") req.appAuthorization = { scopes: scopes.split(" ") } as never
  })
  app.register(async (a) => registerJobTrashRoutes(a))
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const del = (query = "", headers: Record<string, string> = { "x-user-id": OWNER }) =>
  app.inject({ method: "DELETE", url: `/v1/jobs/${JOB}${query}`, headers })

describe("DELETE /v1/jobs/:id — to the Trash", () => {
  it("stamps deleted_at on the caller's own live non-child job, and deletes nothing", async () => {
    db.respond = (q) => (argOf(q, "update") ? { data: [{ id: JOB }], error: null } : { data: null, error: null })
    const res = await del()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true })
    const [update] = jobsQueries("update")
    const set = argOf(update!, "update")![0] as Record<string, unknown>
    expect(typeof set.deleted_at).toBe("string")
    // Its idempotency key is freed: a request sent again makes a new job, never this hidden one.
    expect(set).toHaveProperty("idempotency_key", null)
    expect(has(update!, "eq", "id", JOB)).toBe(true)
    expect(has(update!, "eq", "user_id", OWNER)).toBe(true)
    expect(has(update!, "is", "parent_job_id", null)).toBe(true)
    // Only a live job is stamped: a retry never moves the purge date.
    expect(has(update!, "is", "deleted_at", null)).toBe(true)
    expect(jobsQueries("delete")).toHaveLength(0)
    expect(deleteJob).not.toHaveBeenCalled()
  })

  it("a retried delete of a job already in the Trash succeeds without restamping", async () => {
    db.respond = (q) => {
      if (argOf(q, "update")) return { data: [], error: null }
      return { data: { id: JOB, deleted_at: "2026-10-20T00:00:00Z" }, error: null }
    }
    const res = await del()
    expect(res.statusCode).toBe(200)
    expect(jobsQueries("update")).toHaveLength(1)
  })

  it("404s a job that is not the caller's", async () => {
    db.respond = (q) => (argOf(q, "update") ? { data: [], error: null } : { data: null, error: null })
    const res = await del()
    expect(res.statusCode).toBe(404)
    const lookup = jobsQueries().find((q) => !argOf(q, "update"))!
    expect(has(lookup, "eq", "user_id", OWNER)).toBe(true)
  })

  it("404s an id that is not a uuid without reading", async () => {
    const res = await app.inject({ method: "DELETE", url: "/v1/jobs/not-a-job", headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(404)
    expect(db.log).toHaveLength(0)
  })

  it("an admin reaches any job (no owner filter)", async () => {
    db.respond = (q) => (argOf(q, "update") ? { data: [{ id: JOB }], error: null } : { data: null, error: null })
    await del("", { "x-user-id": OWNER, "x-role": "admin" })
    const [update] = jobsQueries("update")
    expect(has(update!, "eq", "user_id", OWNER)).toBe(false)
  })

  it("an OAuth app needs assets:write", async () => {
    const res = await del("", { "x-user-id": OWNER, "x-app-scopes": "jobs:read" })
    expect(res.statusCode).toBe(403)
    expect(db.log).toHaveLength(0)
  })

  it("401s without a caller", async () => {
    const res = await del("", {})
    expect(res.statusCode).toBe(401)
  })
})

describe("DELETE /v1/jobs/:id?forever=true", () => {
  it("409s not_in_trash for a live job, and deletes nothing", async () => {
    db.respond = () => ({ data: { id: JOB, deleted_at: null }, error: null })
    const res = await del("?forever=true")
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_in_trash")
    expect(deleteJob).not.toHaveBeenCalled()
  })

  it("deletes a job in the Trash for good, through the one job delete, only-trashed", async () => {
    db.respond = () => ({ data: { id: JOB, deleted_at: "2026-10-20T00:00:00Z" }, error: null })
    const res = await del("?forever=true")
    expect(res.statusCode).toBe(200)
    expect(deleteJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: JOB, actorUserId: OWNER, isAdmin: false, onlyTrashedBefore: "infinity" }),
    )
  })

  it("409s when the job was restored between the read and the delete", async () => {
    db.respond = () => ({ data: { id: JOB, deleted_at: "2026-10-20T00:00:00Z" }, error: null })
    deleteJob.mockResolvedValue(false)
    const res = await del("?forever=true")
    expect(res.statusCode).toBe(409)
  })

  it("404s a job that is not the caller's", async () => {
    const res = await del("?forever=true")
    expect(res.statusCode).toBe(404)
    expect(deleteJob).not.toHaveBeenCalled()
  })
})

describe("POST /v1/jobs/:id/restore", () => {
  it("clears deleted_at on the caller's own job in the Trash", async () => {
    db.respond = (q) => (argOf(q, "update") ? { data: [{ id: JOB }], error: null } : { data: null, error: null })
    const res = await app.inject({ method: "POST", url: `/v1/jobs/${JOB}/restore`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
    const [update] = jobsQueries("update")
    expect(argOf(update!, "update")![0]).toEqual({ deleted_at: null })
    expect(has(update!, "eq", "user_id", OWNER)).toBe(true)
    expect(has(update!, "not", "deleted_at", "is", null)).toBe(true)
  })

  it("a live job answers success", async () => {
    db.respond = (q) => (argOf(q, "update") ? { data: [], error: null } : { data: { id: JOB, deleted_at: null }, error: null })
    const res = await app.inject({ method: "POST", url: `/v1/jobs/${JOB}/restore`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(200)
  })

  it("404s a job that is not the caller's", async () => {
    db.respond = (q) => (argOf(q, "update") ? { data: [], error: null } : { data: null, error: null })
    const res = await app.inject({ method: "POST", url: `/v1/jobs/${JOB}/restore`, headers: { "x-user-id": OWNER } })
    expect(res.statusCode).toBe(404)
  })

  it("an OAuth app needs assets:write", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/jobs/${JOB}/restore`, headers: { "x-user-id": OWNER, "x-app-scopes": "jobs:read" },
    })
    expect(res.statusCode).toBe(403)
  })
})
