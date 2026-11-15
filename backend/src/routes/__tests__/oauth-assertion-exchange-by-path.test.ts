import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * The MCP assertion exchange (decided 2026-11-11) on a deployment that serves
 * MCP by path on two declared hosts: on each host the application exchanges
 * with that host's MCP endpoint as its `resource`, and the token initializes
 * and lists tools there; a `resource` naming the other host's endpoint is not
 * the endpoint this request's host states, and is refused.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "off"
  process.env.PUBLIC_URL = "https://primary.example.com"
  process.env.MCP_PUBLIC_URL = ""
  process.env.CORS_ORIGIN = "https://second.example.com"
  process.env.FLOW_PUBLIC_URL = ""
  process.env.FLOW_UI_ORIGIN = ""
  process.env.LEGACY_UI_HOSTS = ""
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ mcp: { byPath: true } })
  process.env.MCP_ALLOWED_CLIENT_IDS = `app_${"5".repeat(32)}`
  process.env.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = `app_${"5".repeat(32)}`
  process.env.EXTERNAL_SSO_PROVIDERS = JSON.stringify([
    { id: "chat", label: "Chat", kind: "assertion", secret: "test-only-sso-hmac-secret-not-real", audience: "nodaro-sign-in", exchangeAudience: "nodaro-mcp-exchange", maxLifetimeSeconds: 300 },
  ])
  delete process.env.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS
})

const fake = vi.hoisted(() => ({ db: null as unknown }))

vi.mock("../../lib/supabase.js", async () => {
  const { newOAuthMemoryDb } = await import("./helpers/oauth-memory-db.js")
  const { exchangeSupabase } = await import("./helpers/assertion-exchange-harness.js")
  const db = newOAuthMemoryDb()
  fake.db = db
  return { supabase: exchangeSupabase(db).supabase }
})

vi.mock("../../lib/queue.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/queue.js")>()
  const { memoryRedis } = await import("./helpers/assertion-exchange-harness.js")
  return { ...actual, redis: memoryRedis().redis }
})

import { buildApp } from "../../app.js"
import { hashSecret } from "../developer-apps.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import type { OAuthMemoryDb } from "./helpers/oauth-memory-db.js"
import { INIT, MCP_HEADERS, seedLane } from "./helpers/mcp-lane-transcript.js"
import { JWT_BEARER, SECRET_CLIENT_ID, TOKEN_WALK_SECRET, seedSecretClient } from "./helpers/oauth-token-transcript.js"
import { exchangeRequest, signAssertion } from "./helpers/assertion-exchange-harness.js"

const HOSTS = [
  ["primary.example.com", "https://primary.example.com", "https://second.example.com"],
  ["second.example.com", "https://second.example.com", "https://primary.example.com"],
] as const

describe("the MCP assertion exchange with MCP served by path on two declared hosts", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    __resetSurfaceProfileCacheForTests()
    const db = fake.db as OAuthMemoryDb
    seedLane(db)
    seedSecretClient(db, await hashSecret(TOKEN_WALK_SECRET))
    app = await buildApp()
    const probe = await app.inject({ method: "GET", url: "/health" })
    const socketProto = Object.getPrototypeOf((probe.raw.req as unknown as { socket: object }).socket) as { destroySoon?: () => void }
    if (typeof socketProto.destroySoon !== "function") socketProto.destroySoon = () => {}
  })

  afterAll(async () => {
    await app.close()
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  it.each(HOSTS)("on %s: assertion → token → initialize and tools/list on that host", async (host, base) => {
    const res = await exchangeRequest(
      app,
      { client_id: SECRET_CLIENT_ID, client_secret: TOKEN_WALK_SECRET, assertion: await signAssertion({ email: `person@${host}`, sub: `idp-${host}` }), resource: `${base}/v1/mcp` },
      { host },
    )
    expect(res.statusCode, res.body).toBe(200)
    const bearer = (res.json() as { access_token: string }).access_token
    const init = await app.inject({ method: "POST", url: "/v1/mcp", headers: { host, ...MCP_HEADERS, authorization: `Bearer ${bearer}` }, payload: INIT })
    expect(init.statusCode, init.body).toBe(200)
    const list = await app.inject({ method: "POST", url: "/v1/mcp", headers: { host, ...MCP_HEADERS, authorization: `Bearer ${bearer}` }, payload: { jsonrpc: "2.0", id: 2, method: "tools/list" } })
    expect(list.statusCode).toBe(200)
    expect((list.json().result.tools as Array<{ name: string }>).length).toBeGreaterThan(1)
  })

  it.each(HOSTS)("on %s: the other host's endpoint, or the dedicated /mcp, is not this request's MCP endpoint", async (host, base, other) => {
    for (const resource of [`${other}/v1/mcp`, `${base}/mcp`]) {
      const res = await exchangeRequest(app, { client_id: SECRET_CLIENT_ID, client_secret: TOKEN_WALK_SECRET, assertion: await signAssertion(), resource }, { host })
      expect(res.statusCode, resource).toBe(400)
      expect(res.json()).toEqual({ error: "invalid_target", error_description: `resource must name this deployment's MCP endpoint: ${base}/v1/mcp` })
    }
  })

  it.each(HOSTS)("on %s: the metadata names the grant", async (host) => {
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: { host } })
    expect(res.json().grant_types_supported).toEqual(["authorization_code", JWT_BEARER])
  })
})
