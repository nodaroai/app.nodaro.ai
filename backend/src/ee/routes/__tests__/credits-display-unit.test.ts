// @test-units-by-name names no node type: it prices the ids it names (CreditsService mocked)
/**
 * The deployment's display unit on the credit reads thin clients render:
 * `GET /v1/user/credits`, `POST /v1/credits/model-costs` and
 * `GET /v1/credits/model-cost`.
 *
 * What is pinned:
 *  - With no unit configured nothing changes: no `display` key, bodies as before.
 *  - With one, a `display` object rides BESIDE the raw fields, every credit
 *    figure in it converted by the server (`toUnits`): the raw fields are
 *    untouched, null stays null, optional keys keep their presence, and the
 *    rate itself is never sent.
 *  - It is derived on the way OUT of the balance cache, so a cached read and a
 *    fresh one agree, and a unit change reaches the next read.
 *  - The billing account's own read on a deployment with a single payer gets
 *    no `display`: its balance is the deployment's pool, kept in raw credits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  getBalance: vi.fn(),
  getModelCreditCost: vi.fn(),
  readFreeGrant: vi.fn(),
  readWelcomeOfferState: vi.fn(),
  welcomeConfig: vi.fn(),
  allowanceFor: vi.fn(),
  walletBalance: vi.fn(),
  state: { payerActive: false, payerId: null as string | null, wallet: false },
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config.js")>()
  return {
    ...actual,
    hasCredits: () => true,
    isCloud: () => true,
    isCommunity: () => false,
    isBusiness: () => false,
    hasAdmin: () => true,
    hasOrganizations: () => true,
    llmMeteredPricing: () => true,
  }
})

const FIXED_ID = "nano-banana"
vi.mock("@/ee/billing/credits.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../billing/credits.js")>()
  return {
    ...actual,
    getChargedPriceTable: async () => actual.chargedPriceTableFrom(new Map([[FIXED_ID, 40]]), { cost_markup_percent: 10 } as never),
  }
})
vi.mock("@/ee/services/credits.js", () => ({
  CreditsService: {
    getBalance: h.getBalance,
    getModelCreditCost: h.getModelCreditCost,
    checkCredits: vi.fn(),
    reserveCredits: vi.fn(),
    commitCredits: vi.fn(),
    refundCredits: vi.fn(),
    estimateWorkflowCredits: vi.fn(),
  },
}))
vi.mock("@/ee/billing/signup-grant.js", async () => {
  const actual = await vi.importActual<typeof import("@/ee/billing/signup-grant.js")>("@/ee/billing/signup-grant.js")
  return { ...actual, readFreeGrant: h.readFreeGrant, readWelcomeOfferState: h.readWelcomeOfferState }
})
vi.mock("@/ee/lib/welcome-offer-config.js", () => ({ getWelcomeOfferConfig: h.welcomeConfig }))
vi.mock("@/ee/billing/deployment-allowance-service.js", () => ({ allowanceFor: h.allowanceFor }))
vi.mock("@/ee/billing/external-wallet.js", () => ({
  externalWalletActive: () => h.state.wallet,
  externalWalletBalance: h.walletBalance,
}))
vi.mock("@/lib/deployment-payer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deployment-payer.js")>()
  return {
    ...actual,
    deploymentPayerActive: () => h.state.payerActive,
    allowanceEnforcementActive: () => false,
    deploymentPayerId: () => h.state.payerId,
  }
})
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn(), admin: { getUserById: vi.fn() } } },
}))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => {}, reserveCreditsForJob: vi.fn() }))
vi.mock("@/lib/private-plugins/load.js", () => ({ getPluginServices: () => ({ billing: undefined }) }))
vi.mock("@/lib/private-plugins/services-registry.js", () => ({ getPluginServices: () => ({ billing: undefined }) }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/use-case/inner-availability.js", () => ({ usecaseViewerEstimateFor: async () => ({}) }))

import { creditsRoutes, invalidateBalanceCache } from "../credits.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"

const OPUS = "llm-chat:claude-opus-5.5"
const BALANCE = {
  total: 1500,
  subscription: 1000,
  topup: 500,
  dailySpent: 7,
  dailyLimit: null,
  monthlyAllocation: 1000,
  tier: "pro",
  effectiveTier: "pro",
  features: {},
  periodEnd: null,
  appCreditsAllowance: 3,
}

let seq = 0
/** The balance cache is 15 s and keyed by userId — one user per case. */
const nextUserId = () => `00000000-0000-4000-8000-0000000007${String(++seq).padStart(2, "0")}`

function setUnit(billing: Record<string, unknown> | null) {
  if (billing) process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ billing })
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance
const usedUserIds: string[] = []

beforeEach(async () => {
  vi.clearAllMocks()
  h.state.payerActive = false
  h.state.payerId = null
  h.state.wallet = false
  h.getBalance.mockResolvedValue(BALANCE)
  h.getModelCreditCost.mockResolvedValue(44)
  h.readFreeGrant.mockResolvedValue(undefined)
  h.welcomeConfig.mockResolvedValue({ enabled: false })
  h.allowanceFor.mockResolvedValue(null)
  setUnit(null)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-test-user-id"]
    if (typeof header === "string" && header) {
      req.userId = header
      // A browser balance poll: the payer's own read is answered only to its session.
      req.authKind = "jwt"
    }
  })
  await app.register(async (instance) => {
    await creditsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  for (const id of usedUserIds.splice(0)) invalidateBalanceCache(id)
  setUnit(null)
  await app.close()
})

function getCredits(userId: string) {
  usedUserIds.push(userId)
  return app.inject({ method: "GET", url: "/v1/user/credits", headers: { "x-test-user-id": userId } })
}
const batch = (models: string[]) => app.inject({ method: "POST", url: "/v1/credits/model-costs", payload: { models } })
const single = (model: string) => app.inject({ method: "GET", url: `/v1/credits/model-cost?model=${encodeURIComponent(model)}` })

describe("with no display unit configured, nothing changes", () => {
  it("GET /v1/user/credits carries no display key", async () => {
    const data = (await getCredits(nextUserId())).json().data as Record<string, unknown>
    expect(Object.hasOwn(data, "display")).toBe(false)
    expect(data.total).toBe(1500)
  })

  it("POST /v1/credits/model-costs answers byte-identically", async () => {
    const res = await batch([FIXED_ID, "mystery-model"])
    expect(res.body).toBe(JSON.stringify({ data: { [FIXED_ID]: 44 }, missing: ["mystery-model"], errors: [] }))
  })

  it("GET /v1/credits/model-cost answers byte-identically", async () => {
    const res = await single(FIXED_ID)
    expect(res.body).toBe(JSON.stringify({ data: { model: FIXED_ID, creditCost: 44 } }))
  })
})

describe("GET /v1/user/credits with a display unit", () => {
  beforeEach(() => setUnit({ unitLabel: "Points", unitRate: 2 }))

  it("adds display beside the raw fields: every credit figure converted, null kept null", async () => {
    const data = (await getCredits(nextUserId())).json().data as Record<string, unknown>

    expect(data.display).toEqual({
      unit: "Points",
      decimals: 0,
      total: 3000,
      subscription: 2000,
      topup: 1000,
      dailySpent: 14,
      dailyLimit: null,
      monthlyAllocation: 2000,
      appCreditsAllowance: 6,
    })
    // The raw fields are untouched.
    expect(data.total).toBe(1500)
    expect(data.subscription).toBe(1000)
    expect(data.dailyLimit).toBeNull()
  })

  it("never sends the rate", async () => {
    const display = (await getCredits(nextUserId())).json().data.display as Record<string, unknown>
    expect(Object.keys(display)).not.toContain("rate")
    expect(JSON.stringify(display)).not.toContain("unitRate")
  })

  it("a cached read carries the same display, and a unit change reaches the next read", async () => {
    const userId = nextUserId()
    const first = (await getCredits(userId)).json().data.display
    const cached = (await getCredits(userId)).json().data.display
    expect(h.getBalance).toHaveBeenCalledTimes(1)
    expect(cached).toEqual(first)

    setUnit({ unitLabel: "Stars", unitRate: 3 })
    const after = (await getCredits(userId)).json().data.display as { unit: string; total: number }
    expect(h.getBalance).toHaveBeenCalledTimes(1)
    expect(after.unit).toBe("Stars")
    expect(after.total).toBe(4500)
  })

  it("decimals carry through: a fractional rate is rounded to the configured places", async () => {
    setUnit({ unitLabel: "Points", unitRate: 0.5, unitDecimals: 1 })
    const display = (await getCredits(nextUserId())).json().data.display as Record<string, unknown>
    expect(display).toMatchObject({ decimals: 1, total: 750, dailySpent: 3.5, appCreditsAllowance: 1.5 })
  })

  it("the welcome offer's credits are converted when the offer is present", async () => {
    h.welcomeConfig.mockResolvedValue({ enabled: true })
    h.readWelcomeOfferState.mockResolvedValue({ popupSeen: false, consentPending: false })
    const data = (await getCredits(nextUserId())).json().data as { welcomeOffer: { credits: number }; display: { welcomeOffer: unknown } }
    expect(data.display.welcomeOffer).toEqual({ credits: data.welcomeOffer.credits * 2 })
  })

  it("no allowance, wallet or welcome-offer key in display when the raw one is absent", async () => {
    const display = (await getCredits(nextUserId())).json().data.display as Record<string, unknown>
    expect(Object.hasOwn(display, "allowance")).toBe(false)
    expect(Object.hasOwn(display, "externalWallet")).toBe(false)
    expect(Object.hasOwn(display, "welcomeOffer")).toBe(false)
  })
})

describe("GET /v1/user/credits with a display unit, on a deployment with a single payer", () => {
  beforeEach(() => {
    setUnit({ unitLabel: "Points", unitRate: 2 })
    h.state.payerActive = true
    h.state.payerId = "00000000-0000-4000-8000-0000000000ff"
  })

  it("a requester's allowance is converted; the enforcement switch stays only on the raw field", async () => {
    h.allowanceFor.mockResolvedValue({ granted: 400, remaining: 150 })
    const data = (await getCredits(nextUserId())).json().data as { allowance: unknown; display: { allowance: unknown } }
    expect(data.allowance).toEqual({ granted: 400, remaining: 150, enforced: false })
    expect(data.display.allowance).toEqual({ granted: 800, remaining: 300 })
  })

  it("an unavailable allowance stays null in display too — never 0", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.allowanceFor.mockResolvedValue(null)
    const data = (await getCredits(nextUserId())).json().data as { display: Record<string, unknown> }
    expect(Object.hasOwn(data.display, "allowance")).toBe(true)
    expect(data.display.allowance).toBeNull()
  })

  it("a shared wallet's balance is converted", async () => {
    h.state.wallet = true
    h.walletBalance.mockResolvedValue(250)
    const data = (await getCredits(nextUserId())).json().data as { externalWallet: unknown; display: { externalWallet: unknown } }
    expect(data.externalWallet).toEqual({ available: 250 })
    expect(data.display.externalWallet).toEqual({ available: 500 })
  })

  it("the billing account's own read carries no display: its balance is the pool, kept in credits", async () => {
    const payerId = nextUserId()
    h.state.payerId = payerId
    const data = (await getCredits(payerId)).json().data as Record<string, unknown>
    expect(Object.hasOwn(data, "display")).toBe(false)
    expect(data.total).toBe(1500)
  })
})

describe("the unit's words per interface language", () => {
  const WORDS = { en: "Points", he: "נקודות" }

  it("the balance's display carries the map beside the single label; the client picks the viewer's word", async () => {
    setUnit({ unitLabel: "Points", unitRate: 2, unitLabels: WORDS })
    const data = (await getCredits(nextUserId())).json().data as { display: Record<string, unknown> }
    expect(data.display.unit).toBe("Points")
    expect(data.display.unitLabels).toEqual(WORDS)
    expect(data.display.decimals).toBe(0)
  })

  it("the price lookups carry it too", async () => {
    setUnit({ unitLabel: "Points", unitRate: 2, unitLabels: WORDS })
    expect((await batch([FIXED_ID])).json().display.unitLabels).toEqual(WORDS)
    const single_ = (await single(FIXED_ID)).json().data.display
    expect(single_.unit).toBe("Points")
    expect(single_.unitLabels).toEqual(WORDS)
  })

  it("a single label: the key is absent, not empty — every body as before", async () => {
    setUnit({ unitLabel: "Points", unitRate: 2 })
    const display = (await getCredits(nextUserId())).json().data.display as Record<string, unknown>
    expect(Object.hasOwn(display, "unitLabels")).toBe(false)
    expect(Object.hasOwn((await batch([FIXED_ID])).json().display, "unitLabels")).toBe(false)
    expect(Object.hasOwn((await single(FIXED_ID)).json().data.display, "unitLabels")).toBe(false)
  })
})

describe("the price lookups with a display unit", () => {
  beforeEach(() => setUnit({ unitLabel: "Points", unitRate: 2 }))

  it("POST /v1/credits/model-costs adds display.data, the same ids converted; the id lists are unchanged", async () => {
    const body = (await batch([FIXED_ID, OPUS, "mystery-model"])).json()
    expect(body.data).toEqual({ [FIXED_ID]: 44, [OPUS]: 6 })
    expect(body.display).toEqual({ unit: "Points", decimals: 0, data: { [FIXED_ID]: 88, [OPUS]: 12 } })
    expect(body.missing).toEqual(["mystery-model"])
    expect(body.estimates).toEqual([OPUS])
  })

  it("GET /v1/credits/model-cost adds data.display for a fixed id", async () => {
    const body = (await single(FIXED_ID)).json()
    expect(body.data).toEqual({ model: FIXED_ID, creditCost: 44, display: { unit: "Points", decimals: 0, creditCost: 88 } })
  })

  it("GET /v1/credits/model-cost adds data.display for an estimate too", async () => {
    const body = (await single(OPUS)).json()
    expect(body.data).toEqual({ model: OPUS, creditCost: 6, estimate: true, display: { unit: "Points", decimals: 0, creditCost: 12 } })
  })
})
