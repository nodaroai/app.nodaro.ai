/**
 * How much one user may keep, and change at once, in their presets
 * (lib/presets/limits.ts) — opened to API keys and OAuth apps, so a script can
 * loop where a person saves one at a time:
 *
 *   - presets, groups and favorites each have a per-user cap, far above what
 *     the editor reaches; past it a write is a clear 409 `limit_reached` and
 *     writes nothing (an import never lands half);
 *   - a reorder runs a few updates at a time, never all of them at once, and a
 *     key or an app moves fewer rows per call than the editor's session.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  rows: {} as Record<string, unknown[]>,
  writes: [] as string[],
  inFlight: 0,
  maxInFlight: 0,
}))

vi.mock("../../lib/supabase.js", () => {
  function chain(table: string): Record<string, unknown> {
    let write: string | null = null
    const c: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "order"]) c[m] = () => c
    for (const m of ["insert", "update", "delete", "upsert"]) {
      c[m] = () => {
        write = `${m} ${table}`
        h.writes.push(write)
        return c
      }
    }
    c.single = async () => ({ data: null, error: null })
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      if (write?.startsWith("update")) {
        h.inFlight += 1
        h.maxInFlight = Math.max(h.maxInFlight, h.inFlight)
        return new Promise((r) => setTimeout(r, 1)).then(() => {
          h.inFlight -= 1
          return resolve({ data: null, error: null })
        }, reject)
      }
      return Promise.resolve(resolve({ data: h.rows[table] ?? [], error: null, count: h.counts[table] ?? 0 }))
    }
    return c
  }
  return { supabase: { from: (table: string) => chain(table), auth: { getUser: vi.fn() } } }
})

const { nodePresetRoutes } = await import("../node-presets.js")
const { MAX_PRESETS_PER_USER, MAX_PRESET_FAVORITES_PER_USER, REORDER_CONCURRENCY, REORDER_LIMITS } = await import(
  "../../lib/presets/limits.js"
)

const USER = "00000000-0000-4000-8000-000000000001"
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`

async function app(authKind: "jwt" | "api_token" | "app_token" = "jwt"): Promise<FastifyInstance> {
  const a = Fastify()
  a.addHook("preHandler", async (req) => {
    const r = req as unknown as Record<string, unknown>
    r.userId = USER
    r.authKind = authKind
    if (authKind === "api_token") r.apiToken = { id: "t", userId: USER, workflowIds: [] }
    if (authKind === "app_token") r.appAuthorization = { appId: "a", authorizationId: "z", scopes: ["assets:write"] }
  })
  await a.register(nodePresetRoutes)
  return a
}

beforeEach(() => {
  h.counts = {}
  h.rows = {}
  h.writes = []
  h.inFlight = 0
  h.maxInFlight = 0
})

describe("per-user caps", () => {
  it("create is refused at the preset cap, and writes nothing", async () => {
    h.counts.node_presets = MAX_PRESETS_PER_USER
    const res = await (await app()).inject({
      method: "POST",
      url: "/v1/node-presets",
      payload: { nodeType: "generate-image", name: "One more", data: { prompt: "x" } },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "limit_reached" })
    expect(res.json().error.message).toContain(String(MAX_PRESETS_PER_USER))
    expect(h.writes).toEqual([])
  })

  it("an import that would pass the cap imports nothing, and says how much room is left", async () => {
    // Counted (the list read is capped at the API's row limit), not read off the name list.
    h.counts.node_presets = MAX_PRESETS_PER_USER - 1
    const presets = [1, 2].map((i) => ({ nodeType: "generate-image", name: `new ${i}`, data: { prompt: "x" } }))
    const res = await (await app()).inject({ method: "POST", url: "/v1/node-presets/import", payload: { presets } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("limit_reached")
    expect(res.json().error.message).toMatch(/room for 1/)
    expect(h.writes).toEqual([])
  })

  it("an import that fits is written whole", async () => {
    h.counts.node_presets = MAX_PRESETS_PER_USER - 2
    const presets = [1, 2].map((i) => ({ nodeType: "generate-image", name: `new ${i}`, data: { prompt: "x" } }))
    const res = await (await app()).inject({ method: "POST", url: "/v1/node-presets/import", payload: { presets } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ imported: 2 })
  })

  it("starring is refused at the favorites cap — unless that preset is already starred", async () => {
    h.counts.node_preset_favorites = MAX_PRESET_FAVORITES_PER_USER
    const a = await app()
    const payload = { nodeType: "generate-image", presetId: "generate-image/character-board" }
    const refused = await a.inject({ method: "POST", url: "/v1/node-presets/favorites", payload })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe("limit_reached")
    expect(h.writes).toEqual([])

    h.rows.node_preset_favorites = [{ preset_id: payload.presetId }]
    const again = await a.inject({ method: "POST", url: "/v1/node-presets/favorites", payload })
    expect(again.statusCode).toBe(200)
    expect(h.writes).toEqual([])
  })

  it("below the caps, writes go through", async () => {
    h.counts.node_presets = MAX_PRESETS_PER_USER - 1
    h.counts.node_preset_favorites = MAX_PRESET_FAVORITES_PER_USER - 1
    const a = await app()
    const created = await a.inject({ method: "POST", url: "/v1/node-presets", payload: { nodeType: "generate-image", name: "Last", data: { prompt: "x" } } })
    expect(created.statusCode).not.toBe(409)
    const starred = await a.inject({ method: "POST", url: "/v1/node-presets/favorites", payload: { nodeType: "generate-image", presetId: "x" } })
    expect(starred.statusCode).toBe(200)
    expect(h.writes).toContain("upsert node_preset_favorites")
  })
})

describe("reorder", () => {
  const presets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: uuid(i + 1), sortOrder: i }))

  it(`runs at most ${REORDER_CONCURRENCY} updates at once`, async () => {
    const res = await (await app()).inject({ method: "POST", url: "/v1/node-presets/reorder", payload: { presets: presets(60) } })
    expect(res.statusCode).toBe(200)
    expect(h.writes.filter((w) => w === "update node_presets")).toHaveLength(60)
    expect(h.maxInFlight).toBeGreaterThan(1)
    expect(h.maxInFlight).toBeLessThanOrEqual(REORDER_CONCURRENCY)
  })

  it.each(["api_token", "app_token"] as const)("a %s moves at most the programmatic bound per call", async (kind) => {
    const a = await app(kind)
    const over = await a.inject({
      method: "POST",
      url: "/v1/node-presets/reorder",
      payload: { presets: presets(REORDER_LIMITS.programmatic.presets + 1) },
    })
    expect(over.statusCode).toBe(400)
    expect(over.json().error.message).toMatch(/at most 500 presets/)
    expect(h.writes).toEqual([])
    const fits = await a.inject({ method: "POST", url: "/v1/node-presets/reorder", payload: { presets: presets(REORDER_LIMITS.programmatic.presets) } })
    expect(fits.statusCode).toBe(200)
  })

  it("the editor's session keeps its long-standing bound", async () => {
    const res = await (await app("jwt")).inject({
      method: "POST",
      url: "/v1/node-presets/reorder",
      payload: { presets: presets(REORDER_LIMITS.programmatic.presets + 1) },
    })
    expect(res.statusCode).toBe(200)
    expect(REORDER_LIMITS.session).toEqual({ presets: 2_000, groups: 500 })
  })
})
