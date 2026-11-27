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
  outcomes: [] as Array<{ outcome: unknown }>,
  ledger: [] as Array<Record<string, unknown>>,
  recover: vi.fn(async (_jobId: string) => true),
  previews: {} as Record<string, { credits: number | null; billedUsd: number | null; quotedUsd: number | null; usedQuote: boolean; anomalous: boolean; routeId: string | undefined }>,
  resolves: [] as unknown[][],
  onResolve: null as null | (() => void),
  schema: { status: "whole", missing: [], checkInstalled: true } as { status: "whole" | "incomplete" | "unverified"; missing: string[]; checkInstalled?: boolean },
  schemaAsks: [] as unknown[],
}))
// The schema check (lib/video-route-schema.ts) has its own suite: here, what a save does with each answer.
vi.mock("@/lib/video-route-schema.js", () => ({
  videoRouteSchemaState: async (opts: unknown) => (h.schemaAsks.push(opts), h.schema),
}))
// The re-read of the route before a decision (lib/video-route-resolve.ts) has its own suite: here, that it is asked, and what a changed total does.
vi.mock("@/lib/video-route-resolve.js", () => ({
  resolveRouteLedger: async (...a: unknown[]) => {
    h.resolves.push(a)
    h.onResolve?.()
    return { readable: true, resolved: 0, billed: 0 }
  },
}))
vi.mock("../../billing/video-route-settlement.js", () => ({
  recoverRoutedSettlement: h.recover,
  previewRoutedSettlement: async (jobId: string) => h.previews[jobId] ?? { credits: null, billedUsd: null, quotedUsd: null, usedQuote: false, anomalous: false, routeId: undefined },
  RoutedSettleHeld: class RoutedSettleHeld extends Error {},
}))
vi.mock("@/lib/video-route-host.js", () => ({ get HOST_ROUTES_PER_MODEL() { return h.routesPerModel } }))

vi.mock("@/lib/supabase.js", () => ({
  RUNTIME_ENV_NAMEABLE: true,
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") return { insert: async (row: Record<string, unknown>) => (h.audits.push(row), { error: null }) }
      if (table === "jobs") {
        const q: Record<string, unknown> = {}
        for (const m of ["select", "gte", "not", "eq", "order"]) q[m] = () => q
        q.limit = async () => ({ data: h.outcomes, error: null })
        return q
      }
      if (table === "video_route_ledger") {
        // The settle rows: listed while held; decided by a compare-and-set on (hold, no decision).
        const where: Record<string, unknown> = {}
        let patch: Record<string, unknown> | null = null
        const anyOf: Record<string, unknown[]> = {}
        const matching = () => h.ledger.filter((r) => Object.entries(where).every(([c, v]) => (r[c] ?? null) === v) && Object.entries(anyOf).every(([c, vs]) => vs.includes(r[c])))
        const q: Record<string, unknown> = {}
        q.eq = (c: string, v: unknown) => ((where[c] = v), q)
        q.is = (c: string, v: null) => ((where[c] = v), q)
        q.in = (c: string, vs: unknown[]) => ((anyOf[c] = vs), q)
        q.order = () => q
        q.update = (row: Record<string, unknown>) => ((patch = row), q)
        q.limit = async () => ({ data: matching(), error: null })
        q.select = () => {
          if (!patch) return q
          const rows = matching()
          for (const r of rows) Object.assign(r, patch)
          return Promise.resolve({ data: rows.map((r) => ({ id: r.id })), error: null })
        }
        return q
      }
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
vi.mock("../../billing/credits.js", () => ({
  getChargedPriceTable: async () => ({ base: (id: string) => (id === "seedance-2-5:8s:720p" ? 60 : undefined), charge: (_id: string, b: number) => b }),
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))

const { adminVideoRouteRoutes, VIDEO_ROUTE_AUDIT_TARGET } = await import("../admin-video-route.js")
const { videoRoutePriceFactorsKey, videoRoutePolicyKey } = await import("../../../lib/video-route-policy.js")
const { setPluginServices, _resetPluginServicesForTests } = await import("../../../lib/private-plugins/services-registry.js")
const { _resetAlternateRoutePricesForTests } = await import("../../../lib/alternate-route-prices.js")
const { getRuntimeEnv } = await import("../../../lib/runtime-env.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/video-route"
let app: FastifyInstance

beforeEach(async () => {
  h.rows.clear()
  h.audits = []
  h.ledger = []
  h.previews = {}
  h.resolves = []
  h.onResolve = null
  h.schema = { status: "whole", missing: [], checkInstalled: true }
  h.schemaAsks = []
  h.recover.mockReset().mockResolvedValue(true)
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

/** A route that speaks per-model routing and lists a price for Seedance 2 (so it can take it). */
const capableRoute = () => setPluginServices({
  alternateRoutes: {
    accepts: () => null, start: async () => ({ taskRef: "t" }), poll: async () => ({ state: "running" }),
    prices: () => [{ id: "seedance-2:8s:720p", usd: 0.2 }],
  },
})

/** The `updatedAt` of the policy as the page would have read it just now (null: never saved). */
const savedAt = () => h.rows.get(videoRoutePolicyKey())?.updated_at ?? null

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
        prices: () => [{ id: "seedance-2-5:8s:720p", usd: 0.2 }, { id: "not-a-seedance-id", usd: 0.01 }],
      },
    })
    const data = (await app.inject({ method: "GET", url: URL, headers: as })).json().data
    expect(data.route).toEqual({ present: true, v2: true })
    expect(data.models.find((m: { id: string }) => m.id === "seedance-2-5").capable).toBe(true)
    expect(data.models.find((m: { id: string }) => m.id === "seedance-2").capable).toBe(false)
    // An invented round $0.20 at the credit's value is 100 credits: the route step leaves it at 100.
    expect(data.prices).toEqual({ "seedance-2-5": [{ id: "seedance-2-5:8s:720p", base: 100, charged: 100, defaultCharged: 60 }] })
  })

  it("counts accepted requests, refusals and historical defaults separately", async () => {
    h.outcomes = [
      { outcome: { route: "alternate", model: "seedance-2", service: "image-to-video", at: "x" } },
      { outcome: { route: "alternate", model: "seedance-2", service: "image-to-video", at: "x" } },
      { outcome: { route: "default", why: "not-accepted", model: "seedance-2", service: "image-to-video", at: "x" } },
      { outcome: { route: "default", why: "not-capable", model: "seedance-2-5", service: "lip-sync", at: "x" } },
      { outcome: { route: "refused", why: "not-accepted", model: "seedance-2", service: "image-to-video", at: "x" } },
      { outcome: null },
    ]
    const data = (await app.inject({ method: "GET", url: URL, headers: as })).json().data
    expect(data.outcomes).toEqual([
      { model: "seedance-2", service: "image-to-video", alternate: 2, kept: { "not-accepted": 1 }, refused: { "not-accepted": 1 } },
      { model: "seedance-2-5", service: "lip-sync", alternate: 0, kept: { "not-capable": 1 }, refused: {} },
    ])
    h.outcomes = []
  })

  it("saves a policy (audited) and refuses a model that cannot be routed", async () => {
    capableRoute()
    const ok = await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({ "seedance-2": { route: "alternate", services: { "lip-sync": "default" } } }) } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.policy.models).toEqual({ "seedance-2": { route: "alternate", services: { "lip-sync": "default" } } })
    expect(h.audits[0]).toMatchObject({ action: "update_video_route_policy", target_id: VIDEO_ROUTE_AUDIT_TARGET })
    const bad = await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({ "kling-3.0": { route: "alternate" } }) } })
    expect(bad.statusCode).toBe(400)
    // A service this deployment does not have.
    const badService = await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({ "seedance-2": { route: "default", services: { "made-up-lane": "alternate" } } }) } })
    expect(badService.statusCode).toBe(400)
  })

  it("never saves a model on the alternate route in a build that cannot run it (and always saves 'default')", async () => {
    h.routesPerModel = false
    const refused = await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({ "seedance-2": { route: "alternate" } }) } })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe("routing_unavailable")
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({ "seedance-2": { route: "default" } }) } })).statusCode).toBe(200)
    h.routesPerModel = true
  })

  it("reverts every model to the default route and keeps the thresholds", async () => {
    capableRoute()
    await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({ "seedance-2": { route: "alternate" } }) } })
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
      capableRoute()
      expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({ "seedance-2": { route: "alternate" } }) } })).statusCode).toBe(200)
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


describe("a model is put on the alternate route only where the loaded route can take it", () => {
  const routedSave = () => app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({ "seedance-2": { route: "default", services: { "lip-sync": "alternate" } } }) } })
  it("refuses with no route loaded, with a route that predates per-model routing, and for a model the route does not know", async () => {
    const none = await routedSave()
    expect(none.statusCode).toBe(409)
    expect(none.json().error).toMatchObject({ code: "route_cannot_take_model", message: expect.stringContaining("seedance-2") })
    setPluginServices({ alternateRoutes: { accepts: () => null, start: async () => ({ taskRef: "t" }), poll: async () => ({ state: "running" }) } })
    expect((await routedSave()).statusCode).toBe(409)
    capableRoute()
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({ "seedance-2-5": { route: "alternate" } }) } })).statusCode).toBe(409)
    expect(h.rows.has(videoRoutePolicyKey())).toBe(false)
    // The default route is always saveable, and so is a model the route can take.
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({ "seedance-2-5": { route: "default" } }) } })).statusCode).toBe(200)
    expect((await routedSave()).statusCode).toBe(200)
  })
})

describe("a save that routes a model or turns on unpaid-charge enforcement needs the schema PROVEN whole", () => {
  const routed = () => policy({ "seedance-2": { route: "alternate" } })
  const save = (p: unknown) => app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: p } })

  it("refuses with the schema check function not installed (409 schema_unverified, saying so), asked fresh, and saves nothing", async () => {
    capableRoute()
    h.schema = { status: "unverified", missing: [], checkInstalled: false }
    for (const p of [routed(), { ...policy({}), enforceUnpaidCharges: true }]) {
      const res = await save(p)
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toMatchObject({ code: "schema_unverified", message: expect.stringContaining("schema check function is not installed") })
    }
    expect(h.schemaAsks).toEqual([{ fresh: true }, { fresh: true }])
    expect(h.rows.has(videoRoutePolicyKey())).toBe(false)
  })

  it("fails CLOSED when the check could not be asked, and names what is proven missing", async () => {
    capableRoute()
    h.schema = { status: "unverified", missing: [] }
    expect((await save(routed())).json().error).toMatchObject({ code: "schema_unverified", message: expect.stringContaining("could not be verified just now") })
    h.schema = { status: "incomplete", missing: ["trigger recover_video_allowance on deployment_user_allowances"], checkInstalled: true }
    expect((await save(routed())).json().error).toMatchObject({ code: "schema_incomplete", message: expect.stringContaining("recover_video_allowance") })
    expect(h.rows.has(videoRoutePolicyKey())).toBe(false)
  })

  it("a save that routes nothing and turns nothing on (and the revert) is never asked about the schema", async () => {
    h.schema = { status: "unverified", missing: [], checkInstalled: false }
    expect((await save(policy({ "seedance-2": { route: "default" } }))).statusCode).toBe(200)
    expect((await app.inject({ method: "POST", url: `${URL}/revert`, headers: as })).statusCode).toBe(200)
    expect(h.schemaAsks).toEqual([])
  })

  it("enforcement already on is not 'turned on' again by a later save", async () => {
    h.rows.set(videoRoutePolicyKey(), { value: { ...policy({}), enforceUnpaidCharges: true }, updated_at: "on" })
    h.schema = { status: "unverified", missing: [], checkInstalled: false }
    const res = await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: "on", policy: { ...policy({}), enforceUnpaidCharges: true, billAnomalyMultiple: 6 } } })
    expect(res.statusCode).toBe(200)
    expect(h.schemaAsks).toEqual([])
  })
})

describe("a policy save made over a newer policy is refused (another admin saved since)", () => {
  it("answers 409 and leaves the newer policy, then saves once the page is reloaded", async () => {
    capableRoute()
    const first = await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: null, policy: policy({ "seedance-2": { route: "alternate" } }) } })
    expect(first.statusCode).toBe(200)
    // A second page, loaded before that save, tries to save its own edit.
    const stale = await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: null, policy: policy({}) } })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe("stale_policy")
    expect((h.rows.get(videoRoutePolicyKey())!.value as { models: unknown }).models).toEqual({ "seedance-2": { route: "alternate" } })
    const fresh = await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: first.json().data.updatedAt, policy: policy({}) } })
    expect(fresh.statusCode).toBe(200)
    // A save with no page stamp at all is not a save.
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { policy: policy({}) } })).statusCode).toBe(400)
  })
})

describe("the bill anomaly multiple and unpaid-charge enforcement", () => {
  it("default to the named constant and off with nothing saved, and for a policy saved before they existed", async () => {
    const { ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT } = await import("../../../lib/video-route-policy.js")
    const fresh = (await app.inject({ method: "GET", url: URL, headers: as })).json().data.policy
    expect(fresh).toMatchObject({ billAnomalyMultiple: ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT, enforceUnpaidCharges: false })
    // A page that predates the fields still saves; a row stored without them still reads.
    const saved = await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: policy({}) } })
    expect(saved.statusCode).toBe(200)
    h.rows.set(videoRoutePolicyKey(), { value: policy({ "seedance-2": { route: "alternate" } }), updated_at: "old" })
    const old = (await app.inject({ method: "GET", url: URL, headers: as })).json().data.policy
    expect(old).toMatchObject({ models: { "seedance-2": { route: "alternate" } }, billAnomalyMultiple: ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT, enforceUnpaidCharges: false })
  })

  it("are saved by an admin, validated and audited", async () => {
    const ok = await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: { ...policy({}), billAnomalyMultiple: 8, enforceUnpaidCharges: true } } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.policy).toMatchObject({ billAnomalyMultiple: 8, enforceUnpaidCharges: true })
    expect(h.audits.at(-1)).toMatchObject({ action: "update_video_route_policy", payload: { after: { billAnomalyMultiple: 8, enforceUnpaidCharges: true } } })
    for (const bad of [{ billAnomalyMultiple: 0.5 }, { billAnomalyMultiple: "5" }, { enforceUnpaidCharges: "yes" }]) {
      expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { expectedUpdatedAt: savedAt(), policy: { ...policy({}), ...bad } } })).statusCode).toBe(400)
    }
  })
})

describe("held settlements", () => {
  const JOB = "00000000-0000-4000-8000-0000000000b1"
  const OTHER = "00000000-0000-4000-8000-0000000000b2"
  const held = (job_id: string, env = getRuntimeEnv()) => ({ id: h.ledger.length + 1, job_id, env, kind: "settle", state: "hold", decision: null, credits: 900, billed_usd: "1.8", quoted_usd: "0.2", note: "9x", detail: { heldAt: "2026-11-26T12:00:00Z" }, created_at: "2026-11-26T11:00:00Z", updated_at: "2026-11-27T00:00:00Z" })

  it("lists this environment's held settlements only", async () => {
    h.ledger = [held(JOB), held(OTHER, "another-environment"), { ...held(OTHER), state: "retry" }]
    const data = (await app.inject({ method: "GET", url: URL, headers: as })).json().data
    h.previews[JOB] = { credits: 905, billedUsd: 1.81, quotedUsd: 0.2, usedQuote: false, anomalous: true, routeId: "r1" }
    const shown = (await app.inject({ method: "GET", url: URL, headers: as })).json().data
    // Beside what was recorded when it was held: what a decision would charge right now.
    expect(shown.holds).toEqual([{ jobId: JOB, kind: "anomaly", credits: 900, billedUsd: 1.8, quotedUsd: 0.2, note: "9x", heldAt: "2026-11-26T12:00:00Z", wouldCharge: 905, wouldLose: null, totalAnomalous: true }])
    expect(data.holds).toEqual([{ jobId: JOB, kind: "anomaly", credits: 900, billedUsd: 1.8, quotedUsd: 0.2, note: "9x", heldAt: "2026-11-26T12:00:00Z", wouldCharge: null, wouldLose: null, totalAnomalous: false }])
  })

  /** What settling the job would charge right now (the `wouldCharge` the page shows beside a hold). */
  const wouldCharge = (credits: number | null, over: Record<string, unknown> = {}) => { h.previews[JOB] = { credits, billedUsd: 1.8, quotedUsd: 0.2, usedQuote: false, anomalous: true, routeId: "r1", ...over } }
  const decide = (payload: Record<string, unknown>, jobId = JOB) => app.inject({ method: "POST", url: `${URL}/holds/${jobId}`, headers: as, payload })

  it.each([["confirm", "confirmed", "confirm_video_route_hold"], ["reject", "rejected", "reject_video_route_hold"]] as const)(
    "%s: one audited decision, applied by the one settlement; a second decision is refused", async (decision, stored, action) => {
      h.ledger = [held(JOB)]
      // A confirm names the total the admin was shown; a release names none (and none is computed for it).
      if (decision === "confirm") wouldCharge(900)
      const res = await decide(decision === "confirm" ? { decision, expectedChargedCredits: 900 } : { decision })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.decided).toMatchObject({ jobId: JOB, decision: stored, settled: true })
      expect(h.ledger[0]).toMatchObject({ state: "retry", decision: stored, decided_by: ADMIN })
      // The total a confirm was given for is kept beside it, after one more read of the route.
      if (decision === "confirm") {
        // (Kept beside what the row already carries: when it started waiting.)
        expect(h.ledger[0]!.detail).toEqual({ heldAt: "2026-11-26T12:00:00Z", decidedForCredits: 900 })
        expect(h.resolves).toEqual([[JOB, "r1"]])
      } else {
        // A release is for no total: none is kept, and the route is not read for one.
        expect(h.ledger[0]!.detail).toEqual({ heldAt: "2026-11-26T12:00:00Z" })
        expect(h.resolves).toEqual([])
      }
      expect(h.audits.at(-1)).toMatchObject({ action, target_type: "job", target_id: JOB, admin_user_id: ADMIN })
      expect(h.recover.mock.calls).toEqual([[JOB]])
      const again = await decide(decision === "confirm" ? { decision: "reject" } : { decision: "confirm", expectedChargedCredits: 900 })
      expect(again.statusCode).toBe(409)
      expect(again.json().error.code).toBe("not_held")
      expect(h.ledger[0]).toMatchObject({ decision: stored })
      expect(h.recover).toHaveBeenCalledTimes(1)
    })

  it("keeps the decision when applying it fails (the settlement sweep retries it), refuses what is not held, and is admin-only", async () => {
    h.ledger = [held(JOB)]
    wouldCharge(900)
    h.recover.mockRejectedValueOnce(new Error("settings unreadable"))
    const res = await decide({ decision: "confirm", expectedChargedCredits: 900 })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.decided).toEqual({ jobId: JOB, decision: "confirmed", settled: false, chargedCredits: null, heldForTotal: false })
    expect(h.ledger[0]).toMatchObject({ state: "retry", decision: "confirmed" })
    const other = await decide({ decision: "confirm", expectedChargedCredits: 900 }, OTHER)
    expect(other.statusCode).toBe(409)
    expect(other.json().error.code).toBe("not_held")
    expect((await decide({ decision: "confirm", expectedChargedCredits: 900 }, "not-a-job")).statusCode).toBe(400)
    expect((await decide({ decision: "maybe", expectedChargedCredits: 900 })).statusCode).toBe(400)
    h.admin = false
    expect((await decide({ decision: "confirm", expectedChargedCredits: 900 })).statusCode).toBe(403)
  })

  it("a confirm must name the total it is for (a whole number of credits, zero or more); a release needs none", async () => {
    h.ledger = [held(JOB)]
    wouldCharge(900)
    for (const payload of [{ decision: "confirm" }, { decision: "confirm", expectedChargedCredits: -1 }, { decision: "confirm", expectedChargedCredits: 900.5 }, { decision: "confirm", expectedChargedCredits: "900" }, { decision: "quote" }, { decision: "confirm", expectedChargedCredits: 900, extra: true }]) {
      const res = await decide(payload)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    // Refused before anything is read or decided.
    expect(h.resolves).toEqual([])
    expect(h.ledger[0]).toMatchObject({ state: "hold", decision: null })
    expect(h.audits).toEqual([])
    expect(h.recover).not.toHaveBeenCalled()
    expect((await decide({ decision: "reject" })).statusCode).toBe(200)
  })

  it("a release that carries a total is still decided: it is never checked against one, and none is kept", async () => {
    h.ledger = [held(JOB)]
    // The total has moved far from the one named, and would change again on a read of the route.
    wouldCharge(1500)
    h.onResolve = () => wouldCharge(null)
    const res = await decide({ decision: "reject", expectedChargedCredits: 900 })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.decided).toMatchObject({ jobId: JOB, decision: "rejected", settled: true })
    expect(h.ledger[0]).toMatchObject({ state: "retry", decision: "rejected", decided_by: ADMIN, credits: 900 })
    expect(h.ledger[0]!.detail).toEqual({ heldAt: "2026-11-26T12:00:00Z" })
    expect(h.resolves).toEqual([])
    expect(h.audits.at(-1)).toMatchObject({ action: "reject_video_route_hold", target_id: JOB })
    expect(h.recover.mock.calls).toEqual([[JOB]])
  })

  describe("a confirm is for the total the admin was shown", () => {
    it("a bill that arrives while it is held: confirming the old total decides nothing and charges nothing; the hold shows the new total", async () => {
      h.ledger = [held(JOB)]
      wouldCharge(900)
      // The read of the route before the decision finds a bill the page did not show.
      h.onResolve = () => wouldCharge(1500, { billedUsd: 3 })
      const res = await decide({ decision: "confirm", expectedChargedCredits: 900 })
      expect(res.statusCode).toBe(409)
      const body = res.json()
      expect(body.error.code).toBe("total_changed")
      expect(body.error.message).toContain("1500")
      expect(body.data.changed).toEqual({ jobId: JOB, expectedChargedCredits: 900, wouldCharge: 1500, totalAnomalous: true })
      // The page gets the hold back with its new figures, still waiting.
      expect(body.data.holds).toEqual([expect.objectContaining({ jobId: JOB, kind: "anomaly", credits: 1500, billedUsd: 3, quotedUsd: 0.2, wouldCharge: 1500, totalAnomalous: true })])
      expect(body.data.decided).toBeUndefined()
      expect(h.resolves).toEqual([[JOB, "r1"]])
      expect(h.ledger[0]).toMatchObject({ state: "hold", decision: null, credits: 1500, billed_usd: 3, quoted_usd: 0.2 })
      expect(h.ledger[0]!.decided_by).toBeUndefined()
      expect((h.ledger[0]!.detail as Record<string, unknown> | undefined)?.decidedForCredits).toBeUndefined()
      // Nothing was settled, and no decision was audited.
      expect(h.recover).not.toHaveBeenCalled()
      expect(h.audits).toEqual([])
      // Looked at again and confirmed for the new total, it is decided.
      h.onResolve = null
      const second = await decide({ decision: "confirm", expectedChargedCredits: 1500 })
      expect(second.statusCode).toBe(200)
      expect(h.ledger[0]).toMatchObject({ state: "retry", decision: "confirmed", detail: { decidedForCredits: 1500 } })
      expect(h.recover.mock.calls).toEqual([[JOB]])
    })

    it("one credit of rounding is the same total; two is not", async () => {
      h.ledger = [held(JOB)]
      wouldCharge(902)
      const far = await decide({ decision: "confirm", expectedChargedCredits: 900 })
      expect(far.statusCode).toBe(409)
      expect(far.json().data.changed).toMatchObject({ expectedChargedCredits: 900, wouldCharge: 902 })
      expect(h.ledger[0]).toMatchObject({ state: "hold", decision: null, credits: 902 })
      // A total that came DOWN is not the one shown either.
      expect((await decide({ decision: "confirm", expectedChargedCredits: 904 })).statusCode).toBe(409)
      expect(h.recover).not.toHaveBeenCalled()
      const near = await decide({ decision: "confirm", expectedChargedCredits: 901 })
      expect(near.statusCode).toBe(200)
      // What is kept is the total the admin named.
      expect(h.ledger[0]).toMatchObject({ state: "retry", decision: "confirmed", detail: { decidedForCredits: 901 } })
    })

    it("a total that cannot be computed right now decides nothing, and leaves the hold's figures as they were", async () => {
      h.ledger = [held(JOB)]
      wouldCharge(null)
      const res = await decide({ decision: "confirm", expectedChargedCredits: 900 })
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toMatchObject({ code: "total_changed", message: expect.stringContaining("cannot be computed") })
      expect(res.json().data.changed).toEqual({ jobId: JOB, expectedChargedCredits: 900, wouldCharge: null, totalAnomalous: true })
      expect(h.ledger[0]).toMatchObject({ state: "hold", decision: null, credits: 900, billed_usd: "1.8", updated_at: "2026-11-27T00:00:00Z" })
      expect(h.recover).not.toHaveBeenCalled()
      expect(h.audits).toEqual([])
    })
  })
})

describe("an unbilled settlement (the route never reported a bill)", () => {
  const JOB = "00000000-0000-4000-8000-0000000000c1"
  const unbilled = () => ({ id: 1, job_id: JOB, env: getRuntimeEnv(), kind: "settle", state: "unbilled", decision: null, credits: null, billed_usd: null, quoted_usd: null, note: "no bill in 48 h", created_at: "2026-11-25T00:00:00Z", updated_at: "2026-11-27T00:00:00Z" })

  it("is listed as such, beside the held bills", async () => {
    h.ledger = [unbilled()]
    const data = (await app.inject({ method: "GET", url: URL, headers: as })).json().data
    expect(data.holds).toEqual([{ jobId: JOB, kind: "unbilled", credits: null, billedUsd: null, quotedUsd: null, note: "no bill in 48 h", heldAt: "2026-11-25T00:00:00Z", wouldCharge: null, wouldLose: null, totalAnomalous: false }])
  })

  /** What settling the run at its quote would charge right now. */
  const atQuote = (credits: number | null, over: Record<string, unknown> = {}) => { h.previews[JOB] = { credits, billedUsd: 0.2, quotedUsd: 0.2, usedQuote: true, anomalous: false, routeId: "r1", ...over } }
  const decide = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: `${URL}/holds/${JOB}`, headers: as, payload })

  it.each([["quote", "quote", "settle_video_route_hold_at_quote"], ["reject", "rejected", "reject_video_route_hold"]] as const)(
    "%s: one audited decision, applied by the one settlement, once", async (decision, stored, action) => {
      h.ledger = [unbilled()]
      if (decision === "quote") atQuote(100)
      const payload = decision === "quote" ? { decision, expectedChargedCredits: 100 } : { decision }
      const res = await decide(payload)
      expect(res.statusCode).toBe(200)
      expect(h.ledger[0]).toMatchObject({ state: "retry", decision: stored, decided_by: ADMIN })
      // A settle-at-quote keeps that a quote was chosen and the total it was chosen for.
      if (decision === "quote") expect(h.ledger[0]!.detail).toEqual({ atQuote: true, decidedForCredits: 100 })
      expect(h.audits.at(-1)).toMatchObject({ action, target_id: JOB })
      expect(h.recover.mock.calls).toEqual([[JOB]])
      expect((await decide(payload)).statusCode).toBe(409)
      expect(h.recover).toHaveBeenCalledTimes(1)
    })

  it("a quote-settle whose total is far above the quote is not charged: it is reported as now held for its own confirmation", async () => {
    h.ledger = [unbilled()]
    atQuote(100)
    const { RoutedSettleHeld } = await import("../../billing/video-route-settlement.js")
    h.recover.mockRejectedValueOnce(new RoutedSettleHeld("job: its verified bill is 9x its quote"))
    const res = await decide({ decision: "quote", expectedChargedCredits: 100 })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.decided).toMatchObject({ decision: "quote", settled: false, heldForTotal: true, chargedCredits: null })
  })

  it("a bill that arrives before the click: settling at the quote that was shown decides nothing; the run stays unbilled with its new total", async () => {
    h.ledger = [unbilled()]
    atQuote(100)
    h.onResolve = () => atQuote(260, { billedUsd: 0.52, usedQuote: false })
    const res = await decide({ decision: "quote", expectedChargedCredits: 100 })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("total_changed")
    expect(res.json().data.changed).toEqual({ jobId: JOB, expectedChargedCredits: 100, wouldCharge: 260, totalAnomalous: false })
    expect(h.ledger[0]).toMatchObject({ state: "unbilled", decision: null, credits: 260, billed_usd: 0.52, quoted_usd: 0.2 })
    expect((h.ledger[0]!.detail as Record<string, unknown> | undefined)?.atQuote).toBeUndefined()
    expect(h.recover).not.toHaveBeenCalled()
    expect(h.audits).toEqual([])
  })

  it("each kind takes its own decision: no bill to confirm on an unbilled run, no quote settle on a held bill", async () => {
    h.ledger = [unbilled()]
    atQuote(100)
    const wrong = await decide({ decision: "confirm", expectedChargedCredits: 100 })
    expect(wrong.statusCode).toBe(409)
    expect(wrong.json().error.code).toBe("wrong_decision")
    h.ledger = [{ ...unbilled(), state: "hold", credits: 900 }]
    const quote = await decide({ decision: "quote", expectedChargedCredits: 100 })
    expect(quote.statusCode).toBe(409)
    expect(quote.json().error.code).toBe("wrong_decision")
    expect(h.ledger[0]).toMatchObject({ state: "hold", decision: null })
    // Refused for its kind before the route is read or a total compared.
    expect(h.resolves).toEqual([])
    expect(h.recover).not.toHaveBeenCalled()
  })
})

describe("what the route takes today with no setting saved", () => {
  const route = (legacyRouting?: () => unknown) => setPluginServices({
    alternateRoutes: {
      accepts: () => null, start: async () => ({ taskRef: "t" }), poll: async () => ({ state: "running" }),
      prices: () => [{ id: "seedance-2-5:8s:720p", usd: 0.2 }],
      ...(legacyRouting ? { legacyRouting: legacyRouting as never } : {}),
    },
  })
  const view = async () => (await app.inject({ method: "GET", url: URL, headers: as })).json().data

  it("keeps what it does not recognise apart, so the page can say it will move to the default route (never 'runs nothing')", async () => {
    route(() => [{ model: "seedance-2-5", service: "text-to-video" }, { model: "kling-3.0", service: "text-to-video" }, { model: "seedance-2-5", service: "made-up-lane" }])
    const data = await view()
    expect(data.legacyRouting).toEqual([{ model: "seedance-2-5", service: "text-to-video" }])
    expect(data.legacyRoutingUnrecognised).toEqual([{ model: "kling-3.0", service: "text-to-video" }, { model: "seedance-2-5", service: "made-up-lane" }])
    route(() => [{ model: "kling-3.0", service: "text-to-video" }])
    expect(await view()).toMatchObject({ legacyRouting: [], legacyRoutingUnrecognised: [{ model: "kling-3.0", service: "text-to-video" }] })
  })

  it("is null when the route does not say, or says it badly", async () => {
    expect((await view()).legacyRouting).toBeNull()
    route()
    expect((await view()).legacyRouting).toBeNull()
    route(() => { throw new Error("x") })
    expect((await view()).legacyRouting).toBeNull()
    route(() => "everything")
    expect((await view()).legacyRouting).toBeNull()
  })

  it("lists each routable model and known service once, dropping anything else", async () => {
    route(() => [
      { model: "seedance-2-5", service: "text-to-video" },
      { model: "seedance-2-5", service: "text-to-video" },
      { model: "kling-3.0", service: "text-to-video" },
      { model: "seedance-2-5", service: "made-up-lane" },
      { model: 7, service: "image-to-video" },
      null,
    ])
    expect((await view()).legacyRouting).toEqual([{ model: "seedance-2-5", service: "text-to-video" }])
    route(() => [])
    expect((await view()).legacyRouting).toEqual([])
  })
})

describe("operator routing alerts", () => {
  it("persists a repeated price increase once and exposes it only in the admin view", async () => {
    const { recordVideoRouteAlert } = await import("../../billing/video-route-alerts.js")
    await recordVideoRouteAlert({ key: "price:job-a", kind: "price-increase", message: "The routed price increased.", jobId: "job-a" })
    await recordVideoRouteAlert({ key: "price:job-a", kind: "price-increase", message: "The routed price increased again.", jobId: "job-a" })
    const allowed = await app.inject({ method: "GET", url: URL, headers: as })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json().data.alerts).toMatchObject([{ key: "price:job-a", kind: "price-increase", message: "The routed price increased again.", jobId: "job-a" }])
    expect(allowed.json().data.alerts).toHaveLength(1)
    h.admin = false
    const refused = await app.inject({ method: "GET", url: URL, headers: as })
    expect(refused.statusCode).toBe(403)
    expect(refused.body).not.toContain("The routed price")
  })
})
