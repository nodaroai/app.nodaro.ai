import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * MCP by path (decided 2026-11-11), booted for real: a deployment that turns
 * `mcp.byPath` on serves the MCP endpoint at `/v1/mcp` on each host it declares
 * as its own, and every address the MCP lane states — the 401 challenge, both
 * metadata documents, the consent redirect, the links the tools hand out —
 * follows the declared host the client connected through. Anything else gets
 * the primary origin. The security cases (forged and malformed hosts, ports,
 * schemes, shared caches, registration and redirect checks) are here too.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "allowlist"
  process.env.MCP_DCR_ALLOWLIST = "Claude,Cursor"
  process.env.PUBLIC_URL = "https://primary.example.com"
  process.env.MCP_PUBLIC_URL = ""
  process.env.CORS_ORIGIN = "https://second.example.com, http://plain.example.org, https://ported.example.net:8443"
  process.env.FLOW_PUBLIC_URL = ""
  process.env.FLOW_UI_ORIGIN = ""
  process.env.LEGACY_UI_HOSTS = ""
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ mcp: { byPath: true } })
})

const TOKEN = "ndr_app_path_mode_test_token"
const USER = "00000000-0000-4000-8000-0000000000aa"
const APP_ID = "00000000-0000-4000-8000-0000000000bb"

vi.mock("../../lib/supabase.js", () => {
  const rowFor = (table: string): unknown => {
    if (table === "developer_app_tokens") {
      return {
        id: "tok-1",
        authorization_id: "auth-1",
        expires_at: null,
        revoked_at: null,
        developer_app_authorizations: {
          id: "auth-1",
          app_id: "00000000-0000-4000-8000-0000000000bb",
          user_id: "00000000-0000-4000-8000-0000000000aa",
          scopes_granted: ["assets:write", "assets:read", "jobs:read"],
          revoked_at: null,
          monthly_spend_cap_credits: null,
          developer_apps: { kind: "dynamic_mcp", owner_user_id: null },
        },
      }
    }
    if (table === "developer_apps") return { name: "Claude" }
    return null
  }
  // A registered client, for the redirect-URI checks (`findAppByClientId` → `.single()`).
  const KNOWN_CLIENT = {
    id: "00000000-0000-4000-8000-0000000000cc",
    owner_user_id: "00000000-0000-4000-8000-0000000000aa",
    client_id: "ndr_dcr_known",
    client_secret_hash: "unused",
    redirect_uris: ["https://client.example/cb"],
    allowed_origins: [],
    scopes_requested: ["jobs:read"],
    status: "active",
    name: "Claude",
    description: null,
    logo_url: null,
    homepage_url: null,
    kind: "dynamic_mcp",
  }
  const chainFor = (table: string) => {
    const eqs: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "is", "gte", "in", "order", "limit", "neq", "update", "overlaps", "upsert"]) {
      chain[m] = vi.fn(() => chain)
    }
    chain.eq = vi.fn((col: string, val: unknown) => {
      eqs[col] = val
      return chain
    })
    chain.single = vi.fn(() =>
      Promise.resolve({ data: table === "developer_apps" && eqs.client_id === "ndr_dcr_known" ? KNOWN_CLIENT : null, error: null }),
    )
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: rowFor(table), error: null }))
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null, count: 0 })
    chain.insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() =>
          Promise.resolve({
            data: { id: "00000000-0000-0000-0000-000000000001", client_id: "ndr_dcr_path_client", created_at: "2026-11-11T00:00:00.000Z" },
            error: null,
          }),
        ),
      })),
    }))
    return chain
  }
  return {
    supabase: {
      from: vi.fn((table: string) => chainFor(table)),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    },
  }
})

import { buildApp } from "../../app.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { issueCode } from "../../lib/oauth-codes.js"

const PRIMARY = "https://primary.example.com"
const SECOND = "https://second.example.com"

const INIT = { jsonrpc: "2.0", method: "initialize", id: 1 }

function challenge(base: string, realm = base.replace(/^https?:\/\//, "")): string {
  return `Bearer realm="${realm}", resource="${base}/v1/mcp", resource_metadata="${base}/.well-known/oauth-protected-resource/v1/mcp"`
}

describe("MCP by path — booted with mcp.byPath on", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    __resetSurfaceProfileCacheForTests()
    app = await buildApp()
    // The MCP transport's node adapter drains a request body it did not read
    // and, 500 ms later, calls `destroySoon()` on the request's socket. A real
    // socket has it; the injected request's stand-in socket does not, which
    // throws on a timer after the test that made the call. Give the stand-in
    // the no-op a closed injected request needs.
    const probe = await app.inject({ method: "GET", url: "/health" })
    const socketProto = Object.getPrototypeOf((probe.raw.req as unknown as { socket: object }).socket) as { destroySoon?: () => void }
    if (typeof socketProto.destroySoon !== "function") socketProto.destroySoon = () => {}
  })

  afterAll(async () => {
    await app.close()
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  async function ask(host: string, method: "GET" | "POST", url: string, extra: Record<string, string> = {}, payload?: unknown) {
    return app.inject({ method, url, headers: { host, ...extra }, ...(payload === undefined ? {} : { payload: payload as string }) })
  }

  describe("each declared host answers with its own addresses", () => {
    it.each([
      ["second.example.com", SECOND],
      ["primary.example.com", PRIMARY],
    ])("on %s: the endpoint's 401 challenge names that host and its metadata document", async (host, base) => {
      for (const method of ["POST", "GET"] as const) {
        const res = await ask(host, method, "/v1/mcp", {}, method === "POST" ? INIT : undefined)
        expect(res.statusCode).toBe(401)
        expect(res.headers["www-authenticate"]).toBe(challenge(base))
      }
    })

    it.each([
      ["second.example.com", SECOND],
      ["primary.example.com", PRIMARY],
    ])("on %s: both metadata documents, root and path-suffixed, name only that host", async (host, base) => {
      for (const url of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/v1/mcp"]) {
        const res = await ask(host, "GET", url)
        expect(res.statusCode, url).toBe(200)
        expect(res.json(), url).toMatchObject({ resource: `${base}/v1/mcp`, authorization_servers: [base], bearer_methods_supported: ["header"] })
      }
      for (const url of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/v1/mcp"]) {
        const res = await ask(host, "GET", url)
        expect(res.statusCode, url).toBe(200)
        expect(res.json(), url).toMatchObject({
          issuer: base,
          authorization_endpoint: `${base}/v1/oauth/authorize`,
          token_endpoint: `${base}/v1/oauth/token`,
          registration_endpoint: `${base}/v1/oauth/register`,
          revocation_endpoint: `${base}/v1/oauth/revoke`,
          service_documentation: `${base}/docs/oauth`,
        })
      }
    })

    it("the consent redirect stays on the host the client came through, query string verbatim", async () => {
      const qs = "?response_type=code&client_id=ndr_dcr_x&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&state=s&resource=https%3A%2F%2Fsecond.example.com%2Fv1%2Fmcp"
      const res = await ask("second.example.com", "GET", `/v1/oauth/authorize${qs}`)
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe(`${SECOND}/oauth/authorize${qs}`)
    })

    it("a declared host on its own port keeps the port; the scheme always comes from the declaration", async () => {
      const ported = await ask("ported.example.net:8443", "GET", "/.well-known/oauth-protected-resource")
      expect(ported.json().resource).toBe("https://ported.example.net:8443/v1/mcp")
      // Declared as http: stated as http, whatever the forwarded scheme says.
      const plain = await ask("plain.example.org", "GET", "/.well-known/oauth-protected-resource", { "x-forwarded-proto": "https" })
      expect(plain.json().resource).toBe("http://plain.example.org/v1/mcp")
      // Declared as https: never downgraded by a forwarded scheme.
      const secure = await ask("second.example.com", "GET", "/.well-known/oauth-protected-resource", { "x-forwarded-proto": "http" })
      expect(secure.json().resource).toBe(`${SECOND}/v1/mcp`)
    })
  })

  describe("a host the deployment did not declare gets the primary address", () => {
    const undeclared: Array<[string, Record<string, string>]> = [
      ["an unknown host", { host: "evil.example.com" }],
      ["a declared host on another port", { host: "second.example.com:8443" }],
      ["a declared ported host without its port", { host: "ported.example.net" }],
      ["a host carrying a path", { host: "second.example.com/x" }],
      ["a host carrying credentials", { host: "second.example.com@evil.example.com" }],
      ["a lookalike suffix", { host: "second.example.com.evil.example.com" }],
      ["a forwarded unknown host", { host: "second.example.com", "x-forwarded-host": "evil.example.com" }],
      ["a forwarded host list led by an unknown host", { host: "second.example.com", "x-forwarded-host": "evil.example.com, second.example.com" }],
    ]

    it.each(undeclared)("%s", async (_label, headers) => {
      const { host, ...extra } = headers
      const prm = await ask(host!, "GET", "/.well-known/oauth-protected-resource", extra)
      expect(prm.json()).toMatchObject({ resource: `${PRIMARY}/v1/mcp`, authorization_servers: [PRIMARY] })
      const as = await ask(host!, "GET", "/.well-known/oauth-authorization-server", extra)
      expect(as.json().issuer).toBe(PRIMARY)
      const challengeRes = await ask(host!, "POST", "/v1/mcp", extra, INIT)
      expect(challengeRes.headers["www-authenticate"]).toBe(challenge(PRIMARY))
      const redirect = await ask(host!, "GET", "/v1/oauth/authorize?client_id=x", extra)
      expect(redirect.headers.location).toBe(`${PRIMARY}/oauth/authorize?client_id=x`)
      for (const res of [prm, as, challengeRes, redirect]) {
        expect(JSON.stringify(res.headers)).not.toContain("evil.example.com")
        expect(res.body).not.toContain("evil.example.com")
      }
    })
  })

  describe("no shared cache can carry one host's metadata to another", () => {
    it("the per-host documents are private and say what they vary on", async () => {
      for (const url of [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource/v1/mcp",
        "/.well-known/oauth-authorization-server/v1/mcp",
      ]) {
        const res = await ask("second.example.com", "GET", url)
        expect(res.headers["cache-control"], url).toBe("private, max-age=3600")
        expect(String(res.headers.vary), url).toContain("Host")
        expect(String(res.headers.vary), url).toContain("X-Forwarded-Host")
      }
    })

    it("a forwarded host naming ANOTHER declared host answers for that host, privately (never stored for the Host asked)", async () => {
      const res = await ask("primary.example.com", "GET", "/.well-known/oauth-protected-resource", { "x-forwarded-host": "second.example.com" })
      expect(res.json().resource).toBe(`${SECOND}/v1/mcp`)
      expect(res.headers["cache-control"]).toBe("private, max-age=3600")
    })
  })

  describe("only the exact path is public — never a prefix", () => {
    it("routes that merely start with the path still need a credential", async () => {
      for (const url of ["/v1/mcp-conversations", "/v1/mcp/", "/v1/mcp/x", "/v1/mcpx"]) {
        const res = await ask("second.example.com", "GET", url)
        expect(res.statusCode, url).toBe(401)
        expect(res.headers["www-authenticate"], url).toBeUndefined()
        expect(res.json(), url).toEqual({ error: { code: "unauthorized", message: "Authentication required" } })
      }
    })

    it("the endpoint's other methods are not public either (as at /mcp)", async () => {
      const res = await app.inject({ method: "DELETE", url: "/v1/mcp", headers: { host: "second.example.com" } })
      expect(res.statusCode).toBe(401)
      expect(res.headers["www-authenticate"]).toBeUndefined()
    })
  })

  describe("the dedicated /mcp endpoint is not served by path: its address is not the deployment's", () => {
    it("neither /mcp nor its /.well-known/…/mcp documents answer, so nothing states the dedicated MCP host", async () => {
      for (const [method, url] of [["POST", "/mcp"], ["GET", "/mcp"], ["GET", "/.well-known/oauth-protected-resource/mcp"], ["GET", "/.well-known/oauth-authorization-server/mcp"]] as const) {
        const res = await ask("second.example.com", method, url, {}, method === "POST" ? INIT : undefined)
        expect(res.statusCode, url).toBe(404)
        expect(res.body, url).not.toContain("mcp.nodaro.ai")
        expect(res.headers["www-authenticate"], url).toBeUndefined()
      }
    })
  })

  describe("registration and the redirect-URI checks are the same on every host", () => {
    it("dynamic registration answers identically on every declared host and states no host of its own", async () => {
      const body = { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }
      const a = await ask("second.example.com", "POST", "/v1/oauth/register", {}, body)
      const b = await ask("primary.example.com", "POST", "/v1/oauth/register", {}, body)
      expect(a.statusCode).toBe(201)
      const strip = (r: typeof a) => ({ ...r.json(), client_secret: "<random>" })
      expect(strip(a)).toEqual(strip(b))
      expect(a.body).not.toContain("example.com")
      // The allowlist still applies on the path lane's hosts.
      const refused = await ask("second.example.com", "POST", "/v1/oauth/register", {}, { client_name: "Someone", redirect_uris: ["https://x.example/cb"] })
      expect(refused.statusCode).toBe(403)
    })

    it("a redirect_uri is registered or not the same way on every host", async () => {
      for (const host of ["second.example.com", "primary.example.com", "evil.example.com"]) {
        const ok = await ask(host, "GET", "/v1/oauth/app-info?client_id=ndr_dcr_known&redirect_uri=https%3A%2F%2Fclient.example%2Fcb")
        expect(ok.statusCode, host).toBe(200)
        expect(ok.json().redirectUriRegistered, host).toBe(true)
        // Another host's address is no more registered for being one of the deployment's own.
        for (const other of ["https://second.example.com/cb", "https://evil.example.com/cb"]) {
          const no = await ask(host, "GET", `/v1/oauth/app-info?client_id=ndr_dcr_known&redirect_uri=${encodeURIComponent(other)}`)
          expect(no.json().redirectUriRegistered, `${host} ${other}`).toBe(false)
        }
      }
    })

    it("a code is redeemed only with the redirect_uri it was issued for, on every host", async () => {
      for (const host of ["second.example.com", "primary.example.com"]) {
        const code = issueCode({ appId: "00000000-0000-4000-8000-0000000000cc", userId: USER, scopes: ["jobs:read"], redirectUri: "https://client.example/cb", codeChallenge: "c".repeat(43), codeChallengeMethod: "S256" })
        const res = await app.inject({
          method: "POST",
          url: "/v1/oauth/token",
          headers: { host, "content-type": "application/x-www-form-urlencoded" },
          payload: `grant_type=authorization_code&client_id=ndr_dcr_known&code=${code}&redirect_uri=${encodeURIComponent(`https://${host}/cb`)}&code_verifier=${"v".repeat(43)}`,
        })
        expect(res.statusCode, host).toBe(400)
        expect(res.json(), host).toMatchObject({ error: "invalid_grant" })
      }
    })

    it("the consent redirect never goes to the client's redirect_uri or any other host, whatever the query says", async () => {
      const qs = "?redirect_uri=https%3A%2F%2Fevil.example.com%2Fcb&next=%2F%2Fevil.example.com"
      for (const host of ["second.example.com", "evil.example.com"]) {
        const res = await ask(host, "GET", `/v1/oauth/authorize${qs}`)
        expect(new URL(String(res.headers.location)).host).toBe(host === "evil.example.com" ? "primary.example.com" : host)
      }
    })
  })

  describe("the tools hand out links on the host the client connected through", () => {
    async function call(host: string, name: string, args: Record<string, unknown> = {}) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/mcp",
        headers: {
          host,
          authorization: `Bearer ${TOKEN}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        payload: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } },
      })
      expect(res.statusCode, res.body).toBe(200)
      return res.json() as { result: { structuredContent?: Record<string, unknown>; content: Array<{ text: string }> } }
    }

    it.each([
      ["second.example.com", SECOND],
      ["primary.example.com", PRIMARY],
      ["evil.example.com", PRIMARY],
    ])("on %s: upload proxy, upload page and hand-off links", async (host, base) => {
      const presigned = await call(host, "prepare_image_upload", { mime_type: "image/png" })
      expect(String(presigned.result.structuredContent?.upload_url)).toMatch(new RegExp(`^${base.replace(/\./g, "\\.")}/v1/upload-proxy/`))
      const widget = await call(host, "upload_image_widget", {})
      expect(String(widget.result.structuredContent?.upload_url)).toMatch(new RegExp(`^${base.replace(/\./g, "\\.")}/v1/upload-page/`))
      const handoff = await call(host, "request_image_upload", {})
      expect(String(handoff.result.structuredContent?.upload_page_url)).toMatch(new RegExp(`^${base.replace(/\./g, "\\.")}/v1/upload-page/`))
    })

    it("the upload widget's iframe may connect to exactly the host its upload links name", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/mcp",
        headers: { host: "second.example.com", authorization: `Bearer ${TOKEN}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
        payload: { jsonrpc: "2.0", id: 8, method: "resources/read", params: { uri: "ui://nodaro/widget/v4/upload-image" } },
      })
      expect(res.statusCode, res.body).toBe(200)
      const content = (res.json() as { result: { contents: Array<{ _meta: { ui: { csp: { connectDomains: string[] } } } }> } }).result.contents[0]!
      expect(content._meta.ui.csp.connectDomains).toEqual([SECOND])
    })

    it("a token issued through one host is accepted on another: the install is one audience, as before", async () => {
      // Tokens carry no resource binding (no audience column, the `resource`
      // parameter is not stored), so the same bearer works on every host —
      // unchanged by path mode.
      for (const host of ["second.example.com", "primary.example.com"]) {
        const ok = await call(host, "prepare_image_upload", { mime_type: "image/png" })
        expect(ok.result.structuredContent?.upload_url).toBeTruthy()
      }
    })
  })
})
