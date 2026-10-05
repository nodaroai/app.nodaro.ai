import { describe, it, expect } from "vitest"
import { chargingRoutesIn, clientRoutesIn, routePath } from "./metered-routes"

/**
 * The reads `paid-run-mark-guard` checks its paid set with, on sources of
 * their own: a scan that silently stopped matching would let a route that
 * charges through unseen.
 */

describe("routePath", () => {
  it("spells every parameter as `:` and drops a query", () => {
    expect(routePath("/v1/characters/:id/llm-caption")).toBe("/v1/characters/:/llm-caption")
    expect(routePath("/v1/jobs?:")).toBe("/v1/jobs")
    expect(routePath("/v1/llm-suggest-description")).toBe("/v1/llm-suggest-description")
  })
})

describe("chargingRoutesIn", () => {
  const routes = (text: string) => chargingRoutesIn("backend/src/routes/thing.ts", text).map((r) => r.route)

  it("finds a route whose preHandler is the credit guard, or whose handler meters", () => {
    expect(routes(`export async function r(app) {
      app.post("/v1/llm-suggest-description", { preHandler: creditGuard(() => ID) }, async () => ({}))
      app.post(
        "/v1/characters/:id/llm-caption",
        { config: {} },
        async (req, reply) => { const meter = await meterSyncLlm(req, reply, "x", ID) },
      )
    }`)).toEqual(["POST /v1/llm-suggest-description", "POST /v1/characters/:/llm-caption"])
  })

  it("leaves out a route that charges nothing, and anything that is not a /v1 route", () => {
    expect(routes(`creditGuard(() => ID)
      app.get("/v1/characters/:id", async () => ({}))
      app.post("/internal/thing", { preHandler: creditGuard(() => ID) }, async () => ({}))
      cache.get("/v1/key")`)).toEqual([])
  })

  it("says where the route is registered", () => {
    const [route] = chargingRoutesIn("backend/src/routes/thing.ts", `\n\napp.post("/v1/x", { preHandler: creditGuard(() => ID) }, h)`)
    expect(route).toEqual({ route: "POST /v1/x", path: "/v1/x", at: "backend/src/routes/thing.ts:3" })
  })
})

describe("clientRoutesIn", () => {
  const client = (text: string) => Object.fromEntries(clientRoutesIn("lib/api.ts", text))

  it("reads the routes each exported function names, a template's every ${…} as one parameter", () => {
    expect(client(`
      export async function suggest(body) { return apiJson("/v1/llm-suggest-description", { body }) }
      export async function caption(id: string) { return apiJson(\`/v1/characters/\${encodeURIComponent(id)}/llm-caption\`, {}) }
      export const run = async (id: string) => fetch(\`\${API_BASE_URL}/v1/workflows/\${id}/run\`, { method: "POST" })
      export async function list(q: string) { return apiJson(\`/v1/jobs?\${q}\`) }
      export function headers() { return {} }
      async function notExported() { return apiJson("/v1/hidden") }
    `)).toEqual({
      suggest: ["/v1/llm-suggest-description"],
      caption: ["/v1/characters/:/llm-caption"],
      run: ["/v1/workflows/:/run"],
      list: ["/v1/jobs"],
      headers: [],
    })
  })
})
