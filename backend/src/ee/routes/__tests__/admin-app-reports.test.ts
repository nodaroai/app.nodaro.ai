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
  for (const m of ["select", "eq", "order", "range", "update"]) obj[m] = vi.fn(() => obj)
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
  it("lists reports with total, newest first", async () => {
    const rows = [{ id: REPORT_ID, kind: "missing-picker", status: "new", title: "t" }]
    const c = chain({ data: rows, count: 1 })
    vi.mocked(supabase.from).mockReturnValue(c as never)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/app-reports",
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: rows, total: 1 })
    expect(c.order).toHaveBeenCalledWith("created_at", { ascending: false })
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
