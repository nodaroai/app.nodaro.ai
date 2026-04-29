import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import rateLimit from "@fastify/rate-limit"
import { registerOauthRegister } from "../oauth-register.js"

const mockState = vi.hoisted(() => ({ openCount: 0 }))

vi.mock("../../lib/supabase.js", () => {
  const countChain: Record<string, unknown> = {}
  countChain.eq = vi.fn(() => countChain)
  countChain.is = vi.fn(() => countChain)
  countChain.gte = vi.fn(() => countChain)
  countChain.overlaps = vi.fn(() => Promise.resolve({ count: mockState.openCount, error: null }))

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
        insert: vi.fn(() => insertChain),
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
