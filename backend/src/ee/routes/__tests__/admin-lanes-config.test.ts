/**
 * Admin lane configuration: GET /v1/admin/lanes/config, the Cloud-only plan /
 * provider-ceiling / override / settings PUTs, and the `lanes_enforced` switch
 * (every edition with an admin), on an in-memory database and a real gate over
 * the JS twin of its scripts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { ConcurrencyGate } from "../../../lib/concurrency-lanes/gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"
import { makeFakeLaneDb, type FakeLaneDb } from "../../../lib/concurrency-lanes/__tests__/fake-lane-db.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const USER = "00000000-0000-4000-8000-0000000000aa"
const refs = vi.hoisted(() => ({ gate: null as unknown, db: null as unknown as { client: { from(t: string): unknown } }, credits: true }))

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => refs.credits,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) => {
    if (req.userId !== "00000000-0000-4000-8000-0000000000ad") return reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))
// Off a deployment-payer instance the operator gate is requireAdmin verbatim.
vi.mock("@/ee/middleware/require-platform-operator.js", () => ({
  requirePlatformOperator: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) => {
    if (req.userId !== "00000000-0000-4000-8000-0000000000ad") return reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))

const { config } = await import("@/lib/config.js")
const { adminLanesRoutes } = await import("../admin-lanes.js")
const { cloudLaneSizesFor, invalidateLaneConfigCache, resetLaneTierCacheForTests } = await import("../../concurrency-lanes/plan-sizes.js")
const { registerOffTransitionWaker, registerMeasureDaysReader, resetEnforcementHooksForTests, LANES_ENFORCED_KEY } = await import("@/lib/concurrency-lanes/enforcement.js")

let app: FastifyInstance
let db: FakeLaneDb
let gate: ConcurrencyGate

async function build(): Promise<void> {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    req.authKind = (req.headers["x-auth-kind"] as typeof req.authKind) ?? "jwt"
  })
  await app.register(adminLanesRoutes)
  await app.ready()
}

const call = (method: "GET" | "PUT", url: string, body?: unknown, user = ADMIN, authKind = "jwt") =>
  app.inject({ method, url, payload: body as Record<string, unknown> | undefined, headers: { "x-user-id": user, "x-auth-kind": authKind } })

/** Every precondition met except what a test changes. */
function allPreconditionsMet(): void {
  registerMeasureDaysReader(async () => 30)
}

beforeEach(async () => {
  db = makeFakeLaneDb()
  refs.db = db
  refs.credits = true
  db.rows("profiles").push({ id: ADMIN }, { id: USER, tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0 })
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store), now: () => 1_000 })
  refs.gate = gate
  vi.stubEnv("RUNTIME_ENV", "production")
  config.LANES_ENFORCED = false
  invalidateLaneConfigCache()
  resetLaneTierCacheForTests()
  resetEnforcementHooksForTests()
  await build()
})

afterEach(async () => {
  await app.close()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("access", () => {
  it("a non-admin gets 403 on the GET and on every PUT", async () => {
    expect((await call("GET", "/v1/admin/lanes/config", undefined, USER)).statusCode).toBe(403)
    for (const [url, body] of [
      ["/v1/admin/lanes/enforced", { on: false }],
      ["/v1/admin/lanes/plans/pro", { provider: 1, llm: 1, local: 1, run: 1 }],
      ["/v1/admin/lanes/providers/kie", { ceiling: 3 }],
      [`/v1/admin/lanes/users/${USER}`, { provider: 3 }],
      ["/v1/admin/lanes/settings", { queueTimeoutMinutes: 60, liveWaitMinutes: 5 }],
    ] as const) {
      expect((await call("PUT", url, body, USER)).statusCode, url).toBe(403)
    }
    expect(db.rows("lane_plan_sizes")).toEqual([])
  })

  it("an admin's API token may read the config", async () => {
    expect((await call("GET", "/v1/admin/lanes/config", undefined, ADMIN, "api_token")).statusCode).toBe(200)
  })
})

describe("GET /v1/admin/lanes/config", () => {
  it("on Cloud: every plan, the ceilings, the settings, the switch and its preconditions", async () => {
    db.rows("lane_plan_sizes").push({ tier: "pro", provider: 11, llm: 22, local: 22, run: 11 })
    db.rows("lane_provider_ceilings").push({ provider: "kie", ceiling: 40 })
    const res = await call("GET", "/v1/admin/lanes/config")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Object.keys(body.plans)).toEqual(["free", "payg", "basic", "standard", "pro", "business", "enterprise"])
    expect(body.plans.enterprise).toEqual(body.plans.business)
    expect(body.plans.pro).toEqual({ provider: 11, llm: 22, local: 22, run: 11 })
    expect(body.plans.free).toEqual({ provider: 2, llm: 4, local: 4, run: 2 })
    expect(body.providerCeilings).toEqual({ kie: 40 })
    expect(body.settings).toEqual({ queueTimeoutMinutes: 120, liveWaitMinutes: 10, liveWaitMaxMinutes: 60 })
    expect(body.enforced).toBe(false)
    expect(body.editable).toBe(true)
    expect(body.env).toBe("production")
    expect(body.envSizes).toBeNull()
    expect(body.preconditions).toEqual(expect.objectContaining({ columnsPresent: true, liveCeilingMeasured: false, measureDays: 0 }))
  })

  it("the config GET states that sizes, overrides, ceilings and timeouts are shared by every environment", async () => {
    expect((await call("GET", "/v1/admin/lanes/config")).json().sharedAcrossEnvironments).toBe(true)
  })
})

describe("PUT /v1/admin/lanes/plans/:tier", () => {
  it("refuses a size of 0 or 501, a missing lane and an unknown tier", async () => {
    for (const body of [
      { provider: 0, llm: 4, local: 4, run: 2 },
      { provider: 2, llm: 501, local: 4, run: 2 },
      { provider: 2, llm: 4, local: 4 },
      { provider: 2.5, llm: 4, local: 4, run: 2 },
    ]) {
      expect((await call("PUT", "/v1/admin/lanes/plans/free", body)).statusCode, JSON.stringify(body)).toBe(400)
    }
    expect((await call("PUT", "/v1/admin/lanes/plans/platinum", { provider: 2, llm: 4, local: 4, run: 2 })).statusCode).toBe(400)
    expect(db.rows("lane_plan_sizes")).toEqual([])
  })

  it("saves a plan and the next read sees it at once", async () => {
    await call("GET", "/v1/admin/lanes/config") // warm the cache
    const res = await call("PUT", "/v1/admin/lanes/plans/pro", { provider: 1, llm: 500, local: 3, run: 4 })
    expect(res.statusCode).toBe(200)
    expect((await call("GET", "/v1/admin/lanes/config")).json().plans.pro).toEqual({ provider: 1, llm: 500, local: 3, run: 4 })
  })

  it("the enterprise plan is editable like the others", async () => {
    const res = await call("PUT", "/v1/admin/lanes/plans/enterprise", { provider: 20, llm: 40, local: 40, run: 20 })
    expect(res.statusCode).toBe(200)
    expect((await call("GET", "/v1/admin/lanes/config")).json().plans.enterprise).toEqual({ provider: 20, llm: 40, local: 40, run: 20 })
  })
})

describe("PUT /v1/admin/lanes/users/:id", () => {
  it("override round-trip: set, read through the sizes, clear", async () => {
    const subject = { userId: USER, payer: `user:${USER}` as const, tier: null }
    expect(await cloudLaneSizesFor(subject)).toEqual({ provider: 10, llm: 20, local: 20, run: 10 })

    const set = await call("PUT", `/v1/admin/lanes/users/${USER}`, { provider: 3, run: 1, note: " support ticket " })
    expect(set.statusCode).toBe(200)
    expect(set.json()).toEqual({ userId: USER, override: { provider: 3, run: 1 }, note: "support ticket" })
    expect(db.rows("lane_user_overrides")).toEqual([expect.objectContaining({ user_id: USER, provider: 3, llm: null, local: null, run: 1, updated_by: ADMIN })])
    expect(await cloudLaneSizesFor(subject)).toEqual({ provider: 3, llm: 20, local: 20, run: 1 })

    // A full replacement: a lane left out follows the plan again.
    await call("PUT", `/v1/admin/lanes/users/${USER}`, { llm: 50 })
    expect(await cloudLaneSizesFor(subject)).toEqual({ provider: 10, llm: 50, local: 20, run: 10 })

    const cleared = await call("PUT", `/v1/admin/lanes/users/${USER}`, { provider: null, llm: null, local: null, run: null })
    expect(cleared.json()).toEqual({ userId: USER, override: null, note: null })
    expect(db.rows("lane_user_overrides")).toEqual([])
    expect(await cloudLaneSizesFor(subject)).toEqual({ provider: 10, llm: 20, local: 20, run: 10 })
  })

  it("400 for a bad id or size, 404 for an unknown account", async () => {
    expect((await call("PUT", "/v1/admin/lanes/users/not-a-uuid", { provider: 3 })).statusCode).toBe(400)
    expect((await call("PUT", `/v1/admin/lanes/users/${USER}`, { provider: 0 })).statusCode).toBe(400)
    expect((await call("PUT", `/v1/admin/lanes/users/${USER}`, { provider: 3, extra: 1 })).statusCode).toBe(400)
    const missing = await call("PUT", "/v1/admin/lanes/users/00000000-0000-4000-8000-0000000000ff", { provider: 3 })
    expect(missing.statusCode).toBe(404)
  })
})

describe("PUT /v1/admin/lanes/providers/:provider", () => {
  it("the mirror copies provider ceilings into the gate, and a ceiling PUT applies them at once (null deletes)", async () => {
    const spy = vi.spyOn(gate, "setProviderCeilings")
    db.rows("lane_provider_ceilings").push({ provider: "replicate", ceiling: 8 })
    await call("GET", "/v1/admin/lanes/config") // the cached table before the edit

    const res = await call("PUT", "/v1/admin/lanes/providers/kie", { ceiling: 40 })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ provider: "kie", ceiling: 40, applied: true })
    expect(spy).toHaveBeenLastCalledWith({ replicate: 8, kie: 40 })

    await call("PUT", "/v1/admin/lanes/providers/kie", { ceiling: null })
    expect(spy).toHaveBeenLastCalledWith({ replicate: 8 })
    expect(db.rows("lane_provider_ceilings")).toEqual([{ provider: "replicate", ceiling: 8 }])
  })

  it("refuses a ceiling of 0 or a bad provider id; a gate outage is reported, not a failure", async () => {
    expect((await call("PUT", "/v1/admin/lanes/providers/kie", { ceiling: 0 })).statusCode).toBe(400)
    expect((await call("PUT", "/v1/admin/lanes/providers/KIE%20X", { ceiling: 3 })).statusCode).toBe(400)
    vi.spyOn(gate, "setProviderCeilings").mockRejectedValueOnce(new Error("redis down"))
    const res = await call("PUT", "/v1/admin/lanes/providers/kie", { ceiling: 3 })
    expect(res.statusCode).toBe(200)
    expect(res.json().applied).toBe(false)
    expect(db.rows("lane_provider_ceilings")).toEqual([expect.objectContaining({ provider: "kie", ceiling: 3 })])
  })
})

describe("PUT /v1/admin/lanes/settings", () => {
  it("checks both ranges", async () => {
    for (const body of [
      { queueTimeoutMinutes: 4, liveWaitMinutes: 10 },
      { queueTimeoutMinutes: 1441, liveWaitMinutes: 10 },
      { queueTimeoutMinutes: 120, liveWaitMinutes: 0 },
      { queueTimeoutMinutes: 120, liveWaitMinutes: 61 },
      { queueTimeoutMinutes: 120 },
    ]) {
      expect((await call("PUT", "/v1/admin/lanes/settings", body)).statusCode, JSON.stringify(body)).toBe(400)
    }
  })

  it("saves both and the next read sees them", async () => {
    await call("GET", "/v1/admin/lanes/config")
    expect((await call("PUT", "/v1/admin/lanes/settings", { queueTimeoutMinutes: 1440, liveWaitMinutes: 60 })).statusCode).toBe(200)
    expect((await call("GET", "/v1/admin/lanes/config")).json().settings).toEqual({ queueTimeoutMinutes: 1440, liveWaitMinutes: 60, liveWaitMaxMinutes: 60 })
  })
})

describe("PUT /v1/admin/lanes/enforced", () => {
  it("turning enforcement on with unmet preconditions needs confirmation", async () => {
    const refused = await call("PUT", "/v1/admin/lanes/enforced", { on: true })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe("preconditions_unmet")
    expect(refused.json().preconditions).toEqual(expect.objectContaining({ liveCeilingMeasured: false, measureDays: 0 }))
    expect(refused.json().unmet).toEqual(expect.arrayContaining(["liveCeiling", "measureDays"]))
    expect(await gate.isEnforced()).toBe(false)
    expect(db.rows("app_settings")).toEqual([])

    allPreconditionsMet()
    const confirmed = await call("PUT", "/v1/admin/lanes/enforced", { on: true, confirmUnmet: true })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json()).toEqual({ enforced: true, env: "production", woke: 0, mirrored: true })
    expect(await gate.isEnforced()).toBe(true)
    expect((await call("GET", "/v1/admin/lanes/config")).json().enforced).toBe(true)
  })

  it("the enforced setting is keyed by runtime environment", async () => {
    db.rows("app_settings").push({ key: LANES_ENFORCED_KEY, value: { staging: true }, updated_at: "2026-10-30T09:00:00.000Z" })
    expect((await call("GET", "/v1/admin/lanes/config")).json().enforced).toBe(false)
    await call("PUT", "/v1/admin/lanes/enforced", { on: true, confirmUnmet: true })
    expect(db.rows("app_settings")[0]!.value).toEqual({ staging: true, production: true })
    vi.stubEnv("RUNTIME_ENV", "staging")
    await call("PUT", "/v1/admin/lanes/enforced", { on: false })
    expect(db.rows("app_settings")[0]!.value).toEqual({ staging: false, production: true })
  })

  it("turning off needs no preconditions and wakes every waiter", async () => {
    await call("PUT", "/v1/admin/lanes/enforced", { on: true, confirmUnmet: true })
    registerOffTransitionWaker(async () => 4)
    const res = await call("PUT", "/v1/admin/lanes/enforced", { on: false })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ enforced: false, env: "production", woke: 4, mirrored: true })
    expect(await gate.isEnforced()).toBe(false)
  })

  it("refuses a body without a boolean", async () => {
    expect((await call("PUT", "/v1/admin/lanes/enforced", { on: "yes" })).statusCode).toBe(400)
  })
})

describe("Business (admin, no credits)", () => {
  beforeEach(async () => {
    await app.close()
    refs.credits = false
    await build()
  })

  it("Business → plan PUT 404, GET editable:false, enforced PUT allowed", async () => {
    for (const [url, body] of [
      ["/v1/admin/lanes/plans/pro", { provider: 1, llm: 1, local: 1, run: 1 }],
      ["/v1/admin/lanes/providers/kie", { ceiling: 3 }],
      [`/v1/admin/lanes/users/${USER}`, { provider: 3 }],
      ["/v1/admin/lanes/settings", { queueTimeoutMinutes: 60, liveWaitMinutes: 5 }],
    ] as const) {
      expect((await call("PUT", url, body)).statusCode, url).toBe(404)
    }
    const got = (await call("GET", "/v1/admin/lanes/config")).json()
    expect(got.editable).toBe(false)
    expect(got.plans).toEqual({})
    expect(got.envSizes).toEqual({ provider: 12, llm: 24, local: 24, run: 12 })
    expect(got.providerCeilings).toEqual({})

    allPreconditionsMet()
    const on = await call("PUT", "/v1/admin/lanes/enforced", { on: true, confirmUnmet: true })
    expect(on.statusCode).toBe(200)
    expect(await gate.isEnforced()).toBe(true)
  })
})
