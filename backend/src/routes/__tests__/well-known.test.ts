import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { registerWellKnown } from "../well-known.js"

vi.mock("../../lib/config.js", () => ({
  config: { PUBLIC_URL: "https://app.nodaro.ai" },
}))

async function makeApp() {
  const app = Fastify()
  await registerWellKnown(app)
  return app
}

describe("GET /.well-known/oauth-authorization-server (RFC 8414)", () => {
  it("returns issuer + authorization/token/registration/revocation endpoints", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.issuer).toBe("https://app.nodaro.ai")
    expect(body.authorization_endpoint).toBe("https://app.nodaro.ai/v1/oauth/authorize")
    expect(body.token_endpoint).toBe("https://app.nodaro.ai/v1/oauth/token")
    expect(body.registration_endpoint).toBe("https://app.nodaro.ai/v1/oauth/register")
    expect(body.revocation_endpoint).toBe("https://app.nodaro.ai/v1/oauth/revoke")
  })

  it("advertises PKCE S256 support and the supported scopes", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" })
    const body = JSON.parse(res.body)
    expect(body.code_challenge_methods_supported).toContain("S256")
    expect(body.response_types_supported).toContain("code")
    expect(body.grant_types_supported).toContain("authorization_code")
    expect(body.token_endpoint_auth_methods_supported).toContain("client_secret_post")
    expect(Array.isArray(body.scopes_supported)).toBe(true)
    expect(body.scopes_supported.length).toBeGreaterThanOrEqual(8)
  })
})

describe("GET /.well-known/oauth-protected-resource (RFC 9728)", () => {
  it("points at the authorization server", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.resource).toBe("https://mcp.nodaro.ai/mcp")
    expect(body.authorization_servers).toEqual(["https://app.nodaro.ai"])
  })
})
