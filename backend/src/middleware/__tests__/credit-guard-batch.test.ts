/**
 * A request that creates SEVERAL jobs (generate-image `count` / `models`).
 *
 * 1. The surface deny reads every model a request names in `models`, beside
 *    `provider` — a fan-out cannot run a model the deployment denies.
 * 2. `batchIdentifiers` makes the pre-flight check the WHOLE batch: the sum of
 *    every job's charged price (each marked up at its own identifier, by the
 *    same lookup its reservation prices from), and each distinct model's
 *    availability — before anything is created. The 402 names the total.
 * 3. The batch total is never left as a `creditOverride`: each job reserves its
 *    own price (otherwise every one of N jobs would reserve the whole batch).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const {
  mockFrom,
  mockCheckCreditsWithProfile,
  mockCheckStorageLimitWithProfile,
  mockGetModelCreditCostFromDB,
  mockGetAppSettings,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockCheckCreditsWithProfile: vi.fn(),
  mockCheckStorageLimitWithProfile: vi.fn(),
  mockGetModelCreditCostFromDB: vi.fn(),
  mockGetAppSettings: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mockFrom, auth: { getUser: vi.fn() } } }))
vi.mock("@/ee/billing/credits.js", () => ({
  PriceNotConfiguredError: class extends Error {},
  getModelCreditCostFromDB: mockGetModelCreditCostFromDB,
  CreditsService: {
    checkCreditsWithProfile: mockCheckCreditsWithProfile,
    checkStorageLimitWithProfile: mockCheckStorageLimitWithProfile,
    reserveCredits: vi.fn(),
  },
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))
vi.mock("@/lib/surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/surface-deny.js")>()),
  isModelDenied: (id: string) => id === "flux-2-pro",
}))

import { creditGuard } from "../credit-guard.js"

const PROFILE = {
  role: "user", tier: "standard", subscription_tier: "standard", subscription_credits: 1000, topup_credits: 0,
  daily_spent_credits: 0, last_daily_reset: null, storage_used_bytes: 0, storage_limit_bytes: 1e10,
}

/** The charged price of each identifier in these tests (post-markup, as `getModelCreditCostFromDB` answers). */
const PRICES: Record<string, number> = { "gpt-image-2": 60, "flux-2-max:2MP:0ref": 90, "nano-banana-2-1": 40 }

async function buildApp(batchIds: (req: FastifyRequest) => readonly string[] | undefined): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  const guard = creditGuard(() => "gpt-image-2", { batchIdentifiers: batchIds })
  app.post("/v1/test-route", { preHandler: guard }, async (req) => ({ creditReservation: req.creditReservation ?? null }))
  await app.ready()
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckStorageLimitWithProfile.mockReturnValue({ allowed: true, usedBytes: 0, limitBytes: 1e10 })
  mockCheckCreditsWithProfile.mockResolvedValue({ allowed: true, watermark: false })
  mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
  mockGetModelCreditCostFromDB.mockImplementation(async (id: string) => ({ creditCost: PRICES[id] ?? 1, isEnabled: true }))
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: PROFILE, error: null }) }) }),
  })
})

describe("surface deny — every model a request names in `models`", () => {
  it("refuses a denied model in `models` before any credit check", async () => {
    const app = await buildApp(() => undefined)
    const res = await app.inject({ method: "POST", url: "/v1/test-route", payload: { userId: "u1", models: ["gpt-image-2", "flux-2-pro"] } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
    expect(res.json().error.message).toContain("flux-2-pro")
    expect(mockCheckCreditsWithProfile).not.toHaveBeenCalled()
    await app.close()
  })

  it("lets a fan-out of models the deployment offers through", async () => {
    const app = await buildApp(() => undefined)
    const res = await app.inject({ method: "POST", url: "/v1/test-route", payload: { userId: "u1", models: ["gpt-image-2", "nano-banana-2-1"] } })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it("ignores a `models` value that is not a list of strings (the route's own validation answers it)", async () => {
    const app = await buildApp(() => undefined)
    const res = await app.inject({ method: "POST", url: "/v1/test-route", payload: { userId: "u1", models: "flux-2-pro" } })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})

describe("batchIdentifiers — the pre-flight checks the whole batch", () => {
  it("checks the balance against the SUM of every job's charged price", async () => {
    const app = await buildApp(() => ["gpt-image-2", "gpt-image-2", "flux-2-max:2MP:0ref"])
    await app.inject({ method: "POST", url: "/v1/test-route", payload: { userId: "u1" } })
    // 60 + 60 + 90, each priced by the lookup its reservation will use.
    expect(mockGetModelCreditCostFromDB).toHaveBeenCalledWith("gpt-image-2")
    expect(mockGetModelCreditCostFromDB).toHaveBeenCalledWith("flux-2-max:2MP:0ref")
    const overrides = mockCheckCreditsWithProfile.mock.calls.map((c) => c[4])
    expect(overrides.every((o) => o === 210)).toBe(true)
    await app.close()
  })

  it("asks once per DISTINCT model, so each model's own availability is checked", async () => {
    const app = await buildApp(() => ["gpt-image-2", "gpt-image-2", "flux-2-max:2MP:0ref"])
    await app.inject({ method: "POST", url: "/v1/test-route", payload: { userId: "u1" } })
    expect(mockCheckCreditsWithProfile.mock.calls.map((c) => c[2])).toEqual(["gpt-image-2", "flux-2-max:2MP:0ref"])
    await app.close()
  })

  it("answers 402 with the batch total when the balance cannot cover it, and stops asking", async () => {
    mockCheckCreditsWithProfile.mockResolvedValueOnce({ allowed: false, error: "Insufficient credits. Required: 210, Available: 100", required: 210, balance: 100 })
    const app = await buildApp(() => ["gpt-image-2", "gpt-image-2", "flux-2-max:2MP:0ref"])
    const res = await app.inject({ method: "POST", url: "/v1/test-route", payload: { userId: "u1" } })
    expect(res.statusCode).toBe(402)
    expect(res.json()).toMatchObject({ error: { code: "insufficient_credits" }, required: 210, balance: 100 })
    expect(mockCheckCreditsWithProfile).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it("refuses when a LATER model is not available to this account", async () => {
    mockCheckCreditsWithProfile
      .mockResolvedValueOnce({ allowed: true, watermark: false })
      .mockResolvedValueOnce({ allowed: false, error: "This model is not available on your plan" })
    const app = await buildApp(() => ["gpt-image-2", "flux-2-max:2MP:0ref"])
    const res = await app.inject({ method: "POST", url: "/v1/test-route", payload: { userId: "u1" } })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.message).toBe("This model is not available on your plan")
    await app.close()
  })

  it("leaves NO creditOverride behind: each job then reserves its own price", async () => {
    const app = await buildApp(() => ["gpt-image-2", "flux-2-max:2MP:0ref"])
    const res = await app.inject({ method: "POST", url: "/v1/test-route", payload: { userId: "u1" } })
    expect(res.statusCode).toBe(200)
    const reservation = res.json().creditReservation as Record<string, unknown>
    expect(reservation).not.toBeNull()
    expect(reservation.creditOverride).toBeUndefined()
    await app.close()
  })

  it("an EMPTY list is a batch with nothing left to pay for (a repeat that only re-queues): checked at 0, never at one image", async () => {
    const app = await buildApp(() => [])
    const res = await app.inject({ method: "POST", url: "/v1/test-route", payload: { userId: "u1" } })
    expect(res.statusCode).toBe(200)
    expect(mockGetModelCreditCostFromDB).not.toHaveBeenCalled()
    expect(mockCheckCreditsWithProfile).toHaveBeenCalledTimes(1)
    expect(mockCheckCreditsWithProfile.mock.calls[0][4]).toBe(0)
    expect((res.json().creditReservation as Record<string, unknown>).creditOverride).toBeUndefined()
    await app.close()
  })

  it("a single-job request (undefined) keeps the per-model check, unchanged", async () => {
    const app = await buildApp(() => undefined)
    await app.inject({ method: "POST", url: "/v1/test-route", payload: { userId: "u1" } })
    expect(mockGetModelCreditCostFromDB).not.toHaveBeenCalled()
    expect(mockCheckCreditsWithProfile).toHaveBeenCalledTimes(1)
    expect(mockCheckCreditsWithProfile.mock.calls[0][2]).toBe("gpt-image-2")
    expect(mockCheckCreditsWithProfile.mock.calls[0][4]).toBeUndefined()
    await app.close()
  })
})
