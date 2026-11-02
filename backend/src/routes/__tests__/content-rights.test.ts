/**
 * /v1/content-rights (routes/content-rights.ts): the declaration is readable
 * by anyone; a confirmation needs a signed-in account and a usable link, and
 * answers the id a download then carries; a stale version is a 409.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const fake = vi.hoisted(() => ({
  createConfirmation: vi.fn(),
  currentDeclaration: vi.fn(async () => ({ version: 1, text: "I confirm that I hold the rights.", hash: "h1" })),
}))

vi.mock("../../lib/content-rights.js", () => ({
  ContentRightsError: class ContentRightsError extends Error {
    constructor(readonly code: string, message: string) {
      super(message)
    }
  },
  createConfirmation: fake.createConfirmation,
  currentDeclaration: fake.currentDeclaration,
}))
vi.mock("../../lib/client-address.js", () => ({ clientAddress: () => "203.0.113.7" }))
vi.mock("../../middleware/rate-limit.js", () => ({ rateLimiter: () => async () => undefined }))

import { contentRightsRoutes } from "../content-rights.js"
import { ContentRightsError } from "../../lib/content-rights.js"

let app: FastifyInstance

beforeEach(async () => {
  fake.createConfirmation.mockReset()
  fake.createConfirmation.mockResolvedValue({ id: "c1", declarationVersion: 1, expiresAt: "2026-11-02T07:00:00Z" })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    if (req.headers["x-app"] === "1") {
      req.appAuthorization = { appId: "app-1", authorizationId: "11111111-1111-4111-8111-111111111111", scopes: [] } as never
      req.authKind = "app_token"
    } else if (typeof user === "string") req.authKind = "jwt"
  })
  await app.register(contentRightsRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

describe("GET /v1/content-rights/declaration", () => {
  it("answers the current text and version", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/content-rights/declaration" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { version: 1, text: "I confirm that I hold the rights." } })
  })
})

describe("POST /v1/content-rights/confirm", () => {
  it("needs a signed-in account and a usable link", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/content-rights/confirm", payload: { url: "https://youtu.be/abc", declarationVersion: 1 } })).statusCode).toBe(401)
    const bad = await app.inject({ method: "POST", url: "/v1/content-rights/confirm", headers: { "x-user-id": "u1" }, payload: { url: "https://example.com/page", declarationVersion: 1 } })
    expect(bad.statusCode).toBe(400)
    expect(JSON.stringify(bad.json().error)).toContain("link to a video's page")
    expect(fake.createConfirmation).not.toHaveBeenCalled()
  })

  it("records the confirmation with the caller's address, agent and app grant, and answers its id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/content-rights/confirm",
      headers: { "x-user-id": "u1", "x-app": "1", "user-agent": "tools/1.0" },
      payload: { url: "https://youtu.be/abc", declarationVersion: 1 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ data: { id: "c1", declarationVersion: 1, expiresAt: "2026-11-02T07:00:00Z" } })
    expect(fake.createConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", url: "https://youtu.be/abc", declarationVersion: 1, lane: "app", appId: "app-1", authorizationId: "11111111-1111-4111-8111-111111111111", clientAddress: "203.0.113.7", userAgent: "tools/1.0" }),
    )
    await app.inject({ method: "POST", url: "/v1/content-rights/confirm", headers: { "x-user-id": "u1" }, payload: { url: "https://youtu.be/abc", declarationVersion: 1 } })
    expect(fake.createConfirmation).toHaveBeenLastCalledWith(expect.objectContaining({ lane: "editor", appId: null }))
  })

  it("a stale declaration version is a 409 with its code", async () => {
    fake.createConfirmation.mockRejectedValue(new ContentRightsError("rights_confirmation_stale", "The declaration changed"))
    const res = await app.inject({ method: "POST", url: "/v1/content-rights/confirm", headers: { "x-user-id": "u1" }, payload: { url: "https://youtu.be/abc", declarationVersion: 1 } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("rights_confirmation_stale")
  })
})
