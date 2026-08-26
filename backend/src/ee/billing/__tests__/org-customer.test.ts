/**
 * E2/P13 — the org side of Stripe: payer resolution, the pack grant, the
 * clawback ROUTER (the security-relevant piece: an org refund must never fall
 * through to the personal clawback, which joins on transactions.user_id and
 * would take the credits from the org OWNER's personal pools — billing-07/H23),
 * and the ladder-parity guard (org packs are the personal ladder by decision,
 * and a personal re-rate must not silently drift the two apart).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  handleTopupClawback: vi.fn(async () => {}),
  customersCreate: vi.fn(async () => ({ id: "cus_org_1" })),
  checkoutCreate: vi.fn(async () => ({ id: "cs_1", url: "https://stripe.test/cs_1" })),
  portalCreate: vi.fn(async () => ({ url: "https://stripe.test/portal_1" })),
}))

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: h.from, rpc: h.rpc } }))
vi.mock("../../../lib/deployment-urls.js", () => ({ appBaseUrl: () => "https://app.test" }))
vi.mock("../stripe-client.js", () => ({
  getStripe: () => ({
    customers: { create: h.customersCreate },
    checkout: { sessions: { create: h.checkoutCreate } },
    billingPortal: { sessions: { create: h.portalCreate } },
  }),
}))
vi.mock("../provision-credits.js", () => ({ handleTopupClawback: h.handleTopupClawback }))

const { resolvePayer, routeClawback, handleOrgPackCompleted, createOrgPackCheckout } = await import("../org-customer.js")
const { ORG_TOP_UPS, TOP_UPS } = await import("../stripe-config.js")

/** Chainable stub resolving `result` at maybeSingle(). */
function chain(result: { data: unknown; error?: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "insert", "update"]) obj[m] = vi.fn(() => obj)
  obj.maybeSingle = vi.fn().mockResolvedValue({ error: null, ...result })
  return obj
}

beforeEach(() => {
  vi.clearAllMocks()
  h.rpc.mockResolvedValue({ data: true, error: null })
})

describe("ladder parity — org packs ARE the personal ladder (decision 2026-08-26)", () => {
  it("every org pack mirrors a TOP_UPS row exactly", () => {
    expect(Object.keys(ORG_TOP_UPS)).toHaveLength(4)
    for (const [packId, pack] of Object.entries(ORG_TOP_UPS)) {
      expect(TOP_UPS[pack.priceId], `${packId} priceId must exist in TOP_UPS`).toBeDefined()
      expect(pack.credits, `${packId} credits must equal the personal grant for the same price`).toBe(
        TOP_UPS[pack.priceId],
      )
    }
  })
})

describe("resolvePayer", () => {
  it("answers org / user / unknown from the one-owner row", async () => {
    h.from.mockReturnValueOnce(chain({ data: { user_id: null, org_id: "org-1" } }))
    expect(await resolvePayer("cus_a")).toEqual({ kind: "org", id: "org-1" })
    h.from.mockReturnValueOnce(chain({ data: { user_id: "u-1", org_id: null } }))
    expect(await resolvePayer("cus_b")).toEqual({ kind: "user", id: "u-1" })
    h.from.mockReturnValueOnce(chain({ data: null }))
    expect(await resolvePayer("cus_c")).toBeNull()
  })
})

describe("handleOrgPackCompleted", () => {
  it("grants the pack exactly as configured, keyed by the transaction id", async () => {
    const granted = await handleOrgPackCompleted({ orgId: "org-1", packId: "org-25", transactionId: "pi_1" })
    expect(granted).toBe(true)
    expect(h.rpc).toHaveBeenCalledWith("grant_org_credits_idempotent", {
      p_org_id: "org-1",
      p_credits: 8500,
      p_external_id: "pi_1",
      p_source: "org_purchase",
      p_amount_usd: 25,
    })
  })

  it("an unknown pack grants NOTHING (and does not throw — Stripe would redeliver forever)", async () => {
    const granted = await handleOrgPackCompleted({ orgId: "org-1", packId: "org-9999", transactionId: "pi_2" })
    expect(granted).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

describe("routeClawback — the org/personal fork", () => {
  it("an org transaction routes to claw_back_org_credits, proportionally, never the personal path", async () => {
    // $100 grant of 36,000 credits; half refunded → 18,000 clawed.
    h.from.mockReturnValueOnce(chain({ data: { org_id: "org-1", credits_granted: 36000, amount_usd: 100 } }))
    await routeClawback({ paymentIntentId: "pi_org", refunds: [{ refundId: "re_1", amountCents: 5000 }] })
    expect(h.rpc).toHaveBeenCalledWith("claw_back_org_credits", {
      p_org_id: "org-1",
      p_amount: 18000,
      p_stripe_event_id: "re_1",
    })
    expect(h.handleTopupClawback).not.toHaveBeenCalled()
  })

  it("clamps an over-refund to the grant", async () => {
    h.from.mockReturnValueOnce(chain({ data: { org_id: "org-1", credits_granted: 3300, amount_usd: 10 } }))
    await routeClawback({ paymentIntentId: "pi_org", refunds: [{ refundId: "re_2", amountCents: 99999 }] })
    expect(h.rpc).toHaveBeenCalledWith("claw_back_org_credits", expect.objectContaining({ p_amount: 3300 }))
  })

  it("a personal transaction falls through to the UNCHANGED personal clawback", async () => {
    h.from.mockReturnValueOnce(chain({ data: { org_id: null, credits_granted: 3300, amount_usd: 10 } }))
    const data = { paymentIntentId: "pi_personal", refunds: [{ refundId: "re_3", amountCents: 1000 }] }
    await routeClawback(data)
    expect(h.handleTopupClawback).toHaveBeenCalledWith(data)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("no payment intent → personal handler decides (it no-ops safely)", async () => {
    await routeClawback({ paymentIntentId: null, refunds: [] })
    expect(h.handleTopupClawback).toHaveBeenCalledTimes(1)
    expect(h.from).not.toHaveBeenCalled()
  })
})

describe("createOrgPackCheckout", () => {
  it("refuses an unknown pack before any Stripe call", async () => {
    expect(await createOrgPackCheckout("org-1", "u-1", "not-a-pack")).toBeNull()
    expect(h.checkoutCreate).not.toHaveBeenCalled()
  })

  it("sells the FIXED personal price with org metadata — the metadata is what makes it an org purchase", async () => {
    // Existing org customer row.
    h.from.mockReturnValueOnce(chain({ data: { stripe_customer_id: "cus_org_1" } }))
    const res = await createOrgPackCheckout("org-1", "u-1", "org-50")
    expect(res?.url).toBe("https://stripe.test/cs_1")
    expect(h.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_org_1",
        mode: "payment",
        line_items: [{ price: ORG_TOP_UPS["org-50"].priceId, quantity: 1 }],
        metadata: { payerKind: "org", orgId: "org-1", packId: "org-50", actorUserId: "u-1" },
      }),
    )
  })
})

describe("webhook wiring text pins (the fork itself)", () => {
  it("the checkout case forks on payerKind BEFORE the personal handler, and both clawback events route", async () => {
    const { readFileSync } = await import("node:fs")
    const { resolve } = await import("node:path")
    const src = readFileSync(resolve(__dirname, "../../routes/stripe-webhook.ts"), "utf8")
    const fork = src.indexOf('payerKind === "org"')
    const personal = src.indexOf("handleTransactionCompleted({")
    expect(fork).toBeGreaterThan(-1)
    expect(personal).toBeGreaterThan(-1)
    // Order matters: resolveUserId's fallbacks would mint a user row for an
    // org checkout if the personal handler ran first (billing-m05).
    expect(fork).toBeLessThan(personal)
    expect(src).toContain("handleOrgPackCompleted({")
    expect(src.match(/routeClawback\(/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
