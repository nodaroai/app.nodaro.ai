/**
 * Hosted deployments status — what these pin: only READ-ONLY billing keys are
 * ever used (a full key is refused at parse time and never called), only https
 * origins are called, the key never appears in the answer, a deployment that
 * fails is reported per row without taking the others down, and the route is
 * admin-only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  config: { HOSTED_DEPLOYMENTS: undefined as string | undefined },
  isAdmin: true,
}))

vi.mock("../../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config.js")>()
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get: (t, k) => (k === "HOSTED_DEPLOYMENTS" ? h.config.HOSTED_DEPLOYMENTS : t[k as keyof typeof t]),
    }),
  }
})
vi.mock("../../../lib/admin-check.js", () => ({ checkIsAdmin: vi.fn(async () => h.isAdmin) }))

const { parseHostedDeployments, adminHostedDeploymentsRoutes, __resetHostedDeploymentsCacheForTests } = await import(
  "../admin-hosted-deployments.js"
)

const RO_KEY = `ndr_bill_ro_${"a".repeat(64)}`
const FULL_KEY = `ndr_bill_${"b".repeat(64)}`
const BALANCE = {
  balanceCredits: 41_250,
  burn: { periodStart: "2026-10-01T00:00:00.000Z", credits: 900, generations: 2, capped: false },
  periodEnd: null,
  lowBalance: false,
  threshold: null,
  autoRecharge: { enabled: true, active: true, thresholdCredits: 5000, amountUsd: 50, failureCount: 0, lastAttemptAt: null },
}

describe("parseHostedDeployments", () => {
  it("unset or empty → none", () => {
    expect(parseHostedDeployments(undefined)).toEqual({ deployments: [], invalid: [] })
    expect(parseHostedDeployments("  ")).toEqual({ deployments: [], invalid: [] })
  })

  it("malformed JSON or a non-array → none, never a crash", () => {
    expect(parseHostedDeployments("{nope").deployments).toEqual([])
    expect(parseHostedDeployments('{"name":"x"}').deployments).toEqual([])
  })

  it("accepts a read-only key on an https origin, normalised to the bare origin", () => {
    const r = parseHostedDeployments(JSON.stringify([{ name: "Acme", url: "https://acme.example.com/some/path", key: RO_KEY }]))
    expect(r.deployments).toEqual([{ name: "Acme", origin: "https://acme.example.com", key: RO_KEY }])
    expect(r.invalid).toEqual([])
  })

  it("REFUSES a full billing key — this environment never holds write power over a customer", () => {
    const r = parseHostedDeployments(JSON.stringify([{ name: "Acme", url: "https://acme.example.com", key: FULL_KEY }]))
    expect(r.deployments).toEqual([])
    expect(r.invalid).toEqual([{ index: 0, name: "Acme", reason: "key_not_read_only" }])
  })

  it("refuses a plain-http origin and a malformed entry, keeping the good ones", () => {
    const r = parseHostedDeployments(
      JSON.stringify([
        { name: "Plain", url: "http://plain.example.com", key: RO_KEY },
        { name: "", url: "nope" },
        { name: "Good", url: "https://good.example.com", key: RO_KEY },
      ]),
    )
    expect(r.deployments.map((d) => d.name)).toEqual(["Good"])
    expect(r.invalid).toEqual([
      { index: 0, name: "Plain", reason: "url_not_https" },
      { index: 1, name: "", reason: "invalid_entry" },
    ])
  })
})

describe("GET /v1/admin/hosted-deployments", () => {
  let app: FastifyInstance
  const fetchMock = vi.fn()

  beforeEach(async () => {
    __resetHostedDeploymentsCacheForTests()
    h.isAdmin = true
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      req.userId = "admin-1"
    })
    await app.register(adminHostedDeploymentsRoutes)
    await app.ready()
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await app.close()
  })

  it("reads each deployment's balance route with its read-only key, and never echoes the key", async () => {
    h.config.HOSTED_DEPLOYMENTS = JSON.stringify([
      { name: "Acme", url: "https://acme.example.com", key: RO_KEY },
      { name: "Full", url: "https://full.example.com", key: FULL_KEY },
    ])
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: BALANCE }), { status: 200 }))

    const res = await app.inject({ method: "GET", url: "/v1/admin/hosted-deployments" })
    expect(res.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://acme.example.com/v1/deployment-billing/balance")
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(`Bearer ${RO_KEY}`)

    const body = res.json()
    expect(body.data).toEqual([{ name: "Acme", host: "acme.example.com", ok: true, balance: BALANCE }])
    expect(body.invalid).toEqual([{ index: 1, name: "Full", reason: "key_not_read_only" }])
    expect(res.payload).not.toContain(RO_KEY)
    expect(res.payload).not.toContain(FULL_KEY)
  })

  it("a deployment that refuses or is unreachable is one failed row, not a failed page", async () => {
    h.config.HOSTED_DEPLOYMENTS = JSON.stringify([
      { name: "Refuses", url: "https://refuses.example.com", key: RO_KEY },
      { name: "Down", url: "https://down.example.com", key: RO_KEY },
    ])
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
    const res = await app.inject({ method: "GET", url: "/v1/admin/hosted-deployments" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([
      { name: "Refuses", host: "refuses.example.com", ok: false, status: 401, error: "rejected" },
      { name: "Down", host: "down.example.com", ok: false, error: "unreachable" },
    ])
  })

  it("caches for a minute; ?refresh=1 bypasses it", async () => {
    h.config.HOSTED_DEPLOYMENTS = JSON.stringify([{ name: "Acme", url: "https://acme.example.com", key: RO_KEY }])
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: BALANCE }), { status: 200 }))
    await app.inject({ method: "GET", url: "/v1/admin/hosted-deployments" })
    await app.inject({ method: "GET", url: "/v1/admin/hosted-deployments" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await app.inject({ method: "GET", url: "/v1/admin/hosted-deployments?refresh=1" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("is admin-only", async () => {
    h.isAdmin = false
    h.config.HOSTED_DEPLOYMENTS = JSON.stringify([{ name: "Acme", url: "https://acme.example.com", key: RO_KEY }])
    const res = await app.inject({ method: "GET", url: "/v1/admin/hosted-deployments" })
    expect(res.statusCode).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
