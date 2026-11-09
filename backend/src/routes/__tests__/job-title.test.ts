/**
 * PATCH /v1/jobs/:id — the owner names their job or clears its name. The
 * database side is proven in lib/__tests__/job-title.test.ts; this pins the
 * route's wiring: who may, what a bad name answers, and that the name then
 * passes every job read's allowlist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/job-title.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/job-title.js")>()
  return { ...actual, setJobTitle: vi.fn() }
})

import { registerJobTitleRoute } from "../job-title.js"
import { PUBLIC_JOB_KEYS, sanitizeJobForPublic, type JobRecord } from "../jobs.js"
import { SESSION_FEED_JOB_COLS } from "../../lib/generation-sessions.js"
import { setJobTitle } from "../../lib/job-title.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const JOB = "00000000-0000-4000-8000-0000000000c1"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Test identity from the query: `__userId`, an admin role, and OAuth-app scopes.
  app.addHook("onRequest", async (req) => {
    const q = req.query as Record<string, string | undefined>
    if (q.__userId) req.userId = q.__userId
    if (q.__admin) req.userRole = "admin"
    if (q.__scopes !== undefined) {
      ;(req as { appAuthorization?: unknown }).appAuthorization = {
        appId: "app1",
        authorizationId: "auth1",
        scopes: q.__scopes ? q.__scopes.split(",") : [],
      }
    }
  })
  await app.register(async (instance) => {
    registerJobTitleRoute(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const rename = async (query: string, body: object, id = JOB) => {
  const res = await app.inject({ method: "PATCH", url: `/v1/jobs/${id}?${query}`, payload: body })
  return res
}

describe("PATCH /v1/jobs/:id", () => {
  it("the owner names the job: trimmed, and answered as the job's name now", async () => {
    vi.mocked(setJobTitle).mockResolvedValue({ kind: "ok", title: "Wedding toast, final" })
    const res = await rename(`__userId=${OWNER}`, { title: "  Wedding toast, final  " })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { jobId: JOB, title: "Wedding toast, final" } })
    expect(setJobTitle).toHaveBeenCalledWith(OWNER, JOB, "Wedding toast, final")
  })

  it("null clears the name, and so does an empty string", async () => {
    vi.mocked(setJobTitle).mockResolvedValue({ kind: "ok", title: null })
    expect((await rename(`__userId=${OWNER}`, { title: null })).json()).toEqual({ data: { jobId: JOB, title: null } })
    expect((await rename(`__userId=${OWNER}`, { title: "" })).statusCode).toBe(200)
    expect(vi.mocked(setJobTitle).mock.calls.map((c) => c[2])).toEqual([null, null])
  })

  it("a name over 120 characters, or one that is not one line of plain text, is a 400 — nothing is written", async () => {
    const long = await rename(`__userId=${OWNER}`, { title: "x".repeat(121) })
    expect(long.statusCode).toBe(400)
    expect(long.json().error).toMatchObject({ code: "validation_error", message: expect.stringContaining("120") })
    const multiline = await rename(`__userId=${OWNER}`, { title: "two\nlines" })
    expect(multiline.statusCode).toBe(400)
    expect(multiline.json().error.message).toContain("plain text")
    const missing = await rename(`__userId=${OWNER}`, {})
    expect(missing.statusCode).toBe(400)
    const wrongType = await rename(`__userId=${OWNER}`, { title: 7 })
    expect(wrongType.statusCode).toBe(400)
    expect(setJobTitle).not.toHaveBeenCalled()
  })

  it("someone else's job is 404 — an admin's request included — and so is an id that cannot be a job", async () => {
    vi.mocked(setJobTitle).mockResolvedValue({ kind: "not_found" })
    expect((await rename(`__userId=${OTHER}`, { title: "Mine now" })).statusCode).toBe(404)
    expect(setJobTitle).toHaveBeenLastCalledWith(OTHER, JOB, "Mine now")
    expect((await rename(`__userId=${OTHER}&__admin=1`, { title: "Mine now" })).statusCode).toBe(404)
    expect((await rename(`__userId=${OWNER}`, { title: "x" }, "not-a-uuid")).statusCode).toBe(404)
  })

  it("needs a signed-in caller, and an OAuth app needs assets:write", async () => {
    vi.mocked(setJobTitle).mockResolvedValue({ kind: "ok", title: "x" })
    expect((await rename("", { title: "x" })).statusCode).toBe(401)
    expect((await rename(`__userId=${OWNER}&__scopes=jobs:read`, { title: "x" })).statusCode).toBe(403)
    expect((await rename(`__userId=${OWNER}&__scopes=assets:write`, { title: "x" })).statusCode).toBe(200)
  })

  it("a database failure is a 500, never a silent success", async () => {
    vi.mocked(setJobTitle).mockRejectedValue(new Error("db down"))
    expect((await rename(`__userId=${OWNER}`, { title: "x" })).statusCode).toBe(500)
  })
})

describe("the name reaches every job read", () => {
  it("is on the public allowlist, so GET /v1/jobs/:id, the list and the Trash answer it", () => {
    expect(PUBLIC_JOB_KEYS).toContain("title")
    const job = { id: JOB, status: "completed", user_id: OWNER, title: "Hero shot v2" } as unknown as JobRecord
    expect((sanitizeJobForPublic(job, false) as { title?: string | null }).title).toBe("Hero shot v2")
    expect((sanitizeJobForPublic({ ...job, title: null }, false) as { title?: string | null }).title).toBeNull()
  })

  it("is selected for a session's items (and the Trash, which reads the same columns)", () => {
    expect(SESSION_FEED_JOB_COLS.split(", ")).toContain("title")
  })
})
