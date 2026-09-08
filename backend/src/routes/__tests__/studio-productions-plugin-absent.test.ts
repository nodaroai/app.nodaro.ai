import { describe, it, expect, vi } from "vitest"

/**
 * What a deployment that does not serve studio productions actually answers.
 *
 * The `/v1/studio/productions/*` family is a Nodaro Cloud feature: the routes
 * are registered by a private plugin the image installs only where it is
 * licensed to. The contract is therefore not "the routes refuse" but "the
 * routes are not there" — a 404 from the ROUTER, which is the feature-detect a
 * client uses.
 *
 * The 404 is checked by its SHAPE, not just its status: a registered route that
 * refused would answer `{ error: { code: "not_found", … } }` — an object —
 * while Fastify's unmatched-route body carries the STRING "Not Found". Only the
 * second one proves the route is absent, and the MCP half of this gate
 * (`lib/mcp/tools/__tests__/studio-production-plugin-absent.test.ts`) turns
 * exactly that shape into `not_available`.
 *
 * Every case is asserted through the REAL app: `buildApp()` is where the
 * registration happens, and a hand-built Fastify would only prove the test
 * agrees with itself. The plugin loader is mocked to load nothing so the case
 * holds on a machine that HAS the plugin installed too — otherwise this suite
 * would quietly pass for the wrong reason on CI and fail for a developer.
 */

vi.mock("../../lib/private-plugins/load.js", () => ({
  getPluginServices: vi.fn(() => ({})),
  loadPrivatePlugins: vi.fn(async () => ({ handlers: {}, loaded: [], engines: {} })),
}))

const { buildApp } = await import("../../app.js")
const { config } = await import("../../lib/config.js")

const OWNER = "00000000-0000-4000-8000-000000000001"
const PRODUCTION = "00000000-0000-4000-8000-000000000020"

/** Every route of the family, as a caller would address one. */
const ROUTES = [
  { method: "GET" as const, url: "/v1/studio/productions/skill" },
  { method: "POST" as const, url: "/v1/studio/productions/validate" },
  { method: "GET" as const, url: "/v1/studio/productions" },
  { method: "POST" as const, url: "/v1/studio/productions" },
  { method: "GET" as const, url: `/v1/studio/productions/${PRODUCTION}` },
  { method: "GET" as const, url: `/v1/studio/productions/${PRODUCTION}/export-plan` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/ops` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/reconcile` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/generate` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/frame` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/voice` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/revoice` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/music` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/describe` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/import` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/share` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/unshare` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/clone` },
]

/** The shapes, as the router would know them if anything had registered them. */
const SHAPES = [
  { method: "GET" as const, url: "/v1/studio/productions/skill" },
  { method: "POST" as const, url: "/v1/studio/productions/validate" },
  { method: "GET" as const, url: "/v1/studio/productions" },
  { method: "POST" as const, url: "/v1/studio/productions" },
  { method: "GET" as const, url: "/v1/studio/productions/:id" },
  { method: "POST" as const, url: "/v1/studio/productions/:id/ops" },
  { method: "POST" as const, url: "/v1/studio/productions/:id/import" },
]

/**
 * Authenticated as the internal orchestrator — the same door the MCP tools come
 * through. Without it the auth hook answers 401 on the not-found path too, and
 * a 401 would hide exactly the difference this file exists to see.
 */
function internal(): Record<string, string> {
  return {
    "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
    "x-internal-user-id": OWNER,
  }
}

describe("no studio production plugin — the routes are not registered", () => {
  it("answers every studio route with the ROUTER's 404, not a route's", async () => {
    const app = await buildApp()
    try {
      for (const route of ROUTES) {
        const res = await app.inject({
          method: route.method,
          url: route.url,
          headers: internal(),
          ...(route.method === "POST" ? { payload: {} } : {}),
        })
        expect(res.statusCode, `${route.method} ${route.url}`).toBe(404)
        const body = res.json() as { error?: unknown }
        expect(typeof body.error, `${route.method} ${route.url}`).toBe("string")
      }
      for (const shape of SHAPES) expect(app.hasRoute(shape), shape.url).toBe(false)

      // The app itself is fine — the family is absent because nothing
      // registered it, not because the server failed to build.
      const health = await app.inject({ method: "GET", url: "/health" })
      expect(health.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  }, 60_000)
})
