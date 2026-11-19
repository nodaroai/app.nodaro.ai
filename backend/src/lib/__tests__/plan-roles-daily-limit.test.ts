import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import rateLimit from "@fastify/rate-limit"

/**
 * The limits on Video Remake's role planning (`POST /v1/video-remake/plan-roles`,
 * also `/v1/cast-swap/plan-roles`), a free route the engine serves.
 *
 * What must hold:
 *  - an account plans at most 60 times in 24 hours, ONE counter for both
 *    spellings of the route; the 61st is a 429 `rate_limit_exceeded` with
 *    `Retry-After`, and the engine's handler never runs;
 *  - another account, and every other route, is untouched; a request with no
 *    account is left to the route, uncounted;
 *  - nothing happens where the engine serves no such route (the hook matches
 *    the route the router picked, and none is there);
 *  - Redis down: the call goes through (the per-minute limit still holds);
 *  - the engine's own per-minute limit, declared on its route as a rate-limit
 *    config counted in a preHandler and keyed by account, is honoured by this
 *    host's rate limiter as the app registers it.
 */
const store = vi.hoisted(() => ({ counts: new Map<string, number>(), ttls: new Map<string, number>(), down: false }))

vi.mock("../queue.js", () => ({
  redis: {
    incr: async (key: string) => {
      if (store.down) throw new Error("redis down")
      const next = (store.counts.get(key) ?? 0) + 1
      store.counts.set(key, next)
      return next
    },
    expire: async (key: string, seconds: number) => void store.ttls.set(key, seconds),
    ttl: async (key: string) => store.ttls.get(key) ?? -1,
  },
}))

const { PLAN_ROLES_DAILY_MAX, PLAN_ROLES_ROUTES, registerPlanRolesDailyLimit } = await import("../plan-roles-daily-limit.js")
const { PLUGIN_CREDIT_GUARDED_ROUTES } = await import("../route-node-gate.js")

const REMAKE = "/v1/video-remake/plan-roles"
const CAST = "/v1/cast-swap/plan-roles"

/** The engine route's own limit, in the shape the engine declares it. */
const ENGINE_LIMIT = {
  rateLimit: {
    max: 6,
    timeWindow: "1m",
    hook: "preHandler" as const,
    keyGenerator: (req: FastifyRequest): string => (req.userId ? `plan-roles:${req.userId}` : `plan-roles:ip:${req.ip ?? "unknown"}`),
  },
}

let handled: string[]
const spellings: number[] = []

/** An app wired as the real one is: the rate limiter (opt-in per route), the auth hook, the daily allowance, then the engine's routes in a plugin of their own. */
async function build(opts: { engineRoutes?: boolean; engineLimit?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) => ({ statusCode: 429, error: { code: "rate_limit_exceeded", message: `Too many requests. Retry in ${Math.ceil(context.ttl / 1000)}s.` } }),
  })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  registerPlanRolesDailyLimit(app)
  app.post("/v1/video-remake/estimate", async () => ({ ok: true }))
  if (opts.engineRoutes !== false) {
    await app.register(async (engine) => {
      for (const url of [CAST, REMAKE]) {
        engine.post(url, opts.engineLimit ? { config: ENGINE_LIMIT } : {}, async (req, reply) => {
          if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
          handled.push(`${req.userId} ${url}`)
          return { roles: [] }
        })
      }
    })
  }
  await app.ready()
  return app
}

const post = (app: FastifyInstance, url: string, user?: string) => app.inject({ method: "POST", url, headers: user ? { "x-user": user } : {}, payload: {} })

beforeEach(() => {
  store.counts = new Map()
  store.ttls = new Map()
  store.down = false
  handled = []
})

describe("the daily allowance of role planning", () => {
  it("is 60 a day, and covers the route under both prefixes, each of which the engine's guarded routes list", () => {
    expect(PLAN_ROLES_DAILY_MAX).toBe(60)
    expect([...PLAN_ROLES_ROUTES].sort()).toEqual([CAST, REMAKE])
    for (const url of PLAN_ROLES_ROUTES) expect(PLUGIN_CREDIT_GUARDED_ROUTES, url).toContain(url)
  })

  it("lets an account plan 60 times across both spellings, then refuses with 429 and Retry-After, before the engine runs", async () => {
    const app = await build()
    for (let i = 0; i < PLAN_ROLES_DAILY_MAX; i++) {
      const res = await post(app, i % 2 === 0 ? REMAKE : CAST, "user-a")
      expect(res.statusCode, `call ${i + 1}`).toBe(200)
    }
    expect(handled).toHaveLength(PLAN_ROLES_DAILY_MAX)
    for (const url of [REMAKE, CAST]) {
      const res = await post(app, url, "user-a")
      expect(res.statusCode).toBe(429)
      expect(res.json().error.code).toBe("rate_limit_exceeded")
      expect(res.json().error.message).toContain("60 times a day")
      expect(res.headers["retry-after"]).toBe(String(24 * 60 * 60))
    }
    expect(handled).toHaveLength(PLAN_ROLES_DAILY_MAX)
    // One counter, a day long.
    expect([...store.counts.keys()]).toEqual(["rl:plan-roles-day:user-a"])
    expect(store.ttls.get("rl:plan-roles-day:user-a")).toBe(24 * 60 * 60)
    await app.close()
  })

  it("counts each account alone, and nothing else of Video Remake", async () => {
    const app = await build()
    for (let i = 0; i < PLAN_ROLES_DAILY_MAX + 1; i++) await post(app, REMAKE, "user-a")
    expect((await post(app, REMAKE, "user-a")).statusCode).toBe(429)
    expect((await post(app, REMAKE, "user-b")).statusCode).toBe(200)
    expect((await post(app, "/v1/video-remake/estimate", "user-a")).statusCode).toBe(200)
    expect([...store.counts.keys()].sort()).toEqual(["rl:plan-roles-day:user-a", "rl:plan-roles-day:user-b"])
    await app.close()
  })

  it("leaves a request with no account to the route, uncounted", async () => {
    const app = await build()
    expect((await post(app, REMAKE)).statusCode).toBe(401)
    expect(store.counts.size).toBe(0)
    await app.close()
  })

  it("does nothing where the engine serves no such route: a 404 as before, nothing counted", async () => {
    const app = await build({ engineRoutes: false })
    for (const url of [REMAKE, CAST]) expect((await post(app, url, "user-a")).statusCode).toBe(404)
    expect((await app.inject({ method: "GET", url: REMAKE, headers: { "x-user": "user-a" } })).statusCode).toBe(404)
    expect(store.counts.size).toBe(0)
    await app.close()
  })

  it("lets the call through while Redis is down", async () => {
    const app = await build()
    store.down = true
    expect((await post(app, REMAKE, "user-a")).statusCode).toBe(200)
    await app.close()
  })
})

describe("the engine's per-minute limit on its route", () => {
  it("is honoured on this host: the 7th call in a minute is a 429, per account", async () => {
    const app = await build({ engineLimit: true })
    for (let i = 0; i < 6; i++) expect((await post(app, REMAKE, "user-a")).statusCode, `call ${i + 1}`).toBe(200)
    const refused = await post(app, REMAKE, "user-a")
    expect(refused.statusCode).toBe(429)
    expect(refused.json().error.code).toBe("rate_limit_exceeded")
    // Keyed by the account the auth hook set (counted in a preHandler), so another account has its own bucket.
    expect((await post(app, REMAKE, "user-b")).statusCode).toBe(200)
    expect(handled.filter((h) => h.startsWith("user-a"))).toHaveLength(6)
    // The day's allowance is counted first: the call the minute's limit refused is one of the day's.
    expect(store.counts.get("rl:plan-roles-day:user-a")).toBe(7)
    // What the other spelling answers the same account now is recorded as it is.
    spellings.push((await post(app, CAST, "user-a")).statusCode)
    await app.close()
  })
})

describe("the two spellings and the engine's per-minute limit", () => {
  it("each spelling of the route keeps a minute's count of its own on this host (the day's allowance is the one count they share)", () => {
    // Recorded by the test above: after 6 calls and a refusal on one spelling, the other still answers.
    expect(spellings).toEqual([200])
  })
})
