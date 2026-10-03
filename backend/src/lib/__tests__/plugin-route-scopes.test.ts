import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import { registerPluginRouteScopeHook, scopeForPluginRoute } from "../plugin-route-scopes.js"

describe("scopeForPluginRoute", () => {
  it("reads need assets:read and changes need assets:write on the competitor routes", () => {
    expect(scopeForPluginRoute("GET", "/v1/competitors")).toBe("assets:read")
    expect(scopeForPluginRoute("GET", "/v1/competitors/cards?x=1")).toBe("assets:read")
    expect(scopeForPluginRoute("POST", "/v1/competitors")).toBe("assets:write")
    expect(scopeForPluginRoute("DELETE", "/v1/competitors/abc")).toBe("assets:write")
    expect(scopeForPluginRoute("POST", "/v1/competitor-discover")).toBe("assets:write")
  })

  it("covers nothing else (a prefix is a whole path segment)", () => {
    expect(scopeForPluginRoute("GET", "/v1/competitorsx")).toBeNull()
    expect(scopeForPluginRoute("POST", "/v1/competitor-scan")).toBeNull()
    expect(scopeForPluginRoute("GET", "/v1/saved-posts")).toBeNull()
  })
})

describe("the hook", () => {
  async function appWith(scopes: string[] | null) {
    const app = Fastify()
    app.addHook("preHandler", async (req) => {
      if (scopes) (req as { appAuthorization?: unknown }).appAuthorization = { scopes }
    })
    registerPluginRouteScopeHook(app)
    app.get("/v1/competitors", async () => ({ data: [] }))
    app.post("/v1/competitors", async () => ({ ok: true }))
    app.delete("/v1/competitors/:id", async () => ({ success: true }))
    app.post("/v1/competitor-discover", async () => ({ accounts: {} }))
    await app.ready()
    return app
  }

  it("refuses an app token without the scope, and lets the right one and a first-party caller through", async () => {
    const readOnly = await appWith(["assets:read"])
    expect((await readOnly.inject({ method: "GET", url: "/v1/competitors" })).statusCode).toBe(200)
    expect((await readOnly.inject({ method: "POST", url: "/v1/competitors", payload: {} })).statusCode).toBe(403)

    const firstParty = await appWith(null)
    expect((await firstParty.inject({ method: "POST", url: "/v1/competitors", payload: {} })).statusCode).toBe(200)
  })
  it("reads the route the router matched, so an encoded path is held to the same scope", async () => {
    const other = await appWith(["jobs:read"])
    for (const [method, url] of [
      ["GET", "/v1/%63ompetitors"],
      ["GET", "/v1/competitor%73"],
      ["DELETE", "/v1/%63ompetitors/abc"],
      ["POST", "/v1/competitor%2Ddiscover"],
    ] as const) {
      const res = await other.inject({ method, url, ...(method === "GET" || method === "DELETE" ? {} : { payload: {} }) })
      expect(res.statusCode, `${method} ${url}`).toBe(403)
    }
    expect((await other.inject({ method: "GET", url: "/v1/nothing-here" })).statusCode).toBe(404)
  })
})
