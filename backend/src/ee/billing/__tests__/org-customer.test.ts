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
vi.mock("../provision-credits.js", () => ({
  handleTopupClawback: h.handleTopupClawback,
  captureReceiptUrl: vi.fn(async () => {}),
}))

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

const ORG_UUID = "0a0a0a0a-1111-4222-8333-000000000001"

/** A settled session whose evidence all holds together. */
function goodPack(overrides: Partial<Parameters<typeof handleOrgPackCompleted>[0]> = {}) {
  return {
    orgId: ORG_UUID,
    packId: "org-25",
    transactionId: "pi_1",
    stripeCustomerId: "cus_org_1",
    amountTotalCents: 2500,
    lineItems: [{ priceId: ORG_TOP_UPS["org-25"].priceId }],
    ...overrides,
  }
}

describe("handleOrgPackCompleted — metadata never stands alone", () => {
  it("grants when the line items, customer owner, and pack agree; records the SETTLED price", async () => {
    // resolvePayer's stripe_customers row: this customer belongs to the org.
    h.from.mockReturnValueOnce(chain({ data: { user_id: null, org_id: ORG_UUID } }))
    const granted = await handleOrgPackCompleted(goodPack({ amountTotalCents: 1500 /* 40%-off promo */ }))
    expect(granted).toBe(true)
    expect(h.rpc).toHaveBeenCalledWith("grant_org_credits_idempotent", {
      p_org_id: ORG_UUID,
      p_credits: 8500,
      p_external_id: "pi_1",
      p_source: "org_purchase",
      // The DISCOUNTED price — clawback divides by this, so recording the
      // catalog price would under-claw every partial refund of a promo buy.
      p_amount_usd: 15,
    })
  })

  it("an unknown pack grants NOTHING (and does not throw — Stripe would redeliver forever)", async () => {
    const granted = await handleOrgPackCompleted(goodPack({ packId: "org-9999" }))
    expect(granted).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("a non-uuid orgId in metadata grants nothing", async () => {
    const granted = await handleOrgPackCompleted(goodPack({ orgId: "org-1" }))
    expect(granted).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("line items that do not carry the pack's price grant nothing — metadata cannot size a grant", async () => {
    const granted = await handleOrgPackCompleted(goodPack({ lineItems: [{ priceId: "price_something_else" }] }))
    expect(granted).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("a customer the org does not own grants nothing — metadata cannot point money at a foreign org", async () => {
    h.from.mockReturnValueOnce(chain({ data: { user_id: "u-1", org_id: null } }))
    const granted = await handleOrgPackCompleted(goodPack())
    expect(granted).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("no customer on the session grants nothing", async () => {
    const granted = await handleOrgPackCompleted(goodPack({ stripeCustomerId: null }))
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

  it("a FAILED routing lookup refuses to route — guessing personal would debit the org owner's own pools", async () => {
    h.from.mockReturnValueOnce(chain({ data: null, error: { code: "57014", message: "statement timeout" } }))
    await routeClawback({ paymentIntentId: "pi_x", refunds: [{ refundId: "re_9", amountCents: 1000 }] })
    expect(h.handleTopupClawback).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("a pre-351 schema (42703: no org_id column) falls through to the personal path — no org rows can exist there", async () => {
    h.from.mockReturnValueOnce(chain({ data: null, error: { code: "42703", message: "column transactions.org_id does not exist" } }))
    const data = { paymentIntentId: "pi_old", refunds: [{ refundId: "re_10", amountCents: 500 }] }
    await routeClawback(data)
    expect(h.handleTopupClawback).toHaveBeenCalledWith(data)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("a zero-settled grant (100%-off promo) claws NOTHING — never 'claw everything' on missing price data", async () => {
    h.from.mockReturnValueOnce(chain({ data: { org_id: ORG_UUID, credits_granted: 8500, amount_usd: 0 } }))
    await routeClawback({ paymentIntentId: "pi_free", refunds: [{ refundId: "re_11", amountCents: 1 }] })
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.handleTopupClawback).not.toHaveBeenCalled()
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
