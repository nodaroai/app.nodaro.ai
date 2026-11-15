import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * Only listed clients (decided 2026-11-11) on a deployment that serves MCP by
 * path on two declared hosts: the rule is the same on every host — the listed
 * client works through each, every other client and credential is refused
 * through each, and the sign-in refuses an unlisted client naming either
 * host's MCP endpoint.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "allowlist"
  process.env.MCP_DCR_ALLOWLIST = "Claude"
  process.env.PUBLIC_URL = "https://primary.example.com"
  process.env.MCP_PUBLIC_URL = ""
  process.env.CORS_ORIGIN = "https://second.example.com"
  process.env.FLOW_PUBLIC_URL = ""
  process.env.FLOW_UI_ORIGIN = ""
  process.env.LEGACY_UI_HOSTS = ""
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ mcp: { byPath: true } })
  process.env.MCP_ALLOWED_CLIENT_IDS = `app_${"1".repeat(32)}`
})

const fake = vi.hoisted(() => ({ db: null as unknown }))

vi.mock("../../lib/supabase.js", async () => {
  const { newOAuthMemoryDb, oauthMemorySupabase } = await import("./helpers/oauth-memory-db.js")
  const db = newOAuthMemoryDb()
  fake.db = db
  return { supabase: oauthMemorySupabase(db) }
})

import { buildApp } from "../../app.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import type { OAuthMemoryDb } from "./helpers/oauth-memory-db.js"
import { CHALLENGE, DCR_CLIENT_ID, INIT, MCP_HEADERS, OWN_CLIENT_ID, REDIRECT, USER_JWT, seedLane, type Seeded } from "./helpers/mcp-lane-transcript.js"

const HOSTS = [
  ["primary.example.com", "https://primary.example.com"],
  ["second.example.com", "https://second.example.com"],
] as const

describe("listed clients with MCP served by path on two declared hosts", () => {
  let app: FastifyInstance
  let seeded: Seeded

  beforeAll(async () => {
    __resetSurfaceProfileCacheForTests()
    seeded = seedLane(fake.db as OAuthMemoryDb)
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

  const mcp = (host: string, authorization?: string) =>
    app.inject({ method: "POST", url: "/v1/mcp", headers: { host, ...MCP_HEADERS, ...(authorization ? { authorization } : {}) }, payload: INIT })

  it.each(HOSTS)("on %s: the listed client's token is served; every other credential is refused; no credential gets this host's challenge", async (host, base) => {
    expect((await mcp(host, `Bearer ${seeded.ownToken}`)).statusCode).toBe(200)
    for (const bearer of [seeded.dcrToken, USER_JWT, seeded.apiToken]) {
      const res = await mcp(host, `Bearer ${bearer}`)
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("mcp_client_not_allowed")
    }
    const anonymous = await mcp(host)
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.headers["www-authenticate"]).toBe(
      `Bearer realm="${host}", resource="${base}/v1/mcp", resource_metadata="${base}/.well-known/oauth-protected-resource/v1/mcp"`,
    )
  })

  it.each(HOSTS)("on %s: an unlisted client naming this host's MCP endpoint goes back to the client; the listed one goes on to this host's consent page", async (host, base) => {
    const query = (clientId: string) =>
      `?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=jobs%3Aread&state=s&code_challenge=${CHALLENGE}&code_challenge_method=S256&resource=${encodeURIComponent(`${base}/v1/mcp`)}`
    const refused = await app.inject({ method: "GET", url: `/v1/oauth/authorize${query(DCR_CLIENT_ID)}`, headers: { host } })
    const url = new URL(String(refused.headers.location))
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT)
    expect(url.searchParams.get("error")).toBe("unauthorized_client")
    expect(url.searchParams.get("state")).toBe("s")
    const listed = await app.inject({ method: "GET", url: `/v1/oauth/authorize${query(OWN_CLIENT_ID)}`, headers: { host } })
    expect(listed.headers.location).toBe(`${base}/oauth/authorize${query(OWN_CLIENT_ID)}`)
  })
})
