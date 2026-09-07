import { describe, it, expect, vi } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * The DEFAULT surface — what a deployment that has not turned the studio
 * production API on actually answers.
 *
 * `STUDIO_PRODUCTIONS_API` ships OFF (D11) and the flag's contract is not "the
 * routes refuse" but "the routes are not there": a 404 from the ROUTER, which
 * is the feature-detect a client uses (docs/deployment.md). The whole suite
 * runs with the flag forced ON (`test/setup.ts`), so without this file the
 * shipped default is pinned nowhere.
 *
 * Every case is asserted through the REAL app — `buildApp()` is where the
 * registration decision lives (`app.ts`), and a hand-built Fastify with the
 * same `if` in it would only prove the test agrees with itself.
 *
 * The 404 is checked by its SHAPE, not just its status: the routes answer
 * `{ error: { code: "not_found" } }` for a production a caller may not see, and
 * Fastify's unmatched-route body (`{ error: "Not Found", statusCode }`) is a
 * different thing entirely. Only the second one proves the route is absent.
 *
 * The MCP half of the same gate lives in
 * `lib/mcp/tools/__tests__/studio-production-flag-off.test.ts`.
 */

const h = vi.hoisted(() => ({ flag: false }))

// A GETTER, not a copied value: `app.ts` reads the flag while it REGISTERS, so
// each case sets `h.flag`, builds, and one mock covers both directions.
vi.mock("../../lib/config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("../../lib/config.js")
  return {
    ...orig,
    config: {
      ...orig.config,
      get STUDIO_PRODUCTIONS_API() {
        return h.flag
      },
    },
  }
})

const { buildApp } = await import("../../app.js")
const { config } = await import("../../lib/config.js")

const OWNER = "00000000-0000-4000-8000-000000000001"
const PRODUCTION = "00000000-0000-4000-8000-000000000020"

/** The whole family, one entry per route the flag registers. */
const ROUTES = [
  { method: "GET" as const, url: "/v1/studio/productions/skill" },
  { method: "POST" as const, url: "/v1/studio/productions/validate" },
  { method: "GET" as const, url: "/v1/studio/productions" },
  { method: "POST" as const, url: "/v1/studio/productions" },
  { method: "GET" as const, url: `/v1/studio/productions/${PRODUCTION}` },
  { method: "POST" as const, url: `/v1/studio/productions/${PRODUCTION}/import` },
]

/** The registered SHAPES, as the router knows them (no request, no database). */
const SHAPES = [
  { method: "GET" as const, url: "/v1/studio/productions/skill" },
  { method: "POST" as const, url: "/v1/studio/productions/validate" },
  { method: "GET" as const, url: "/v1/studio/productions" },
  { method: "POST" as const, url: "/v1/studio/productions" },
  { method: "GET" as const, url: "/v1/studio/productions/:id" },
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

async function appWithFlag(flagOn: boolean): Promise<FastifyInstance> {
  h.flag = flagOn
  return buildApp()
}

describe("STUDIO_PRODUCTIONS_API off — the routes are not registered", () => {
  it("answers every studio route with the ROUTER's 404, not the route's", async () => {
    const app = await appWithFlag(false)
    try {
      for (const route of ROUTES) {
        const res = await app.inject({
          method: route.method,
          url: route.url,
          headers: internal(),
          ...(route.method === "POST" ? { payload: { userId: OWNER, plan: {} } } : {}),
        })
        expect(res.statusCode, `${route.method} ${route.url}`).toBe(404)
        // Fastify's own body for an unmatched route: `error` is the STRING
        // "Not Found". A registered route that refused would send
        // `{ error: { code: "not_found", … } }` — an object.
        const body = res.json() as { error?: unknown }
        expect(typeof body.error, `${route.method} ${route.url}`).toBe("string")
      }
      for (const shape of SHAPES) expect(app.hasRoute(shape), shape.url).toBe(false)
    } finally {
      await app.close()
    }
  }, 60_000)

  it("and the SAME app registers all six when the flag is on", async () => {
    // Otherwise the case above passes just as well the day the routes stop
    // existing altogether, or the day `buildApp` stops registering anything.
    const app = await appWithFlag(true)
    try {
      for (const shape of SHAPES) expect(app.hasRoute(shape), shape.url).toBe(true)
      // One live call, on the route that reads nothing: the family is reachable,
      // not merely present in the router's table.
      const res = await app.inject({
        method: "GET",
        url: "/v1/studio/productions/skill",
        headers: internal(),
      })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  }, 60_000)
})
