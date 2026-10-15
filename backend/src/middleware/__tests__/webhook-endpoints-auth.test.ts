/**
 * /v1/webhook-endpoints is NOT anonymous.
 *
 * The auth hook lets `/v1/webhooks` through by PREFIX (`path.startsWith`) —
 * that is the workflow trigger `POST /v1/webhooks/:token`, where the token is
 * the auth. The endpoint routes live beside it on purpose and must never be
 * caught by that prefix: every one answers 401 without a credential. Pinned
 * three ways: the matcher, the OpenAPI lens (`isAnonymousRoute`), and the real
 * hook in front of the real routes.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => {
      throw new Error("an anonymous request must not reach the database")
    }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
  },
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute, registerAuthHook } from "../auth.js"
import { webhookEndpointRoutes } from "../../routes/webhook-endpoints.js"

const ID = "00000000-0000-4000-8000-0000000000e1"

const ROUTES: Array<[string, string]> = [
  ["POST", "/v1/webhook-endpoints"],
  ["GET", "/v1/webhook-endpoints"],
  ["GET", `/v1/webhook-endpoints/${ID}`],
  ["PATCH", `/v1/webhook-endpoints/${ID}`],
  ["DELETE", `/v1/webhook-endpoints/${ID}`],
  ["POST", `/v1/webhook-endpoints/${ID}/rotate-secret`],
  ["GET", `/v1/webhook-endpoints/${ID}/deliveries`],
  ["GET", `/v1/webhook-endpoints/${ID}/deliveries/${ID}`],
  ["POST", `/v1/webhook-endpoints/${ID}/test`],
]

describe("the public-route matcher", () => {
  it.each(ROUTES)("%s %s is not public", (method, url) => {
    expect(isPublicRoute(method, url)).toBe(false)
    expect(isPublicRoute(method, `${url}?limit=5`)).toBe(false)
    expect(isAnonymousRoute(method, url)).toBe(false)
  })

  it("the inbound trigger beside it stays public (token is the auth)", () => {
    expect(isPublicRoute("POST", "/v1/webhooks/abc123")).toBe(true)
  })
})

describe("the auth hook in front of the routes", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify({ logger: false })
    registerAuthHook(app)
    await app.register(webhookEndpointRoutes)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it.each(ROUTES)("%s %s answers 401 without a credential", async (method, url) => {
    const res = await app.inject({
      method: method as "GET",
      url,
      ...(method === "POST" || method === "PATCH" ? { payload: { url: "https://hooks.example.com/in", isActive: false } } : {}),
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("and 401 with a bearer that does not resolve", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/webhook-endpoints",
      headers: { authorization: "Bearer eyJ.not-a-session" },
    })
    expect(res.statusCode).toBe(401)
  })
})
