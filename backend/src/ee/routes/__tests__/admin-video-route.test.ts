import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/video-route` — which route each Seedance 2.x model takes, per
 * service, and the routed price's correction factors.
 *
 * What must hold: admin-only; GET answers every model on "default" until a
 * save; a save is strict (a model that cannot be routed is 400) and
 * audit-logged; "revert" puts every model back on "default" and keeps the
 * thresholds; factors of 1 are dropped (a reset), an edit is marked "admin".
 */
const h = vi.hoisted(() => ({
  rows: new Map<string, { value: unknown; updated_at: string }>(),
  audits: [] as Record<string, unknown>[],
  admin: true,
  routesPerModel: true,
  clock: 0,
}))
vi.mock("@/lib/video-route-host.js", () => ({ get HOST_ROUTES_PER_MODEL() { return h.routesPerModel } }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") return { insert: async (row: Record<string, unknown>) => (h.audits.push(row), { error: null }) }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      let key = ""
      let stamp: string | null | undefined
      let patch: { value: unknown } | null = null
      const stampOf = () => `t${++h.clock}`
      const chain = {
        select: () => (patch ? chain.apply() : chain),
        eq: (c: string, v: string) => (c === "key" ? (key = v) : (stamp = v), chain),
        is: (_c: string, _v: null) => ((stamp = null), chain),
        maybeSingle: async () => ({ data: h.rows.get(key) ?? null, error: null }),
        upsert: async (row: { key: string; value: unknown }) => {
          h.rows.set(row.key, { value: row.value, updated_at: stampOf() })
          return { error: null }
        },
        insert: async (row: { key: string; value: unknown }) => {
          if (h.rows.has(row.key)) return { error: { message: "duplicate" } }
          h.rows.set(row.key, { value: row.value, updated_at: stampOf() })
          return { error: null }
        },
        update: (row: { value: unknown }) => ((patch = row), chain),
        apply: async () => {
          const current = h.rows.get(key)
          if (!current || (stamp !== undefined && current.updated_at !== stamp)) return { data: [], error: null }
          h.rows.set(key, { value: patch!.value, updated_at: stampOf() })
          return { data: [{ key }], error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({
  invalidateSettingsCache: () => {},
  getAppSettings: async () => ({ cost_markup_percent: 0, service_margin_percent: {} }),
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))

const { adminVideoRouteRoutes, VIDEO_ROUTE_AUDIT_TARGET } = await import("../admin-video-route.js")
const { videoRoutePriceFactorsKey, videoRoutePolicyKey } = await import("../../../lib/video-route-policy.js")
const { setPluginServices, _resetPluginServicesForTests } = await import("../../../lib/private-plugins/services-registry.js")
const { _resetAlternateRoutePricesForTests } = await import("../../../lib/alternate-route-prices.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/video-route"
let app: FastifyInstance

beforeEach(async () => {
  h.rows.clear()
  h.audits = []
  h.admin = true
  _resetPluginServicesForTests()
  _resetAlternateRoutePricesForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminVideoRouteRoutes)
  await app.ready()
})

const policy = (models: Record<string, unknown>) => ({
  models,
  routeBalanceAlertUsd: 25,
  defaultProviderBalanceAlertCredits: null,
  spendDriftAlertPercent: 3,
  failureAlert: { failures: 5, windowMinutes: 30 },
})

describe("/v1/admin/video-route", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers every model on the default route until a save, and no route here", async () => {
    const data = (await app.inject({ method: "GET", url: URL, headers: as })).json().data
    expect(data.updatedAt).toBeNull()
    expect(data.policy.models).toEqual({})
    expect(data.route).toEqual({ present: false, v2: false })
    expect(data.models.map((m: { id: string }) => m.id)).toEqual(["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5", "seedance-2-5-flash"])
    expect(data.services.platform).toContain("extend-video")
  })

  it("shows this environment's route: capable models and its listed prices as charged", async () => {
    setPluginServices({
      alternateRoutes: {
        accepts: () => null, start: async () => ({ taskRef: "t" }), poll: async () => ({ state: "running" }),
        prices: () => [{ id: "seedance-2-5:8s:720p", usd: 0.14 }, { id: "not-a-seedance-id", usd: 0.01 }],
      },
    })
    const data = (await app.inject({ method: "GET", url: URL, headers: as })).json().data
    expect(data.route).toEqual({ present: true, v2: true })
    expect(data.models.find((m: { id: string }) => m.id === "seedance-2-5").capable).toBe(true)
    expect(data.models.find((m: { id: string }) => m.id === "seedance-2").capable).toBe(false)
    // $0.14 at the credit's value is 70 credits: the route step leaves it at 70.
    expect(data.prices).toEqual({ "seedance-2-5": [{ id: "seedance-2-5:8s:720p", base: 70, charged: 70 }] })
  })

  it("saves a policy (audited) and refuses a model that cannot be routed", async () => {
    const ok = await app.inject({ method: "PUT", url: URL, headers: as, payload: { policy: policy({ "seedance-2": { route: "alternate", services: { "lip-sync": "default" } } }) } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.policy.models).toEqual({ "seedance-2": { route: "alternate", services: { "lip-sync": "default" } } })
    expect(h.audits[0]).toMatchObject({ action: "update_video_route_policy", target_id: VIDEO_ROUTE_AUDIT_TARGET })
    const bad = await app.inject({ method: "PUT", url: URL, headers: as, payload: { policy: policy({ "kling-3.0": { route: "alternate" } }) } })
    expect(bad.statusCode).toBe(400)
    // A service this deployment does not have.
    const badService = await app.inject({ method: "PUT", url: URL, headers: as, payload: { policy: policy({ "seedance-2": { route: "default", services: { "made-up-lane": "alternate" } } }) } })
    expect(badService.statusCode).toBe(400)
  })

  it("never saves a model on the alternate route in a build that cannot run it (and always saves 'default')", async () => {
    h.routesPerModel = false
    const refused = await app.inject({ method: "PUT", url: URL, headers: as, payload: { policy: policy({ "seedance-2": { route: "alternate" } }) } })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe("routing_unavailable")
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { policy: policy({ "seedance-2": { route: "default" } }) } })).statusCode).toBe(200)
    h.routesPerModel = true
  })

  it("reverts every model to the default route and keeps the thresholds", async () => {
    await app.inject({ method: "PUT", url: URL, headers: as, payload: { policy: policy({ "seedance-2": { route: "alternate" } }) } })
    const res = await app.inject({ method: "POST", url: `${URL}/revert`, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.policy).toMatchObject({ models: {}, routeBalanceAlertUsd: 25 })
    expect(h.audits.at(-1)).toMatchObject({ action: "revert_video_route_policy" })
  })

  it("edits and resets factors: 1 is dropped, a change is the admin's", async () => {
    const res = await app.inject({ method: "PUT", url: `${URL}/factors`, headers: as, payload: { expectedUpdatedAt: null, factors: { "seedance-2:720p:noref:generate": { factor: 1.3 }, "seedance-2:480p:noref:generate": { factor: 1 } } } })
    expect(res.statusCode).toBe(200)
    const factors = res.json().data.factors
    expect(Object.keys(factors)).toEqual(["seedance-2:720p:noref:generate"])
    expect(factors["seedance-2:720p:noref:generate"]).toMatchObject({ factor: 1.3, by: "admin" })
    // Not a factor key, or a factor below 1.
    expect((await app.inject({ method: "PUT", url: `${URL}/factors`, headers: as, payload: { expectedUpdatedAt: null, factors: { k: { factor: 1.2 } } } })).statusCode).toBe(400)
    expect((await app.inject({ method: "PUT", url: `${URL}/factors`, headers: as, payload: { expectedUpdatedAt: null, factors: { "seedance-2:720p:noref:generate": { factor: 0.5 } } } })).statusCode).toBe(400)
  })

  it("refuses a factor save made over a table that changed since (an automatic raise is never dropped)", async () => {
    const first = await app.inject({ method: "PUT", url: `${URL}/factors`, headers: as, payload: { expectedUpdatedAt: null, factors: { "seedance-2:720p:noref:generate": { factor: 1.3 } } } })
    const seen = first.json().data.factorsUpdatedAt
    // An automatic raise lands meanwhile.
    h.rows.set(videoRoutePriceFactorsKey(), { value: { "seedance-2:720p:noref:generate": { factor: 1.6, updatedAt: "x", by: "auto" } }, updated_at: "raised" })
    const stale = await app.inject({ method: "PUT", url: `${URL}/factors`, headers: as, payload: { expectedUpdatedAt: seen, factors: { "seedance-2:720p:noref:generate": { factor: 1.3 } } } })
    expect(stale.statusCode).toBe(409)
    expect((h.rows.get(videoRoutePriceFactorsKey())!.value as Record<string, { factor: number }>)["seedance-2:720p:noref:generate"]!.factor).toBe(1.6)
    const fresh = await app.inject({ method: "PUT", url: `${URL}/factors`, headers: as, payload: { expectedUpdatedAt: "raised", factors: { "seedance-2:720p:noref:generate": { factor: 1.2 } } } })
    expect(fresh.statusCode).toBe(200)
  })

  it("keeps each environment's setting apart: a save on staging never changes production", async () => {
    const before = process.env.RUNTIME_ENV
    try {
      process.env.RUNTIME_ENV = "staging"
      expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { policy: policy({ "seedance-2": { route: "alternate" } }) } })).statusCode).toBe(200)
      expect(h.rows.has(videoRoutePolicyKey("staging"))).toBe(true)
      expect(h.rows.has(videoRoutePolicyKey("production"))).toBe(false)
      process.env.RUNTIME_ENV = "production"
      expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.policy.models).toEqual({})
    } finally {
      if (before === undefined) delete process.env.RUNTIME_ENV
      else process.env.RUNTIME_ENV = before
    }
  })
})
