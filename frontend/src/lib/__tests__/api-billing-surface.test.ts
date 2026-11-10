import { describe, it, expect, vi, afterEach } from "vitest"

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

import { BillingPlansError, getBillingPlans, getBillingSurface, getBillingAccount } from "../api"

function okJson(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => data, text: async () => JSON.stringify(data),
  })
}

describe("getBillingSurface", () => {
  it("GETs /v1/billing/surface and returns data", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const mock = okJson({ data: {
      contract: 2, providerId: "nodaro-cloud", displayUnit: "credits",
      canReport: true, canQuote: false, canAccount: true, mountCostTab: true,
    } })
    vi.stubGlobal("fetch", mock)
    const s = await getBillingSurface()
    expect(mock.mock.calls[0][0]).toBe("/v1/billing/surface")
    expect(mock.mock.calls[0][1].method).toBe("GET")
    expect(s.providerId).toBe("nodaro-cloud")
    expect(s.mountCostTab).toBe(true)
  })
})

describe("getBillingAccount", () => {
  it("returns data:null distinctly when the authority is unavailable", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    vi.stubGlobal("fetch", okJson({ data: null }))
    expect(await getBillingAccount()).toBeNull()
  })
  it("returns the account summary when present", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    vi.stubGlobal("fetch", okJson({ data: { plan: "pro", balance: 42, dailyAllowance: null, unit: "credits" } }))
    const a = await getBillingAccount()
    expect(a).toEqual({ plan: "pro", balance: 42, dailyAllowance: null, unit: "credits" })
  })
})

describe("getBillingPlans", () => {
  it("GETs /v1/billing/plans and returns the list", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const mock = okJson({ data: [], topUps: [], topUpRange: { min: 5, max: 500, currency: "USD" } })
    vi.stubGlobal("fetch", mock)
    const plans = await getBillingPlans()
    expect(mock.mock.calls[0][0]).toBe("/v1/billing/plans")
    expect(plans.topUpRange.max).toBe(500)
  })

  it("a failed answer keeps its HTTP status, so a refusal is never retried", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { code: "self_serve_disabled" } }) }))
    const failed = getBillingPlans()
    await expect(failed).rejects.toBeInstanceOf(BillingPlansError)
    await expect(failed).rejects.toMatchObject({ status: 403 })
  })
})
