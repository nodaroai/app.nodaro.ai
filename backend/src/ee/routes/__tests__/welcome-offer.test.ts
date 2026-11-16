import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * POST /v1/credits/welcome-offer/claim and /seen — the two writes behind the
 * welcome popup and banner. Consent recording and the grant claim are
 * doubled: what is pinned here is the CONTRACT between them (consent first,
 * claim only for an undecided account, always with the consent gate on) and
 * the route's own rules (browser session only, dormant while the flag is off,
 * the balance cache always invalidated so the state the apps poll is fresh).
 */

const { mockFrom, mockConfig, mockRecordConsent, mockSync, mockReadFreeGrant, mockRunClaim, mockGrantedFigure, mockInvalidate, mockReject, mockShown, mockLater } =
  vi.hoisted(() => ({
    mockFrom: vi.fn(),
    mockConfig: vi.fn(),
    mockRecordConsent: vi.fn(),
    mockSync: vi.fn(),
    mockReadFreeGrant: vi.fn(),
    mockRunClaim: vi.fn(),
    mockGrantedFigure: vi.fn(),
    mockInvalidate: vi.fn(),
    mockReject: vi.fn(),
    mockShown: vi.fn(),
    mockLater: vi.fn(),
  }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (...a: unknown[]) => mockFrom(...a) } }))
vi.mock("@/ee/billing/welcome-popup.js", () => ({ recordWelcomePopupShown: mockShown, recordWelcomePopupLater: mockLater }))
vi.mock("@/lib/api-auth-mode.js", () => ({ rejectProgrammaticAuth: (...a: unknown[]) => mockReject(...a) }))
vi.mock("@/ee/lib/welcome-offer-config.js", () => ({ getWelcomeOfferConfig: mockConfig }))
vi.mock("@/ee/lib/consent-record.js", () => ({ recordConsentGrant: mockRecordConsent }))
vi.mock("@/ee/lib/consent-loops-sync.js", () => ({ syncConsentRow: mockSync }))
vi.mock("@/ee/billing/signup-grant.js", () => ({
  readFreeGrant: mockReadFreeGrant,
  runSignupGrantClaim: mockRunClaim,
  grantedCreditsFigure: mockGrantedFigure,
}))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: mockInvalidate }))
// The leaf the consumers read from forwards to the mock above.
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))

import { welcomeOfferRoutes } from "../welcome-offer.js"
import { TIER_CREDITS } from "../../billing/stripe-config.js"
import { __resetDeploymentPayerForTests, __setDeploymentPayerForTests } from "../../../lib/deployment-payer.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PAYER = "00000000-0000-4000-8000-0000000000c3"
const HEX64 = "c".repeat(64)

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mockReject.mockReturnValue(false)
  mockConfig.mockResolvedValue({ enabled: true })
  mockRecordConsent.mockResolvedValue({ error: null })
  mockSync.mockResolvedValue(undefined)
  mockReadFreeGrant.mockResolvedValue({ state: "unclaimed", createdAt: new Date() })
  mockRunClaim.mockResolvedValue({ state: "granted", granted: true, decision: null })
  mockGrantedFigure.mockResolvedValue(TIER_CREDITS.free)
  mockShown.mockResolvedValue({ error: null, counted: true })
  mockLater.mockResolvedValue({ error: null })

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const q = req.query as Record<string, string | undefined>
    if (q?.userId) req.userId = q.userId
  })
  await app.register(welcomeOfferRoutes)
  await app.ready()
})

afterEach(async () => {
  __resetDeploymentPayerForTests()
  await app.close()
})

/** `userId: null` = anonymous (a default parameter would swallow `undefined`). */
function claim(body: Record<string, unknown> = {}, userId: string | null = USER) {
  return app.inject({
    method: "POST",
    url: `/v1/credits/welcome-offer/claim${userId ? `?userId=${userId}` : ""}`,
    headers: { "x-forwarded-for": "203.0.113.9" },
    payload: body,
  })
}

describe("POST /v1/credits/welcome-offer/claim", () => {
  it("401 without a user", async () => {
    const res = await claim({}, null)
    expect(res.statusCode).toBe(401)
    expect(mockRecordConsent).not.toHaveBeenCalled()
  })

  it("refuses a programmatic (non-browser) caller before writing anything", async () => {
    mockReject.mockImplementation((_req: unknown, reply: { status: (c: number) => { send: (b: unknown) => void } }) => {
      reply.status(403).send({ error: { code: "forbidden" } })
      return true
    })
    const res = await claim()
    expect(res.statusCode).toBe(403)
    expect(mockRecordConsent).not.toHaveBeenCalled()
  })

  it("409 while the offer is switched off — nothing is recorded", async () => {
    mockConfig.mockResolvedValue({ enabled: false })
    const res = await claim()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("welcome_offer_disabled")
    expect(mockRecordConsent).not.toHaveBeenCalled()
    expect(mockRunClaim).not.toHaveBeenCalled()
  })

  it("records consent (with the app), then claims with the consent gate on, then syncs Loops", async () => {
    const res = await claim({ sourceApp: "studio", browserKey: HEX64 })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ consent: "granted", grant: "granted", credits: TIER_CREDITS.free })

    expect(mockRecordConsent).toHaveBeenCalledWith(USER, "studio", null, expect.anything())
    expect(mockRunClaim).toHaveBeenCalledTimes(1)
    const [params, , options] = mockRunClaim.mock.calls[0]
    expect(params).toMatchObject({ userId: USER, browserKey: HEX64, deviceKey: null })
    expect(typeof params.ipHash).toBe("string")
    expect(options).toEqual({ requireConsent: true })
    // consent is written BEFORE the claim runs
    expect(mockRecordConsent.mock.invocationCallOrder[0]).toBeLessThan(mockRunClaim.mock.invocationCallOrder[0])
    expect(mockInvalidate).toHaveBeenCalledWith(USER)
    expect(mockSync).toHaveBeenCalledWith(USER)
  })

  it("a malformed fingerprint or app slug is dropped, never a 400", async () => {
    const res = await claim({ sourceApp: "NOT A SLUG", browserKey: "short" })
    expect(res.statusCode).toBe(200)
    expect(mockRecordConsent).toHaveBeenCalledWith(USER, null, null, expect.anything())
    expect(mockRunClaim.mock.calls[0][0]).toMatchObject({ browserKey: null })
  })

  it("records the language the yes was given in", async () => {
    const res = await claim({ sourceApp: "studio", locale: "ja" })
    expect(res.statusCode).toBe(200)
    expect(mockRecordConsent).toHaveBeenCalledWith(USER, "studio", "ja", expect.anything())
  })

  it.each([
    ["an unknown language", { locale: "xx-XX" }],
    ["a value that is not a string", { locale: 7 }],
    ["no language at all — an older client", {}],
  ])("%s is recorded as absent, and the claim still goes through", async (_label, extra) => {
    const res = await claim({ sourceApp: "studio", ...extra })
    expect(res.statusCode).toBe(200)
    expect(mockRecordConsent).toHaveBeenCalledWith(USER, "studio", null, expect.anything())
    expect(mockRunClaim).toHaveBeenCalledTimes(1)
  })

  it("an already-decided account only has its consent recorded (no second claim)", async () => {
    mockReadFreeGrant.mockResolvedValue({ state: "granted", createdAt: new Date() })
    const res = await claim({ sourceApp: "app" })
    expect(res.statusCode).toBe(200)
    expect(res.json().grant).toBe("granted")
    expect(mockRunClaim).not.toHaveBeenCalled()
    expect(mockRecordConsent).toHaveBeenCalledTimes(1)
    expect(mockInvalidate).toHaveBeenCalledWith(USER)
  })

  it("an account granted before the call is told what it WAS given — an earlier, larger grant included", async () => {
    mockReadFreeGrant.mockResolvedValue({ state: "granted", createdAt: new Date() })
    mockGrantedFigure.mockResolvedValue(1500)
    const res = await claim({ sourceApp: "app" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ consent: "granted", grant: "granted", credits: 1500 })
    expect(mockGrantedFigure).toHaveBeenCalledWith(USER)
  })

  it("a claim this call makes names today's figure, and never reads the ledger", async () => {
    const res = await claim({ sourceApp: "app" })
    expect(res.json()).toEqual({ consent: "granted", grant: "granted", credits: TIER_CREDITS.free })
    expect(mockGrantedFigure).not.toHaveBeenCalled()
  })

  it("reports 'withheld' when the abuse gate refuses after consent", async () => {
    mockRunClaim.mockResolvedValue({ state: "withheld", granted: false, decision: null })
    const res = await claim()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ consent: "granted", grant: "withheld" })
  })

  it("500 (sanitized) when consent cannot be recorded — no claim runs", async () => {
    mockRecordConsent.mockResolvedValue({ error: "db down" })
    const res = await claim()
    expect(res.statusCode).toBe(500)
    expect(mockRunClaim).not.toHaveBeenCalled()
  })
})

describe("POST /v1/credits/welcome-offer/seen", () => {
  // The writes themselves (the day's window, the compare-and-set, the
  // fallback before the counting columns exist) are pinned in
  // billing/__tests__/welcome-popup.test.ts; here, which one a body asks for.
  function seen(payload?: string | Record<string, unknown>, userId: string | null = USER) {
    return app.inject({
      method: "POST",
      url: `/v1/credits/welcome-offer/seen${userId ? `?userId=${userId}` : ""}`,
      ...(payload === undefined
        ? {}
        : { payload: typeof payload === "string" ? payload : JSON.stringify(payload), headers: { "content-type": "application/json" } }),
    })
  }

  it("401 without a user", async () => {
    const res = await seen(undefined, null)
    expect(res.statusCode).toBe(401)
    expect(mockShown).not.toHaveBeenCalled()
    expect(mockLater).not.toHaveBeenCalled()
  })

  it("409 while the offer is switched off — the columns may not exist yet", async () => {
    mockConfig.mockResolvedValue({ enabled: false })
    const res = await seen({ event: "shown" })
    expect(res.statusCode).toBe(409)
    expect(mockShown).not.toHaveBeenCalled()
    expect(mockLater).not.toHaveBeenCalled()
  })

  it('{ event: "shown" }: counts a showing and refreshes the balance', async () => {
    const res = await seen({ event: "shown" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(mockShown).toHaveBeenCalledWith(USER)
    expect(mockLater).not.toHaveBeenCalled()
    expect(mockInvalidate).toHaveBeenCalledWith(USER)
  })

  it('a showing within the day is still 200 (idempotent): the write counts nothing', async () => {
    mockShown.mockResolvedValue({ error: null, counted: false })
    const res = await seen({ event: "shown" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('{ event: "later" }: the answer, and the balance refreshed', async () => {
    const res = await seen({ event: "later" })
    expect(res.statusCode).toBe(200)
    expect(mockLater).toHaveBeenCalledWith(USER)
    expect(mockShown).not.toHaveBeenCalled()
    expect(mockInvalidate).toHaveBeenCalledWith(USER)
  })

  it.each([
    ["no body (every client released before showings were counted)", undefined],
    ["an empty object", {}],
    ["an unknown event", { event: "dismissed" }],
    ["an event that is not a string", { event: 1 }],
    ["a body that is not an object", '"shown"'],
  ])("%s is \"later\"", async (_label, payload) => {
    const res = await seen(payload as string | Record<string, unknown> | undefined)
    expect(res.statusCode).toBe(200)
    expect(mockLater).toHaveBeenCalledWith(USER)
    expect(mockShown).not.toHaveBeenCalled()
  })

  it("500 (sanitized) when a write fails, and the balance is left alone", async () => {
    mockShown.mockResolvedValue({ error: "statement timeout", counted: false })
    let res = await seen({ event: "shown" })
    expect(res.statusCode).toBe(500)
    expect(JSON.stringify(res.json())).not.toContain("statement timeout")
    mockLater.mockRejectedValue(new Error("db down"))
    res = await seen({ event: "later" })
    expect(res.statusCode).toBe(500)
    expect(mockInvalidate).not.toHaveBeenCalled()
  })
})

describe("the welcome offer on a deployment with a single payer", () => {
  // Every run there is billed to the deployment's billing account: the offer's
  // credits would land in a balance nothing spends. Both writes refuse before
  // the offer's own switch is read — so not even a marketing consent is
  // recorded for an offer that cannot exist there.
  const NOT_APPLICABLE = {
    error: { code: "not_applicable", message: "Free signup credits do not apply on this deployment." },
  }

  it("claim: 409 not_applicable — no consent recorded, no claim, nothing invalidated", async () => {
    __setDeploymentPayerForTests(PAYER)

    const res = await claim({ sourceApp: "studio", browserKey: HEX64 })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual(NOT_APPLICABLE)
    expect(mockConfig).not.toHaveBeenCalled()
    expect(mockRecordConsent).not.toHaveBeenCalled()
    expect(mockReadFreeGrant).not.toHaveBeenCalled()
    expect(mockRunClaim).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
    expect(mockSync).not.toHaveBeenCalled()
  })

  it("seen: 409 not_applicable — the popup is never stamped", async () => {
    __setDeploymentPayerForTests(PAYER)

    const res = await app.inject({ method: "POST", url: `/v1/credits/welcome-offer/seen?userId=${USER}` })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual(NOT_APPLICABLE)
    expect(mockConfig).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it("still answers 401 without a user, and 403 to a programmatic caller, first", async () => {
    __setDeploymentPayerForTests(PAYER)
    expect((await claim({}, null)).statusCode).toBe(401)

    mockReject.mockImplementation((_req: unknown, reply: { status: (c: number) => { send: (b: unknown) => void } }) => {
      reply.status(403).send({ error: { code: "forbidden" } })
      return true
    })
    expect((await claim()).statusCode).toBe(403)
  })
})
