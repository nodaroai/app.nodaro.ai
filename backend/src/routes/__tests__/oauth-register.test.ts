import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import rateLimit from "@fastify/rate-limit"
import { registerOauthRegister } from "../oauth-register.js"

const mockState = vi.hoisted(() => ({ openCount: 0, lastInsert: null as Record<string, unknown> | null }))

vi.mock("../../lib/supabase.js", () => {
  const countChain: Record<string, unknown> = {}
  countChain.eq = vi.fn(() => countChain)
  countChain.is = vi.fn(() => countChain)
  countChain.gte = vi.fn(() => countChain)
  countChain.overlaps = vi.fn(() => Promise.resolve({ count: mockState.openCount, error: null }))
  // The community-instance cap query ends at .gte() (no redirect-uri overlap):
  // awaiting the chain must resolve like the overlaps() branch does.
  countChain.then = (resolve: (v: unknown) => unknown) => resolve({ count: mockState.openCount, error: null })

  const insertChain = {
    select: vi.fn(() => ({
      single: vi.fn(() =>
        Promise.resolve({
          data: {
            id: "00000000-0000-0000-0000-000000000001",
            client_id: "test-client-id",
            created_at: new Date().toISOString(),
          },
          error: null,
        }),
      ),
    })),
  }

  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(() => countChain),
        insert: vi.fn((row: Record<string, unknown>) => {
          mockState.lastInsert = row
          return insertChain
        }),
      })),
    },
  }
})

vi.mock("../../lib/config.js", () => ({
  config: {
    MCP_DYNAMIC_REGISTRATION: "allowlist",
    MCP_DCR_ALLOWLIST_PARSED: ["Claude", "Cursor"],
  },
}))

async function makeApp() {
  const app = Fastify()
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => {
      const xff = req.headers["x-forwarded-for"]
      if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim()
      return req.ip || "unknown"
    },
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: {
        code: "rate_limit_exceeded",
        message: `Too many requests. Retry in ${Math.ceil(context.ttl / 1000)}s.`,
      },
    }),
  })
  await registerOauthRegister(app)
  return app
}

beforeEach(() => {
  mockState.openCount = 0
})

describe("POST /v1/oauth/register (RFC 7591 DCR)", () => {
  it("rejects with 400 when client_name is missing", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: {},
      headers: { "x-forwarded-for": "10.0.0.1" },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.code).toBe("validation_error")
  })

  it("rejects with 400 when redirect_uris is empty", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: { client_name: "Claude", redirect_uris: [] },
      headers: { "x-forwarded-for": "10.0.0.2" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects unknown client_name with 403 in allowlist mode", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: { client_name: "EvilApp", redirect_uris: ["https://evil.example/cb"] },
      headers: { "x-forwarded-for": "10.0.0.3" },
    })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error.code).toBe("client_not_allowed")
  })

  it("registers a Claude client and returns client_id + client_secret", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] },
      headers: { "x-forwarded-for": "10.0.0.4" },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.client_id).toBeTruthy()
    expect(body.client_secret).toBeTruthy()
    expect(body.client_secret.length).toBeGreaterThanOrEqual(32)
    expect(body.client_id_issued_at).toBeGreaterThan(0)
    expect(body.client_secret_expires_at).toBeGreaterThan(body.client_id_issued_at)
    expect(body.token_endpoint_auth_method).toBe("client_secret_post")
    expect(body.grant_types).toEqual(["authorization_code"])
    expect(body.response_types).toEqual(["code"])
  })

  // Regression: RFC 7591 §2 says the server MUST ignore unrecognized client
  // metadata. Real MCP clients (Claude.ai, Cursor, …) send extra fields like
  // `application_type` / `software_id` / `software_version`. A `.strict()`
  // schema 400s the whole request → "Couldn't register with Nodaro's sign-in
  // service" for every such client. The extras must be ignored, not rejected.
  it("ignores unknown RFC 7591 metadata fields instead of 400ing", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: {
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
        // Fields outside our whitelist that real clients send:
        application_type: "web",
        software_id: "claude-ai",
        software_version: "1.0.0",
        jwks: { keys: [] },
      },
      headers: { "x-forwarded-for": "10.0.0.5" },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.client_id).toBeTruthy()
    expect(body.client_secret).toBeTruthy()
  })
})

describe("DCR abuse mitigations", () => {
  it("returns 429 after 10 requests/min from the same IP (@fastify/rate-limit)", async () => {
    const app = await makeApp()
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/oauth/register",
        payload: { client_name: "Claude", redirect_uris: [`https://claude.ai/cb-${i}`] },
        headers: { "x-forwarded-for": "20.0.0.1" },
      })
      expect(res.statusCode).toBe(201)
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: { client_name: "Claude", redirect_uris: ["https://claude.ai/cb-11"] },
      headers: { "x-forwarded-for": "20.0.0.1" },
    })
    expect(blocked.statusCode).toBe(429)
    expect(JSON.parse(blocked.body).error.code).toBe("rate_limit_exceeded")
  })

  it("rate limit is per-IP (different IPs don't share buckets)", async () => {
    const app = await makeApp()
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/oauth/register",
        payload: { client_name: "Claude", redirect_uris: [`https://claude.ai/cb-${i}`] },
        headers: { "x-forwarded-for": "20.0.0.2" },
      })
    }
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: { client_name: "Claude", redirect_uris: ["https://claude.ai/cb-other"] },
      headers: { "x-forwarded-for": "20.0.0.99" },
    })
    expect(res.statusCode).toBe(201)
  })

  it("returns 429 'too_many_open_registrations' when (client_name + redirect_uris) cap is hit", async () => {
    mockState.openCount = 5
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: { client_name: "Claude", redirect_uris: ["https://claude.ai/cb"] },
      headers: { "x-forwarded-for": "20.0.0.3" },
    })
    expect(res.statusCode).toBe(429)
    expect(JSON.parse(res.body).error.code).toBe("too_many_open_registrations")
  })

  it("allows registration when openCount < cap", async () => {
    mockState.openCount = 4
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: { client_name: "Claude", redirect_uris: ["https://claude.ai/cb"] },
      headers: { "x-forwarded-for": "20.0.0.4" },
    })
    expect(res.statusCode).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// Phase 4a: community-instance registrations (software_id = nodaro-community)
// ---------------------------------------------------------------------------

const { config: communityConfig } = await import("../../lib/config.js")

describe("community cloud-connect DCR branch", () => {
  const config = communityConfig
  const communityPayload = {
    client_name: "Asaf's Studio Server",
    redirect_uris: ["https://nodaro.my-studio.example/oauth/callback"],
    client_uri: "https://nodaro.my-studio.example",
    software_id: "nodaro-community",
    scope: "assets:write workflows:execute jobs:read credits:read",
  }

  beforeEach(() => {
    ;(config as Record<string, unknown>).COMMUNITY_CONNECT_ENABLED = false
    mockState.lastInsert = null
  })

  it("403s when COMMUNITY_CONNECT_ENABLED is off", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: communityPayload,
      headers: { "x-forwarded-for": "10.0.1.1" },
    })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error.code).toBe("community_connect_disabled")
  })

  it("registers with kind=community_instance, bypassing the MCP allowlist", async () => {
    ;(config as Record<string, unknown>).COMMUNITY_CONNECT_ENABLED = true
    const app = await makeApp()
    // client_name is NOT on the MCP allowlist — must not matter for instances.
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: communityPayload,
      headers: { "x-forwarded-for": "10.0.1.2" },
    })
    expect(res.statusCode).toBe(201)
    expect(mockState.lastInsert?.kind).toBe("community_instance")
    expect(mockState.lastInsert?.allowed_origins).toEqual(["https://nodaro.my-studio.example"])
    expect(mockState.lastInsert?.scopes_requested).toEqual([
      "assets:write",
      "workflows:execute",
      "jobs:read",
      "credits:read",
    ])
  })

  it("counts open registrations per CALLER (hashed address), not per name — every default install shares the same name (#708)", async () => {
    ;(config as Record<string, unknown>).COMMUNITY_CONNECT_ENABLED = true
    const app = await makeApp()
    mockState.openCount = 0
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: {
        client_name: "Nodaro instance (localhost:3000)",
        redirect_uris: ["http://localhost:3000/v1/nodaro-connect/callback"],
        client_uri: "http://localhost:3000",
        software_id: "nodaro-community",
        scope: "assets:write workflows:execute jobs:read credits:read",
      },
      headers: { "x-forwarded-for": "10.0.1.7" },
    })
    expect(res.statusCode).toBe(201)
    // The row remembers who registered (hashed), and the cap query keyed on it.
    const { createHash } = await import("node:crypto")
    const expectedHash = createHash("sha256").update("10.0.1.7").digest("hex")
    expect(mockState.lastInsert?.registered_ip_hash).toBe(expectedHash)
    // The cap query keyed on the caller hash — never on the (shared) name.
    // The chain mock is shared across the file, so look at the calls this
    // registration made: the last "kind" call and everything after it.
    const { supabase } = await import("../../lib/supabase.js")
    const chain = (supabase.from as unknown as { mock: { results: Array<{ value: { select: () => Record<string, unknown> } }> } }).mock.results.at(-1)!.value.select() as Record<string, unknown>
    const eqCalls = (chain.eq as ReturnType<typeof vi.fn>).mock.calls as unknown[][]
    const start = eqCalls.map((c) => c[0]).lastIndexOf("kind")
    const mine = eqCalls.slice(start)
    expect(mine).toEqual([["kind", "community_instance"], ["registered_ip_hash", expectedHash]])
  })

  it("429s a caller with 10 unfinished registrations in the window, with a sentence the user can act on", async () => {
    ;(config as Record<string, unknown>).COMMUNITY_CONNECT_ENABLED = true
    const app = await makeApp()
    mockState.openCount = 10
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: communityPayload,
      headers: { "x-forwarded-for": "10.0.1.8" },
    })
    mockState.openCount = 0
    expect(res.statusCode).toBe(429)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe("too_many_open_registrations")
    expect(body.error.message).toMatch(/from this address in the last 24 hours/)
  })

  it("plain MCP registrations still get kind=dynamic_mcp", async () => {
    ;(config as Record<string, unknown>).COMMUNITY_CONNECT_ENABLED = true
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] },
      headers: { "x-forwarded-for": "10.0.1.3" },
    })
    expect(res.statusCode).toBe(201)
    expect(mockState.lastInsert?.kind).toBe("dynamic_mcp")
  })
})
