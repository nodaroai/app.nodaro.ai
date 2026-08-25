import { describe, it, expect, afterEach } from "vitest"
import Fastify from "fastify"
import { billingSurfaceRoutes } from "../billing-surface.js"
import { setBillingProvider, clearBillingProvider, type BillingProvider } from "../../lib/billing-provider.js"

afterEach(() => clearBillingProvider())

function build(userId?: string) {
  const app = Fastify()
  app.addHook("onRequest", async (req) => { (req as { userId?: string }).userId = userId })
  app.register(billingSurfaceRoutes)
  return app
}

describe("GET /v1/billing/surface", () => {
  it("returns the none surface by default (public, no auth)", async () => {
    const app = build()
    const res = await app.inject({ method: "GET", url: "/v1/billing/surface" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.providerId).toBe("none")
    expect(res.json().data.mountCostTab).toBe(false)
  })
})

describe("GET /v1/billing/account", () => {
  it("401 without a user", async () => {
    const app = build()
    const res = await app.inject({ method: "GET", url: "/v1/billing/account" })
    expect(res.statusCode).toBe(401)
  })
  it("returns the provider account summary for the authed user", async () => {
    const p: BillingProvider = {
      id: "nodaro-cloud", displayUnit: "credits",
      async report() { return new Map() },
      async account() { return { plan: "pro", balance: 42, dailyAllowance: null, unit: "credits" } },
    }
    setBillingProvider(p)
    const app = build("u1")
    const res = await app.inject({ method: "GET", url: "/v1/billing/account" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ plan: "pro", balance: 42, dailyAllowance: null, unit: "credits" })
  })
  it("returns data:null when the authority is unavailable (never a fake zero)", async () => {
    const app = build("u1") // default none provider → account() returns null
    const res = await app.inject({ method: "GET", url: "/v1/billing/account" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toBeNull()
  })
})
