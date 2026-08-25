import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

// SECURITY (SEC-3): the per-IP SSO rate-limit counter must always carry a TTL.
// The original code did `incr` then `expire` only on the first hit — if that
// `expire` threw (Redis blip), the key persisted with NO TTL and that IP hash
// was locked out forever. This suite drives a STATEFUL Redis whose `expire`
// ALWAYS throws, and proves the counter still expires (its TTL comes from an
// atomic SET ... EX ... NX at creation, not the fragile post-incr expire).

const store = vi.hoisted(() => ({
  map: new Map<string, { val: number; ttl: number }>(),
  expireThrows: false,
}))

vi.mock("../../lib/queue.js", () => ({
  redis: {
    // Emulates `SET key "1" EX <seconds> NX`: creates with a TTL only when absent.
    set: vi.fn(async (key: string, _val: string, _ex: string, seconds: number) => {
      if (store.map.has(key)) return null
      store.map.set(key, { val: 1, ttl: seconds })
      return "OK"
    }),
    incr: vi.fn(async (key: string) => {
      const e = store.map.get(key) ?? { val: 0, ttl: -1 } // bare incr creates with NO ttl
      e.val += 1
      store.map.set(key, e)
      return e.val
    }),
    ttl: vi.fn(async (key: string) => store.map.get(key)?.ttl ?? -2),
    expire: vi.fn(async (key: string, seconds: number) => {
      if (store.expireThrows) throw new Error("expire failed")
      const e = store.map.get(key)
      if (e) e.ttl = seconds
      return 1
    }),
  },
}))

// The no-assertion path 302s to initiateUrl before touching any of these, but
// their module imports must not have side effects — stub them out.
vi.mock("../../lib/supabase.js", () => ({ supabase: { auth: { admin: {} } } }))
vi.mock("../../lib/sso-replay.js", () => ({ claimAssertionJti: vi.fn(async () => true) }))
vi.mock("../../lib/sso-linking.js", () => ({ resolveSsoUser: vi.fn(async () => ({ ok: false })) }))

const providers = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock("../../lib/sso-providers.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/sso-providers.js")>()
  return {
    ...actual,
    getSsoProviders: () => providers.list as never,
    getSsoProvider: (id: string) => (providers.list as { id: string }[]).find((p) => p.id === id) as never,
  }
})

import { ssoRoutes } from "../sso.js"

const RATE_MAX = 20 // mirrors the constant in sso.ts

async function build() {
  const app = Fastify()
  await app.register(ssoRoutes)
  return app
}

beforeEach(() => {
  store.map.clear()
  store.expireThrows = false
  providers.list = [
    { id: "librechat", label: "LibreChat", kind: "assertion", secret: "x".repeat(32), audience: "nodaro",
      claimMap: { email: "email", emailVerified: "email_verified", subject: "sub" }, maxLifetimeSeconds: 300,
      initiateUrl: "https://idp.example/login" },
  ]
})

describe("SSO per-IP rate limit — TTL robustness", () => {
  it("still 429s after the limit AND leaves a positive TTL even when expire() always throws", async () => {
    store.expireThrows = true
    const app = await build()

    let last
    for (let i = 0; i < RATE_MAX + 5; i++) {
      last = await app.inject({ method: "GET", url: "/v1/sso/librechat" })
    }

    expect(last!.statusCode).toBe(429) // the limiter fires
    // The single counter key was created with a TTL, so a thrown expire can't
    // leave a TTL-less key that accumulates and locks the IP out forever.
    const keys = [...store.map.keys()]
    expect(keys.length).toBe(1)
    expect(store.map.get(keys[0])!.ttl).toBeGreaterThan(0)
  })

  it("under the limit returns the redirect and never leaves a TTL-less key", async () => {
    store.expireThrows = true
    const app = await build()

    const res = await app.inject({ method: "GET", url: "/v1/sso/librechat" })
    expect(res.statusCode).toBe(302)
    const keys = [...store.map.keys()]
    expect(store.map.get(keys[0])!.ttl).toBeGreaterThan(0)
  })
})
