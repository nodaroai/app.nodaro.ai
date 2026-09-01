import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type Stripe from "stripe"

const { mockFrom, mockRpc, mockRetrieve, mockCreateSession, mockCustomersCreate, mockLogTransaction, mockInvalidate } =
  vi.hoisted(() => ({
    mockFrom: vi.fn(),
    mockRpc: vi.fn(),
    mockRetrieve: vi.fn(),
    mockCreateSession: vi.fn(),
    mockCustomersCreate: vi.fn(),
    mockLogTransaction: vi.fn().mockResolvedValue(true),
    mockInvalidate: vi.fn(),
  }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))
vi.mock("@/ee/billing/stripe-client.js", () => ({
  getStripe: () => ({
    checkout: { sessions: { retrieve: mockRetrieve, create: mockCreateSession } },
    customers: { create: mockCustomersCreate },
  }),
}))
vi.mock("@/ee/billing/provision-credits.js", () => ({ ensureStripeCustomer: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: mockLogTransaction } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: mockInvalidate }))

import { freeGrantActivationRoutes, extractActivationCard, hashCardFingerprint } from "../free-grant-activation.js"
import { TIER_CREDITS } from "../../billing/stripe-config.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"

function completedSession(overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_1",
    mode: "setup",
    status: "complete",
    customer: "cus_1",
    metadata: { userId: USER, purpose: "free_grant_activation" },
    setup_intent: {
      id: "seti_1",
      status: "succeeded",
      payment_method: { id: "pm_1", card: { fingerprint: "FP_ABC" } },
    },
    ...overrides,
  } as unknown as Stripe.Checkout.Session
}

describe("extractActivationCard — what a session must prove", () => {
  it("accepts a completed setup session that belongs to the caller", () => {
    expect(extractActivationCard(completedSession(), USER)).toEqual({ ok: true, fingerprint: "FP_ABC", setupIntentId: "seti_1" })
  })
  it("refuses another user's session — metadata is the ownership check", () => {
    expect(extractActivationCard(completedSession(), OTHER)).toMatchObject({ ok: false, code: "session_mismatch" })
  })
  it("refuses a session created for any other purpose (a real checkout id cannot be replayed here)", () => {
    const s = completedSession({ metadata: { userId: USER } })
    expect(extractActivationCard(s, USER)).toMatchObject({ ok: false, code: "session_mismatch" })
  })
  it("refuses a payment-mode or unfinished session", () => {
    expect(extractActivationCard(completedSession({ mode: "payment" }), USER)).toMatchObject({ ok: false, code: "session_incomplete" })
    expect(extractActivationCard(completedSession({ status: "open" }), USER)).toMatchObject({ ok: false, code: "session_incomplete" })
  })
  it("refuses an un-expanded or unsucceeded setup intent", () => {
    expect(extractActivationCard(completedSession({ setup_intent: "seti_1" }), USER)).toMatchObject({ ok: false, code: "session_incomplete" })
    expect(
      extractActivationCard(completedSession({ setup_intent: { id: "seti_1", status: "requires_action", payment_method: null } }), USER),
    ).toMatchObject({ ok: false, code: "session_incomplete" })
  })
  it("requires a CARD — a fingerprint is the whole point", () => {
    const s = completedSession({ setup_intent: { id: "seti_1", status: "succeeded", payment_method: { id: "pm_1", us_bank_account: {} } } })
    expect(extractActivationCard(s, USER)).toMatchObject({ ok: false, code: "card_required" })
  })
  it("hashes the fingerprint before it is stored", () => {
    expect(hashCardFingerprint("FP_ABC")).toMatch(/^[0-9a-f]{64}$/)
    expect(hashCardFingerprint("FP_ABC")).not.toContain("FP_ABC")
  })
})

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

let app: FastifyInstance

function wire(opts: { state?: string; holder?: { user_id: string } | null; insertError?: { code: string } | null }) {
  const profiles = {
    select: vi.fn(() => profiles),
    eq: vi.fn(() => profiles),
    single: vi.fn().mockResolvedValue({ data: { free_grant_state: opts.state ?? "withheld", email: "u@x" }, error: null }),
  }
  const activations = {
    select: vi.fn(() => activations),
    eq: vi.fn(() => activations),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.holder ?? null, error: null }),
    insert: vi.fn().mockResolvedValue({ data: null, error: opts.insertError ?? null }),
  }
  const customers = {
    select: vi.fn(() => customers),
    eq: vi.fn(() => customers),
    single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: "cus_1" }, error: null }),
  }
  mockFrom.mockImplementation((table: string) => {
    if (table === "profiles") return profiles
    if (table === "free_grant_activations") return activations
    if (table === "stripe_customers") return customers
    return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
  })
  mockRpc.mockResolvedValue({
    data: [{ did_activate: true, old_credits: 0, new_credits: TIER_CREDITS.free, state: "granted" }],
    error: null,
  })
  mockRetrieve.mockResolvedValue(completedSession())
  mockCreateSession.mockResolvedValue({ url: "https://checkout.stripe.test/s" })
  return { activations }
}

beforeEach(async () => {
  vi.clearAllMocks()
  mockLogTransaction.mockResolvedValue(true)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-test-user-id"]
    if (typeof h === "string" && h) req.userId = h
  })
  await app.register(async (i) => { await freeGrantActivationRoutes(i) })
  await app.ready()
})
afterEach(async () => { await app.close() })

const post = (url: string, payload?: unknown, user: string | null = USER) =>
  app.inject({
    method: "POST",
    url,
    headers: { ...(user ? { "x-test-user-id": user } : {}), origin: "https://app.test" },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  })

describe("POST /v1/credits/free-grant/activation-session", () => {
  it("401s without a session", async () => {
    expect((await post("/v1/credits/free-grant/activation-session", undefined, null)).statusCode).toBe(401)
  })
  it("refuses unless the grant is withheld — a granted account cannot re-run it", async () => {
    wire({ state: "granted" })
    const res = await post("/v1/credits/free-grant/activation-session")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("not_withheld")
    expect(mockCreateSession).not.toHaveBeenCalled()
  })
  it("creates a SETUP-mode session (nothing charged) tagged with owner and purpose", async () => {
    wire({})
    const res = await post("/v1/credits/free-grant/activation-session")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { url: "https://checkout.stripe.test/s" } })
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "setup",
        customer: "cus_1",
        payment_method_types: ["card"],
        metadata: { userId: USER, purpose: "free_grant_activation" },
        success_url: "https://app.test/billing?activate_grant={CHECKOUT_SESSION_ID}",
      }),
    )
    expect(mockCreateSession.mock.calls[0]![0]).not.toHaveProperty("line_items")
  })
})

describe("POST /v1/credits/free-grant/activate", () => {
  it("activates: verifies with Stripe, records the card, runs the RPC, writes the ledger", async () => {
    const { activations } = wire({})
    const res = await post("/v1/credits/free-grant/activate", { sessionId: "cs_test_1" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "granted", activated: true })
    expect(mockRetrieve).toHaveBeenCalledWith("cs_test_1", { expand: ["setup_intent.payment_method"] })
    expect(activations.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER, card_fingerprint_hash: hashCardFingerprint("FP_ABC"), stripe_setup_intent_id: "seti_1" }),
    )
    expect(mockRpc).toHaveBeenCalledWith("activate_signup_grant", { p_user_id: USER, p_grant_amount: TIER_CREDITS.free })
    expect(mockLogTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: TIER_CREDITS.free, source: "signup_grant" }))
    expect(mockInvalidate).toHaveBeenCalledWith(USER)
  })

  it("409s when the card already activated ANOTHER account — one card, one grant", async () => {
    const { activations } = wire({ holder: { user_id: OTHER } })
    const res = await post("/v1/credits/free-grant/activate", { sessionId: "cs_test_1" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("card_already_used")
    expect(activations.insert).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("409s on a unique-index race too", async () => {
    wire({ insertError: { code: "23505" } })
    const res = await post("/v1/credits/free-grant/activate", { sessionId: "cs_test_1" })
    expect(res.statusCode).toBe(409)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("is idempotent for the SAME user retrying with the same card", async () => {
    const { activations } = wire({ holder: { user_id: USER } })
    const res = await post("/v1/credits/free-grant/activate", { sessionId: "cs_test_1" })
    expect(res.statusCode).toBe(200)
    expect(activations.insert).not.toHaveBeenCalled()
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it("refuses another user's session id", async () => {
    wire({})
    const res = await post("/v1/credits/free-grant/activate", { sessionId: "cs_test_1" }, OTHER)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("session_mismatch")
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("is a no-op once granted", async () => {
    wire({ state: "granted" })
    const res = await post("/v1/credits/free-grant/activate", { sessionId: "cs_test_1" })
    expect(res.json()).toEqual({ state: "granted", activated: false })
    expect(mockRetrieve).not.toHaveBeenCalled()
  })

  it("sanitizes a Stripe failure", async () => {
    wire({})
    mockRetrieve.mockRejectedValue(new Error("No such checkout.session: cs_test_1; stripe_customers leak"))
    const res = await post("/v1/credits/free-grant/activate", { sessionId: "cs_test_1" })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(JSON.stringify(res.json())).not.toContain("stripe_customers")
  })
})
