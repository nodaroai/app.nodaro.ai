/**
 * changePlan(): an upgrade that waits on its payment comes back as a typed
 * error carrying the invoice to pay; every other refusal stays a plain Error
 * with the server's words. Same harness as api-http-credentials.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

import { changePlan, PlanChangePaymentRequiredError } from "../api"

function errJson(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: false, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) })
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: null } })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("changePlan", () => {
  it("an upgrade waiting on its payment throws PlanChangePaymentRequiredError with the invoice URL", async () => {
    vi.stubGlobal(
      "fetch",
      errJson(409, {
        error: {
          code: "plan_change_payment_required",
          message: "The payment for the new plan has not gone through, so your plan has not changed yet.",
          invoiceUrl: "https://invoice.stripe.com/i/abc",
        },
      }),
    )
    const err = await changePlan("user-1", "price_pro").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlanChangePaymentRequiredError)
    expect((err as PlanChangePaymentRequiredError).invoiceUrl).toBe("https://invoice.stripe.com/i/abc")
    expect((err as Error).message).toContain("payment for the new plan")
  })

  it("any other refusal is a plain Error with the server's sentence", async () => {
    vi.stubGlobal("fetch", errJson(409, { error: "Your subscription has a payment problem." }))
    const err = await changePlan("user-1", "price_pro").catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(PlanChangePaymentRequiredError)
    expect((err as Error).message).toContain("payment problem")
  })
})
