import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { InspectResult, SiteAnalyticsReport, SiteAnalyticsService } from "../../lib/site-analytics/site-analytics.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const USER = "00000000-0000-4000-8000-0000000000aa"

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => void } }) => {
    if (req.userId !== ADMIN) reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))

import { adminSiteAnalyticsRoutes } from "../admin-site-analytics.js"

const REPORT: SiteAnalyticsReport = {
  days: 28,
  setup: { serviceAccountEmail: null, ga4PropertyId: null, searchConsoleSite: null, problems: ["SITE_ANALYTICS_SERVICE_ACCOUNT_JSON is not set."] },
  traffic: { status: "not_configured" },
  search: { status: "not_configured" },
}

let app: FastifyInstance
let service: { report: ReturnType<typeof vi.fn>; inspect: ReturnType<typeof vi.fn> }

beforeEach(async () => {
  service = {
    report: vi.fn(async (days: number) => ({ ...REPORT, days })),
    inspect: vi.fn(async (): Promise<InspectResult> => ({ status: "not_configured" })),
  }
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") (req as { userId?: string }).userId = h
  })
  await app.register(adminSiteAnalyticsRoutes, { service: service as unknown as SiteAnalyticsService })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const get = (url: string, user = ADMIN) => app.inject({ method: "GET", url, headers: { "x-user-id": user } })
const inspect = (payload: unknown, user = ADMIN) =>
  app.inject({ method: "POST", url: "/v1/admin/site-analytics/inspect", payload: payload as Record<string, unknown>, headers: { "x-user-id": user } })

describe("GET /v1/admin/site-analytics", () => {
  it("is for admins only", async () => {
    expect((await get("/v1/admin/site-analytics", USER)).statusCode).toBe(403)
    expect(service.report).not.toHaveBeenCalled()
  })

  it("defaults to the last 28 days; takes 7 or 90; fresh=1 skips the stored report", async () => {
    const res = await get("/v1/admin/site-analytics")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(REPORT)
    expect(service.report).toHaveBeenLastCalledWith(28, { fresh: false })
    await get("/v1/admin/site-analytics?days=7")
    expect(service.report).toHaveBeenLastCalledWith(7, { fresh: false })
    await get("/v1/admin/site-analytics?days=90&fresh=1")
    expect(service.report).toHaveBeenLastCalledWith(90, { fresh: true })
  })

  it("any other range is refused", async () => {
    const res = await get("/v1/admin/site-analytics?days=5")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(service.report).not.toHaveBeenCalled()
  })
})

describe("POST /v1/admin/site-analytics/inspect", () => {
  it("is for admins only", async () => {
    expect((await inspect({ url: "https://nodaro.ai/" }, USER)).statusCode).toBe(403)
    expect(service.inspect).not.toHaveBeenCalled()
  })

  it("needs a web address", async () => {
    const res = await inspect({ url: "not a url" })
    expect(res.statusCode).toBe(400)
    expect(service.inspect).not.toHaveBeenCalled()
  })

  it("answers each outcome with its own status", async () => {
    service.inspect.mockResolvedValueOnce({ status: "not_in_site" })
    expect((await inspect({ url: "https://example.com/" })).json().error.code).toBe("not_in_site")

    service.inspect.mockResolvedValueOnce({ status: "not_configured" })
    expect((await inspect({ url: "https://nodaro.ai/" })).statusCode).toBe(503)

    service.inspect.mockResolvedValueOnce({ status: "error", httpStatus: 429, message: "Quota exceeded for quota metric 'Inspections'." })
    const quota = await inspect({ url: "https://nodaro.ai/" })
    expect(quota.statusCode).toBe(502)
    expect(quota.json().error).toEqual({ code: "google_error", message: "Quota exceeded for quota metric 'Inspections'." })

    service.inspect.mockResolvedValueOnce({ status: "error", httpStatus: 429, reason: "DAILY_BUDGET", message: "Today's budget of 1,500 page checks is used up." })
    const spent = await inspect({ url: "https://nodaro.ai/" })
    expect(spent.statusCode).toBe(429)
    expect(spent.json().error.code).toBe("daily_budget")

    const data = { url: "https://nodaro.ai/", verdict: "PASS", coverageState: "Submitted and indexed", checkedAt: "2026-10-08T12:00:00.000Z" }
    service.inspect.mockResolvedValueOnce({ status: "ok", data })
    const done = await inspect({ url: "https://nodaro.ai/", fresh: true })
    expect(done.statusCode).toBe(200)
    expect(done.json()).toEqual(data)
    expect(service.inspect).toHaveBeenLastCalledWith("https://nodaro.ai/", { fresh: true })
  })
})
