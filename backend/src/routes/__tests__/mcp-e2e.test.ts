import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import type { FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Env setup — MUST run before config.ts evaluates its Zod schema.
// vi.hoisted() runs before any import (incl. transitive imports of `app.ts`).
// ---------------------------------------------------------------------------
vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "allowlist"
  process.env.MCP_DCR_ALLOWLIST = "Claude,Cursor"
})

// ---------------------------------------------------------------------------
// Supabase mock — DCR test inserts into `developer_apps`. Mock the chain so
// the insert returns a fake row without hitting a real DB.
// All other endpoints in this test (well-known, /mcp 401) don't touch supabase.
// ---------------------------------------------------------------------------
vi.mock("../../lib/supabase.js", () => {
  // DCR's countOpenRegistrations() chain: from().select(...).eq().eq().is().gte().overlaps()
  const countChain: Record<string, unknown> = {}
  countChain.eq = vi.fn(() => countChain)
  countChain.is = vi.fn(() => countChain)
  countChain.gte = vi.fn(() => countChain)
  countChain.overlaps = vi.fn(() => Promise.resolve({ count: 0, error: null }))

  // Insert chain: from().insert().select().single()
  const insertChain = {
    select: vi.fn(() => ({
      single: vi.fn(() =>
        Promise.resolve({
          data: {
            id: "00000000-0000-0000-0000-000000000001",
            client_id: "ndr_dcr_e2e_test_client",
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
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  }
})

import { buildApp } from "../../app.js"

describe("MCP end-to-end auth flow", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it("rejects /mcp with 401 + WWW-Authenticate when no token is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", method: "initialize", id: 1 },
    })
    expect(res.statusCode).toBe(401)
    // RFC 9728: MCP clients use this header to discover the protected-resource metadata.
    const wwwAuth = res.headers["www-authenticate"]
    expect(wwwAuth).toBeTruthy()
    expect(String(wwwAuth)).toContain("Bearer")
    expect(String(wwwAuth)).toContain('resource="https://mcp.nodaro.ai/mcp"')
  })

  it("DCR registers Claude and returns valid OAuth client metadata", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: {
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.client_id.startsWith("ndr_dcr_")).toBe(true)
  })

  it(".well-known/oauth-authorization-server points at /v1/oauth/register for DCR", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server",
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.registration_endpoint).toMatch(/\/v1\/oauth\/register$/)
  })

  it(".well-known/oauth-protected-resource points at the auth server", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource",
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.resource).toMatch(/mcp\.nodaro\.ai\/mcp$/)
    expect(body.authorization_servers).toHaveLength(1)
  })

  it.skip("tools/list with a valid ndr_app_ token returns the ping placeholder", async () => {
    // Requires seeded developer_app_tokens + developer_app_authorizations rows
    // in the test DB. Defer to manual smoke (Task 12).
  })
})
