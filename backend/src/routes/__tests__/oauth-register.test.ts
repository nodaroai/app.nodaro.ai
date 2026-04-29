import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { registerOauthRegister } from "../oauth-register.js"

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "00000000-0000-0000-0000-000000000001",
              client_id: "test-client-id",
              created_at: new Date().toISOString(),
            },
            error: null,
          }),
        }),
      }),
    }),
  },
}))

vi.mock("../../lib/config.js", () => ({
  config: {
    MCP_DYNAMIC_REGISTRATION: "allowlist",
    MCP_DCR_ALLOWLIST_PARSED: ["Claude", "Cursor"],
  },
}))

async function makeApp() {
  const app = Fastify()
  await registerOauthRegister(app)
  return app
}

describe("POST /v1/oauth/register (RFC 7591 DCR)", () => {
  it("rejects with 400 when client_name is missing", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/oauth/register", payload: {} })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.code).toBe("validation_error")
  })

  it("rejects with 400 when redirect_uris is empty", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: { client_name: "Claude", redirect_uris: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects unknown client_name with 403 in allowlist mode", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/register",
      payload: { client_name: "EvilApp", redirect_uris: ["https://evil.example/cb"] },
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
