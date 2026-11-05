/**
 * /v1/content-rights (routes/content-rights.ts): the declaration is readable
 * by anyone; a confirmation needs a signed-in account and a usable link, and
 * answers the id a download then carries; a stale version is a 409. The
 * standing authorization is read by any signed-in caller and given or
 * revoked by the person's own session only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const fake = vi.hoisted(() => ({
  createConfirmation: vi.fn(),
  createStandingAuthorization: vi.fn(),
  currentStandingAuthorization: vi.fn(),
  revokeStandingAuthorization: vi.fn(),
  currentDeclaration: vi.fn(async () => ({ version: 1, text: "I confirm that I hold the rights.", hash: "h1" })),
}))

vi.mock("../../lib/content-rights.js", () => ({
  ContentRightsError: class ContentRightsError extends Error {
    constructor(readonly code: string, message: string) {
      super(message)
    }
  },
  createConfirmation: fake.createConfirmation,
  createStandingAuthorization: fake.createStandingAuthorization,
  currentStandingAuthorization: fake.currentStandingAuthorization,
  revokeStandingAuthorization: fake.revokeStandingAuthorization,
  currentDeclaration: fake.currentDeclaration,
}))
vi.mock("../../lib/client-address.js", () => ({ clientAddress: () => "203.0.113.7" }))
vi.mock("../../middleware/rate-limit.js", () => ({ rateLimiter: () => async () => undefined }))

import { contentRightsRoutes } from "../content-rights.js"
import { ContentRightsError } from "../../lib/content-rights.js"
import { IMPORT_VIA_HEADER } from "../../lib/import-via.js"

const STANDING = { id: "a1", userId: "u1", declarationVersion: 1, createdAt: "2026-11-02T07:00:00Z" }

let app: FastifyInstance

beforeEach(async () => {
  fake.createConfirmation.mockReset()
  fake.createConfirmation.mockResolvedValue({ id: "c1", declarationVersion: 1, expiresAt: "2026-11-02T07:00:00Z" })
  fake.createStandingAuthorization.mockReset()
  fake.createStandingAuthorization.mockResolvedValue(STANDING)
  fake.currentStandingAuthorization.mockReset()
  fake.currentStandingAuthorization.mockResolvedValue(null)
  fake.revokeStandingAuthorization.mockReset()
  fake.revokeStandingAuthorization.mockResolvedValue(1)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    // `x-app: 1` is a connected app's call; its scopes are `x-app-scopes`
    // (space-separated), a writing app when absent.
    if (req.headers["x-app"] === "1") {
      const scopes = req.headers["x-app-scopes"]
      req.appAuthorization = {
        appId: "app-1",
        authorizationId: "11111111-1111-4111-8111-111111111111",
        scopes: typeof scopes === "string" ? scopes.split(" ") : ["assets:write"],
      } as never
      req.authKind = "app_token"
    } else if (req.headers["x-key"] === "1") req.authKind = "api_token"
    else if (req.headers["x-internal"] === "1") req.authKind = "internal"
    else if (typeof user === "string") req.authKind = "jwt"
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
    const backslash = String.fromCharCode(0x5c)
    const tab = String.fromCharCode(9)
    for (const url of ["ftp://example.com/talk.mp4", "http://127.0.0.1/talk.mp4", `https://example.com${backslash}@10.0.0.1/talk.mp4`, `https://example.com/ta${tab}lk.mp4`]) {
      const bad = await app.inject({ method: "POST", url: "/v1/content-rights/confirm", headers: { "x-user-id": "u1" }, payload: { url, declarationVersion: 1 } })
      expect(bad.statusCode, url).toBe(400)
      expect(bad.json().error.code).toBe("validation_error")
    }
    expect(fake.createConfirmation).not.toHaveBeenCalled()
  })

  it("any link a lane imports can be confirmed: a page, a sound file, a picture, not only a video's page", async () => {
    for (const url of ["https://example.com/talks/keynote", "https://files.example.com/talk.mp3", "https://images.example.com/photo.jpg"]) {
      const res = await app.inject({ method: "POST", url: "/v1/content-rights/confirm", headers: { "x-user-id": "u1" }, payload: { url, declarationVersion: 1 } })
      expect(res.statusCode, url).toBe(201)
      expect(fake.createConfirmation).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "u1", url }))
    }
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

  it("a connected app granted read scopes alone cannot confirm in the account's name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/content-rights/confirm",
      headers: { "x-user-id": "u1", "x-app": "1", "x-app-scopes": "jobs:read assets:read" },
      payload: { url: "https://youtu.be/abc", declarationVersion: 1 },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
    expect(fake.createConfirmation).not.toHaveBeenCalled()
  })

  it("the lane is the way in: a key's confirmation is `api`, an agent's over the internal lane is `mcp`, an unnamed internal one is `run`", async () => {
    const payload = { url: "https://youtu.be/abc", declarationVersion: 1 }
    await app.inject({ method: "POST", url: "/v1/content-rights/confirm", headers: { "x-user-id": "u1", "x-key": "1" }, payload })
    expect(fake.createConfirmation).toHaveBeenLastCalledWith(expect.objectContaining({ lane: "api" }))
    await app.inject({ method: "POST", url: "/v1/content-rights/confirm", headers: { "x-user-id": "u1", "x-internal": "1", [IMPORT_VIA_HEADER]: "mcp" }, payload })
    expect(fake.createConfirmation).toHaveBeenLastCalledWith(expect.objectContaining({ lane: "mcp" }))
    await app.inject({ method: "POST", url: "/v1/content-rights/confirm", headers: { "x-user-id": "u1", "x-internal": "1" }, payload })
    expect(fake.createConfirmation).toHaveBeenLastCalledWith(expect.objectContaining({ lane: "run" }))
  })

  it("a stale declaration version is a 409 with its code", async () => {
    fake.createConfirmation.mockRejectedValue(new ContentRightsError("rights_confirmation_stale", "The declaration changed"))
    const res = await app.inject({ method: "POST", url: "/v1/content-rights/confirm", headers: { "x-user-id": "u1" }, payload: { url: "https://youtu.be/abc", declarationVersion: 1 } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("rights_confirmation_stale")
  })
})

describe("/v1/content-rights/authorization", () => {
  it("GET needs a signed-in account and answers the current authorization, or null", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/content-rights/authorization" })).statusCode).toBe(401)
    const none = await app.inject({ method: "GET", url: "/v1/content-rights/authorization", headers: { "x-user-id": "u1" } })
    expect(none.statusCode).toBe(200)
    expect(none.json()).toEqual({ data: null })
    fake.currentStandingAuthorization.mockResolvedValue(STANDING)
    const some = await app.inject({ method: "GET", url: "/v1/content-rights/authorization", headers: { "x-user-id": "u1", "x-key": "1" } })
    expect(some.json()).toEqual({ data: { id: "a1", declarationVersion: 1, createdAt: "2026-11-02T07:00:00Z" } })
    expect(fake.currentStandingAuthorization).toHaveBeenCalledWith("u1")
  })

  it("POST records it for the person's session with the caller's address and agent, and answers it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/content-rights/authorization",
      headers: { "x-user-id": "u1", "user-agent": "browser/1.0" },
      payload: { declarationVersion: 1 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ data: { id: "a1", declarationVersion: 1, createdAt: "2026-11-02T07:00:00Z" } })
    expect(fake.createStandingAuthorization).toHaveBeenCalledWith({ userId: "u1", declarationVersion: 1, clientAddress: "203.0.113.7", userAgent: "browser/1.0" })
  })

  it("POST and DELETE refuse anything but the person's own session: a key, a connected app, an agent, and an internal hop naming `session` cannot authorize", async () => {
    for (const headers of [{ "x-key": "1" }, { "x-app": "1" }, { "x-internal": "1", [IMPORT_VIA_HEADER]: "mcp" }, { "x-internal": "1", [IMPORT_VIA_HEADER]: "session" }, { "x-internal": "1" }]) {
      const post = await app.inject({ method: "POST", url: "/v1/content-rights/authorization", headers: { "x-user-id": "u1", ...headers }, payload: { declarationVersion: 1 } })
      expect(post.statusCode, JSON.stringify(headers)).toBe(403)
      expect(post.json().error.code).toBe("forbidden")
      const del = await app.inject({ method: "DELETE", url: "/v1/content-rights/authorization", headers: { "x-user-id": "u1", ...headers } })
      expect(del.statusCode, JSON.stringify(headers)).toBe(403)
    }
    expect(fake.createStandingAuthorization).not.toHaveBeenCalled()
    expect(fake.revokeStandingAuthorization).not.toHaveBeenCalled()
    expect((await app.inject({ method: "POST", url: "/v1/content-rights/authorization", payload: { declarationVersion: 1 } })).statusCode).toBe(401)
    expect((await app.inject({ method: "DELETE", url: "/v1/content-rights/authorization" })).statusCode).toBe(401)
  })

  it("POST needs a version; a stale one is a 409 with its code", async () => {
    const bad = await app.inject({ method: "POST", url: "/v1/content-rights/authorization", headers: { "x-user-id": "u1" }, payload: {} })
    expect(bad.statusCode).toBe(400)
    fake.createStandingAuthorization.mockRejectedValue(new ContentRightsError("rights_confirmation_stale", "The declaration changed"))
    const stale = await app.inject({ method: "POST", url: "/v1/content-rights/authorization", headers: { "x-user-id": "u1" }, payload: { declarationVersion: 1 } })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe("rights_confirmation_stale")
  })

  it("DELETE revokes the person's authorization and says whether there was one", async () => {
    const res = await app.inject({ method: "DELETE", url: "/v1/content-rights/authorization", headers: { "x-user-id": "u1" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { revoked: true } })
    expect(fake.revokeStandingAuthorization).toHaveBeenCalledWith("u1")
    fake.revokeStandingAuthorization.mockResolvedValue(0)
    expect((await app.inject({ method: "DELETE", url: "/v1/content-rights/authorization", headers: { "x-user-id": "u1" } })).json()).toEqual({ data: { revoked: false } })
  })
})
