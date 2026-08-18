import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/ee/middleware/require-admin.js", () => ({ requireAdmin: async () => {} }))

import { supabase } from "@/lib/supabase.js"
import { adminAppReportsRoutes } from "../admin-app-reports.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const REPORT_ID = "00000000-0000-4000-8000-0000000000aa"

/** Chainable+thenable Supabase stub (house style — admin-client-apps.test.ts). */
function chain(result: Record<string, unknown>) {
  const obj: Record<string, any> = {}
  for (const m of ["select", "eq", "in", "or", "order", "range", "update"]) obj[m] = vi.fn(() => obj)
  obj.then = (resolve: (v: unknown) => void) => Promise.resolve({ error: null, ...result }).then(resolve)
  return obj
}

let app: FastifyInstance

beforeEach(async () => {
  vi.mocked(supabase.from).mockReset()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as any).userId = header
  })
  await app.register(async (instance) => {
    await adminAppReportsRoutes(instance)
  })
  await app.ready()
})
afterEach(() => app.close())

describe("GET /v1/admin/app-reports", () => {
  it("lists reports with total, newest first (no user/job → null enrichment, no extra queries)", async () => {
    const rows = [{ id: REPORT_ID, kind: "missing-picker", status: "new", title: "t" }]
    const c = chain({ data: rows, count: 1 })
    vi.mocked(supabase.from).mockReturnValue(c as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/app-reports",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: rows.map((r) => ({ ...r, user_email: null, job: null, execution: null })),
      total: 1,
    })
    expect(c.order).toHaveBeenCalledWith("created_at", { ascending: false })
    expect(vi.mocked(supabase.from)).toHaveBeenCalledTimes(1) // no enrichment lookups without ids
  })

  it("enriches rows with the user's email and the job's context (source, execution trigger, app slug, error)", async () => {
    const JOB_ID = "00000000-0000-4000-8000-0000000000bb"
    const EXEC_ID = "00000000-0000-4000-8000-0000000000cc"
    const APP_ID = "00000000-0000-4000-8000-0000000000dd"
    const rows = [
      { id: REPORT_ID, kind: "model-rejection", status: "new", title: "t", user_id: TEST_USER_ID, job_id: JOB_ID },
    ]
    const chains: Record<string, any> = {
      app_reports: chain({ data: rows, count: 1 }),
      profiles: chain({ data: [{ id: TEST_USER_ID, email: "user@example.com" }] }),
      jobs: chain({
        data: [{
          id: JOB_ID, status: "failed", model_identifier: "kling", provider: "kie",
          error_message: "content policy", source: null, source_detail: null,
          workflow_execution_id: EXEC_ID,
        }],
      }),
      workflow_executions: chain({ data: [{ id: EXEC_ID, trigger_type: "manual", mcp_client: null }] }),
      app_runs: chain({ data: [{ execution_id: EXEC_ID, app_id: APP_ID }] }),
      published_apps: chain({ data: [{ id: APP_ID, slug: "person" }] }),
    }
    vi.mocked(supabase.from).mockImplementation(((table: string) => chains[table]) as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/app-reports",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    const row = res.json().data[0]
    expect(row.user_email).toBe("user@example.com")
    expect(row.job).toEqual({
      status: "failed",
      model_identifier: "kling",
      provider: "kie",
      error_message: "content policy",
      source: null,
      source_detail: null,
      workflow_execution_id: EXEC_ID,
      execution_trigger: "manual",
      mcp_client: null,
      app_slug: "person",
    })
    expect(chains.profiles.in).toHaveBeenCalledWith("id", [TEST_USER_ID])
    expect(chains.jobs.in).toHaveBeenCalledWith("id", [JOB_ID])
  })

  it("filters by userId and excludes admin ids null-safely (bogus ids dropped)", async () => {
    const ADMIN_A = "00000000-0000-4000-8000-00000000ad01"
    const ADMIN_B = "00000000-0000-4000-8000-00000000ad02"
    const c = chain({ data: [], count: 0 })
    vi.mocked(supabase.from).mockReturnValue(c as never)

    const byUser = await app.inject({
      method: "GET",
      url: `/v1/admin/app-reports?userId=${TEST_USER_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(byUser.statusCode).toBe(200)
    expect(c.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID)

    const excl = await app.inject({
      method: "GET",
      url: `/v1/admin/app-reports?excludeUserIds=${ADMIN_A},not-a-uuid,${ADMIN_B}`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(excl.statusCode).toBe(200)
    // NULL-user (platform-internal) reports stay visible; the bogus id is dropped.
    expect(c.or).toHaveBeenCalledWith(`user_id.is.null,user_id.not.in.(${ADMIN_A},${ADMIN_B})`)

    // A userId that is not a UUID is ignored, not passed to the query.
    const bogusUser = await app.inject({
      method: "GET",
      url: "/v1/admin/app-reports?userId=strange';drop--",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(bogusUser.statusCode).toBe(200)
    expect(c.eq).not.toHaveBeenCalledWith("user_id", "strange';drop--")
  })

  it("resolves execution context for execution-keyed reports (no job)", async () => {
    const EXEC_ID = "00000000-0000-4000-8000-0000000000cc"
    const rows = [
      { id: REPORT_ID, kind: "execution-failure", status: "new", title: "t", user_id: null, job_id: null, execution_id: EXEC_ID },
    ]
    const chains: Record<string, any> = {
      app_reports: chain({ data: rows, count: 1 }),
      workflow_executions: chain({ data: [{ id: EXEC_ID, trigger_type: "webhook", mcp_client: null }] }),
      app_runs: chain({ data: [] }),
    }
    vi.mocked(supabase.from).mockImplementation(((table: string) => chains[table]) as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/app-reports",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].execution).toEqual({ trigger_type: "webhook", mcp_client: null, app_slug: null })
    expect(chains.workflow_executions.in).toHaveBeenCalledWith("id", [EXEC_ID])
  })

  it("degrades to nulls when the referenced user/job rows are gone", async () => {
    const rows = [
      { id: REPORT_ID, kind: "internal-error", status: "new", title: "t", user_id: TEST_USER_ID, job_id: "00000000-0000-4000-8000-0000000000ee" },
    ]
    const chains: Record<string, any> = {
      app_reports: chain({ data: rows, count: 1 }),
      profiles: chain({ data: [] }),
      jobs: chain({ data: [] }),
    }
    vi.mocked(supabase.from).mockImplementation(((table: string) => chains[table]) as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/app-reports",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data[0].user_email).toBeNull()
    expect(res.json().data[0].job).toBeNull()
  })

  it("applies kind/appSlug/status filters as eq clauses", async () => {
    const c = chain({ data: [], count: 0 })
    vi.mocked(supabase.from).mockReturnValue(c as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/app-reports?kind=model-rejection&appSlug=person&status=new",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(c.eq).toHaveBeenCalledWith("kind", "model-rejection")
    expect(c.eq).toHaveBeenCalledWith("app_slug", "person")
    expect(c.eq).toHaveBeenCalledWith("status", "new")
  })
})

describe("PATCH /v1/admin/app-reports/:id", () => {
  it("updates the triage status", async () => {
    const c = chain({})
    vi.mocked(supabase.from).mockReturnValue(c as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/admin/app-reports/${REPORT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { status: "resolved" },
    })
    expect(res.statusCode).toBe(200)
    expect(c.update).toHaveBeenCalledWith({ status: "resolved" })
    expect(c.eq).toHaveBeenCalledWith("id", REPORT_ID)
  })

  it("rejects an unknown status and a malformed id", async () => {
    const bad = await app.inject({
      method: "PATCH",
      url: `/v1/admin/app-reports/${REPORT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { status: "sparkling" },
    })
    expect(bad.statusCode).toBe(400)

    const badId = await app.inject({
      method: "PATCH",
      url: "/v1/admin/app-reports/not-a-uuid",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { status: "reviewed" },
    })
    expect(badId.statusCode).toBe(400)
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })
})
