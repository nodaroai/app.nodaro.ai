import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/api-auth-mode.js", () => ({ rejectProgrammaticAuth: vi.fn(() => false) }))
vi.mock("@/ee/lib/consent-config.js", () => ({ getConsentConfig: vi.fn() }))
vi.mock("@/ee/lib/consent-loops-sync.js", () => ({ syncConsentRow: vi.fn().mockResolvedValue(undefined) }))

import { consentRoutes } from "../consent.js"
import { supabase } from "../../../lib/supabase.js"
import { rejectProgrammaticAuth } from "../../../lib/api-auth-mode.js"
import { getConsentConfig } from "../../lib/consent-config.js"
import { syncConsentRow } from "../../lib/consent-loops-sync.js"

const ENABLED = {
  enabled: true,
  cadenceHours: 24,
  maxAsks: 5,
  withdrawnCadenceHours: 720,
  loginDefinition: "session" as const,
  text: "Please?",
  version: 3,
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(rejectProgrammaticAuth).mockReturnValue(false)
  vi.mocked(getConsentConfig).mockResolvedValue(ENABLED)
  vi.mocked(syncConsentRow).mockResolvedValue(undefined)

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const q = req.query as Record<string, string | undefined>
    const b = req.body as Record<string, unknown> | undefined
    const userId = q?.userId ?? (b?.userId as string | undefined)
    if (userId) req.userId = userId
  })
  await app.register(async (i) => {
    await consentRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function mockUpsertOk() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  vi.mocked(supabase.from).mockReturnValue({ upsert } as never)
  return upsert
}

function mockStatusRow(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const eq2 = vi.fn().mockReturnValue({ maybeSingle })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
}

describe("GET /v1/consent/status (read-only, no show stamped)", () => {
  it("401 without a user", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/consent/status" })
    expect(res.statusCode).toBe(401)
  })

  it("returns granted + subscribed", async () => {
    mockStatusRow({ status: "granted" })
    const res = await app.inject({ method: "GET", url: "/v1/consent/status?userId=u1" })
    expect(res.json()).toEqual({ status: "granted", subscribed: true })
  })

  it("returns pending + not subscribed when no row exists", async () => {
    mockStatusRow(null)
    const res = await app.inject({ method: "GET", url: "/v1/consent/status?userId=u1" })
    expect(res.json()).toEqual({ status: "pending", subscribed: false })
  })

  it("degrades to unknown on a read error (table missing)", async () => {
    mockStatusRow(null, { message: "relation does not exist" })
    const res = await app.inject({ method: "GET", url: "/v1/consent/status?userId=u1" })
    expect(res.json()).toEqual({ status: "unknown", subscribed: false })
  })
})

describe("GET /v1/consent/state", () => {
  it("401 without a user", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/consent/state" })
    expect(res.statusCode).toBe(401)
  })

  it("shouldShow:false and no RPC when the feature is disabled", async () => {
    vi.mocked(getConsentConfig).mockResolvedValue({ ...ENABLED, enabled: false })
    const res = await app.inject({ method: "GET", url: "/v1/consent/state?userId=u1" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ shouldShow: false, status: "disabled" })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("shouldShow:true with text+version when the RPC stamps a show", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [{ did_show: true, status: "pending" }], error: null } as never)
    const res = await app.inject({ method: "GET", url: "/v1/consent/state?userId=u1" })
    expect(res.json()).toMatchObject({ shouldShow: true, status: "pending", text: "Please?", version: 3 })
  })

  it("shouldShow:false (no text) when the RPC declines to show", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [{ did_show: false, status: "granted" }], error: null } as never)
    const res = await app.inject({ method: "GET", url: "/v1/consent/state?userId=u1" })
    expect(res.json()).toMatchObject({ shouldShow: false, status: "granted" })
    expect(res.json().text).toBeUndefined()
  })

  it("degrades to shouldShow:false when the RPC is unavailable (pre-migration)", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: "function does not exist" } } as never)
    const res = await app.inject({ method: "GET", url: "/v1/consent/state?userId=u1" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ shouldShow: false, status: "unavailable" })
  })

  it("403 for a programmatic (non-browser) caller", async () => {
    vi.mocked(rejectProgrammaticAuth).mockImplementation((_req, reply) => {
      reply.status(403).send({ error: { code: "forbidden", message: "no" } })
      return true
    })
    const res = await app.inject({ method: "GET", url: "/v1/consent/state?userId=u1" })
    expect(res.statusCode).toBe(403)
  })
})

describe("POST grant / decline / withdraw", () => {
  it("grant records granted, clears prior opt-out marks, fires the Loops sync", async () => {
    const upsert = mockUpsertOk()
    const res = await app.inject({ method: "POST", url: "/v1/consent/grant", payload: { userId: "u1", sourceApp: "studio" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: "granted" })
    expect(upsert.mock.calls[0][0]).toMatchObject({
      status: "granted",
      source_app: "studio",
      loops_dirty: true,
      consent_version: 3,
      declined_at: null,
      withdrawn_at: null,
    })
    expect(syncConsentRow).toHaveBeenCalledWith("u1")
  })

  it("grant rejects a malformed sourceApp slug", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/consent/grant", payload: { userId: "u1", sourceApp: "Not A Slug!" } })
    expect(res.statusCode).toBe(400)
  })

  it("decline records the terminal 'declined' state", async () => {
    const upsert = mockUpsertOk()
    const res = await app.inject({ method: "POST", url: "/v1/consent/decline", payload: { userId: "u1" } })
    expect(res.json()).toEqual({ status: "declined" })
    expect(upsert.mock.calls[0][0]).toMatchObject({ status: "declined", loops_dirty: true, declined_at: expect.any(String) })
  })

  it("withdraw records the 'withdrawn' state", async () => {
    const upsert = mockUpsertOk()
    const res = await app.inject({ method: "POST", url: "/v1/consent/withdraw", payload: { userId: "u1" } })
    expect(res.json()).toEqual({ status: "withdrawn" })
    expect(upsert.mock.calls[0][0]).toMatchObject({ status: "withdrawn", withdrawn_at: expect.any(String) })
  })
})
