// @test-watches backend/src/**/*.ts
/**
 * Stripe documents are in English: the customer is created with
 * `preferred_locales: ["en"]`, every Checkout and Portal session runs with
 * `locale: "en"`, a Checkout for an existing customer sets that customer to
 * English first, and nothing in the backend creates any of the three any
 * other way (a source guard fails the build on another place).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const h = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  customersUpdate: vi.fn(),
  checkoutCreate: vi.fn(),
  portalCreate: vi.fn(),
}))

vi.mock("../stripe-client.js", () => ({
  getStripe: () => ({
    customers: { create: h.customersCreate, update: h.customersUpdate },
    checkout: { sessions: { create: h.checkoutCreate } },
    billingPortal: { sessions: { create: h.portalCreate } },
  }),
}))

const { createStripeCustomer, createCheckoutSession, createPortalSession, STRIPE_DOCUMENT_LOCALE } = await import("../stripe-english.js")

beforeEach(() => {
  h.customersCreate.mockReset().mockResolvedValue({ id: "cus_1" })
  h.customersUpdate.mockReset().mockResolvedValue({ id: "cus_1" })
  h.checkoutCreate.mockReset().mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })
  h.portalCreate.mockReset().mockResolvedValue({ id: "bps_1", url: "https://portal.stripe.test/bps_1" })
})

describe("createStripeCustomer", () => {
  it("creates the customer with English documents and keeps every other field", async () => {
    const customer = await createStripeCustomer({ email: "first@example.com", metadata: { userId: "u-1" } })
    expect(customer).toEqual({ id: "cus_1" })
    expect(h.customersCreate).toHaveBeenCalledWith({
      email: "first@example.com",
      metadata: { userId: "u-1" },
      preferred_locales: ["en"],
    })
  })

  it("a caller cannot pick another language", async () => {
    await createStripeCustomer({ name: "Org", preferred_locales: ["he-IL"] })
    expect(h.customersCreate.mock.calls[0]![0].preferred_locales).toEqual([STRIPE_DOCUMENT_LOCALE])
  })
})

describe("createCheckoutSession", () => {
  const params = {
    customer: "cus_1",
    mode: "payment" as const,
    line_items: [{ price: "price_1", quantity: 1 }],
    success_url: "https://app.test/ok",
    cancel_url: "https://app.test/no",
  }

  it("runs the Checkout in English and keeps every other field", async () => {
    const session = await createCheckoutSession(params)
    expect(session.url).toBe("https://checkout.stripe.test/cs_1")
    expect(h.checkoutCreate).toHaveBeenCalledWith({ ...params, locale: "en" })
  })

  it("sets an existing customer to English before the Checkout opens", async () => {
    await createCheckoutSession(params)
    expect(h.customersUpdate).toHaveBeenCalledWith("cus_1", { preferred_locales: ["en"] })
    expect(h.customersUpdate.mock.invocationCallOrder[0]).toBeLessThan(h.checkoutCreate.mock.invocationCallOrder[0]!)
  })

  it("a failed customer write is logged and never blocks the purchase", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    h.customersUpdate.mockRejectedValue(new Error("rate limited"))
    const session = await createCheckoutSession(params)
    expect(session.url).toBe("https://checkout.stripe.test/cs_1")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cus_1"), "rate limited")
    warn.mockRestore()
  })

  it("touches no customer when the Checkout names none", async () => {
    await createCheckoutSession({ mode: "subscription" })
    expect(h.customersUpdate).not.toHaveBeenCalled()
  })

  it("a caller cannot pick another language", async () => {
    await createCheckoutSession({ mode: "subscription", locale: "ja" })
    expect(h.checkoutCreate.mock.calls[0]![0].locale).toBe(STRIPE_DOCUMENT_LOCALE)
  })
})

describe("createPortalSession", () => {
  it("opens the portal in English and keeps every other field", async () => {
    const session = await createPortalSession({ customer: "cus_1", return_url: "https://app.test/billing" })
    expect(session.url).toBe("https://portal.stripe.test/bps_1")
    expect(h.portalCreate).toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://app.test/billing", locale: "en" })
  })

  it("a caller cannot pick another language", async () => {
    await createPortalSession({ customer: "cus_1", locale: "fr" })
    expect(h.portalCreate.mock.calls[0]![0].locale).toBe(STRIPE_DOCUMENT_LOCALE)
  })
})

// ---------------------------------------------------------------------------
// Source guard: the helpers are the only creators
// ---------------------------------------------------------------------------

const SRC = join(__dirname, "..", "..", "..")
/** A backend/src-relative path in the platform's separators. */
const file = (p: string) => join(...p.split("/"))
const HELPER = file("ee/billing/stripe-english.ts")
const CALLERS = ["ee/billing/org-customer.ts", "ee/routes/billing.ts", "ee/routes/deployment-billing.ts"].map(file)
const RAW_CALLS = [
  /\bcustomers\s*\.\s*create\s*\(/,
  /\bcustomers\s*\.\s*update\s*\(/,
  /checkout\s*\.\s*sessions\s*\.\s*create\s*\(/,
  /billingPortal\s*\.\s*sessions\s*\.\s*create\s*\(/,
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full)
  }
  return out
}

describe("Stripe creation sites", () => {
  const files = sourceFiles(SRC).map((f) => ({ file: relative(SRC, f), text: readFileSync(f, "utf8") }))

  it("no file but the helper creates a customer, a Checkout or a Portal session, or updates a customer", () => {
    const raw = files
      .filter(({ file }) => file !== HELPER)
      .filter(({ text }) => RAW_CALLS.some((re) => re.test(text)))
      .map(({ file }) => file)
    expect(raw).toEqual([])
  })

  it("the known creators still go through the helpers (a rename must update this guard)", () => {
    const callers = files
      .filter(({ text }) => /\bcreate(StripeCustomer|CheckoutSession|PortalSession)\(/.test(text))
      .map(({ file }) => file)
      .filter((file) => file !== HELPER)
    expect(callers.sort()).toEqual([...CALLERS].sort())
  })
})
