import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import { registerMcpHostFilter } from "../mcp-host-filter.js"

async function makeApp() {
  const app = Fastify()
  registerMcpHostFilter(app)
  app.all("/mcp", async (_req, reply) => reply.send({ ok: "mcp" }))
  app.get("/.well-known/oauth-protected-resource", async (_req, reply) => reply.send({ ok: "oauth-pr" }))
  app.get("/.well-known/oauth-protected-resource/mcp", async (_req, reply) => reply.send({ ok: "oauth-pr-mcp" }))
  app.get("/.well-known/oauth-authorization-server", async (_req, reply) => reply.send({ ok: "oauth-as" }))
  app.get("/.well-known/oauth-authorization-server/mcp", async (_req, reply) => reply.send({ ok: "oauth-as-mcp" }))
  app.get("/v1/credits/balance", async (_req, reply) => reply.send({ ok: "credits" }))
  app.put("/v1/upload-proxy/:token", async (_req, reply) => reply.send({ ok: "upload-proxy" }))
  app.get("/v1/upload-page/:token", async (_req, reply) => reply.send({ ok: "upload-page-get" }))
  app.post("/v1/upload-page/:token", async (_req, reply) => reply.send({ ok: "upload-page-post" }))
  app.get("/v1/admin/access/whoami", async (_req, reply) => reply.send({ ok: "whoami" }))
  app.get("/v1/admin/access/blocks", async (_req, reply) => reply.send({ ok: "blocks" }))
  app.get("/", async (_req, reply) => reply.send({ ok: "root" }))
  return app
}

describe("mcp host filter — the address self-check", () => {
  it("allows exactly /v1/admin/access/whoami on mcp.nodaro.ai (the no-Caddy path must be checkable)", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/v1/admin/access/whoami", headers: { host: "mcp.nodaro.ai" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: "whoami" })
  })

  it("still 404s every other admin path on mcp.nodaro.ai", async () => {
    const app = await makeApp()
    for (const url of ["/v1/admin/access/blocks", "/v1/admin/access/whoami/x"]) {
      const res = await app.inject({ method: "GET", url, headers: { host: "mcp.nodaro.ai" } })
      expect(res.statusCode, url).toBe(404)
    }
  })
})

describe("mcp host filter", () => {
  it("allows POST /mcp on mcp.nodaro.ai", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/mcp", headers: { host: "mcp.nodaro.ai" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: "mcp" })
  })

  it("allows GET /mcp on mcp.nodaro.ai (SSE upgrade)", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/mcp", headers: { host: "mcp.nodaro.ai" } })
    expect(res.statusCode).toBe(200)
  })

  it("allows /.well-known/oauth-protected-resource on mcp.nodaro.ai", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource", headers: { host: "mcp.nodaro.ai" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: "oauth-pr" })
  })

  it("allows /v1/upload-proxy/<token> on mcp.nodaro.ai (prepare_*_upload curl path)", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "PUT", url: "/v1/upload-proxy/abc", headers: { host: "mcp.nodaro.ai" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: "upload-proxy" })
  })

  it("allows GET /v1/upload-page/<token> on mcp.nodaro.ai (request_*_upload page render)", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/v1/upload-page/abc", headers: { host: "mcp.nodaro.ai" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: "upload-page-get" })
  })

  it("allows POST /v1/upload-page/<token> on mcp.nodaro.ai (multipart receive)", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/upload-page/abc", headers: { host: "mcp.nodaro.ai" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: "upload-page-post" })
  })

  it("404s arbitrary /v1/* paths on mcp.nodaro.ai", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/v1/credits/balance", headers: { host: "mcp.nodaro.ai" } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(res.json().error.message).toMatch(/mcp\.nodaro\.ai/)
  })

  it("404s root path on mcp.nodaro.ai (only /mcp and protected-resource discovery resolve)", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/", headers: { host: "mcp.nodaro.ai" } })
    expect(res.statusCode).toBe(404)
  })

  it("serves /.well-known/oauth-authorization-server on mcp.nodaro.ai (RFC 8414 mirror — some MCP clients probe the resource host)", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: { host: "mcp.nodaro.ai" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: "oauth-as" })
  })

  it("serves the /mcp-suffixed discovery variants on mcp.nodaro.ai (RFC 9728 §3.1 path-suffixed probes)", async () => {
    const app = await makeApp()
    const pr = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource/mcp", headers: { host: "mcp.nodaro.ai" } })
    expect(pr.statusCode).toBe(200)
    expect(pr.json()).toEqual({ ok: "oauth-pr-mcp" })
    const as = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server/mcp", headers: { host: "mcp.nodaro.ai" } })
    expect(as.statusCode).toBe(200)
    expect(as.json()).toEqual({ ok: "oauth-as-mcp" })
  })

  it("also filters mcp.next.nodaro.ai (staging)", async () => {
    const app = await makeApp()
    const allowed = await app.inject({ method: "POST", url: "/mcp", headers: { host: "mcp.next.nodaro.ai" } })
    expect(allowed.statusCode).toBe(200)
    const blocked = await app.inject({ method: "GET", url: "/v1/credits/balance", headers: { host: "mcp.next.nodaro.ai" } })
    expect(blocked.statusCode).toBe(404)
  })

  it("ignores port suffix on Host header", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/mcp", headers: { host: "mcp.nodaro.ai:8000" } })
    expect(res.statusCode).toBe(200)
  })

  it("does NOT filter app.nodaro.ai (passes through to normal routing)", async () => {
    const app = await makeApp()
    const credits = await app.inject({ method: "GET", url: "/v1/credits/balance", headers: { host: "app.nodaro.ai" } })
    expect(credits.statusCode).toBe(200)
    const oauthAs = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: { host: "app.nodaro.ai" } })
    expect(oauthAs.statusCode).toBe(200)
  })

  it("does NOT filter localhost (dev)", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/v1/credits/balance", headers: { host: "localhost:8000" } })
    expect(res.statusCode).toBe(200)
  })

  it("does NOT filter unknown hosts (defense-in-depth — only mcp.* gets restricted)", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "GET", url: "/v1/credits/balance", headers: { host: "192.0.2.1" } })
    expect(res.statusCode).toBe(200)
  })
})
