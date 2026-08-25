import { describe, it, expect, vi, afterEach } from "vitest"

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

import { getBillingSurface, getBillingAccount } from "../api"

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
      contract: 1, providerId: "nodaro-cloud", displayUnit: "credits",
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
