import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHash } from "node:crypto"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route/lib import
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, mockLogTransaction, mockInvalidateBalanceCache, mockGetUserById } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockLogTransaction: vi.fn().mockResolvedValue(true),
  mockInvalidateBalanceCache: vi.fn(),
  mockGetUserById: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { admin: { getUserById: (...args: unknown[]) => mockGetUserById(...args) } },
  },
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { logTransaction: mockLogTransaction },
}))

// The real module drags in the OpenAPI registry, the billing context and the
// credit-guard implementation; the route only needs the cache invalidator.
vi.mock("@/ee/routes/credits.js", () => ({
  invalidateBalanceCache: mockInvalidateBalanceCache,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { claimSignupGrantRoutes } from "../claim-signup-grant.js"
import { TIER_CREDITS } from "../../billing/stripe-config.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const CALLER_IP = "203.0.113.5"
/** What callerKeyHash MUST derive: sha256 of the first X-Forwarded-For hop. */
const EXPECTED_IP_HASH = createHash("sha256").update(CALLER_IP).digest("hex")
const HEX64 = "a".repeat(64)
const OTHER_HEX64 = "b".repeat(64)

// ---------------------------------------------------------------------------
// Supabase chain doubles
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: unknown }

interface Doubles {
  profiles: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; single: ReturnType<typeof vi.fn> }
  signals: { upsert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> }
  /** Every (column, value) pair passed to `.neq()` across all head counts. */
  neqCalls: Array<[string, unknown]>
}

/** Per-rule head counts the policy reads back; every rule defaults to "nobody else". */
interface Counts {
  browser?: number
  deviceSameIp?: number
  device?: number
  ip?: number
}

function wireSupabase(opts: {
  profile?: Result
  signal?: Result
  rpc?: Result
  providers?: string[] | null
  counts?: Counts
}): Doubles {
  mockGetUserById.mockResolvedValue(
    opts.providers === null
      ? { data: null, error: { message: "gotrue unreachable" } }
      : { data: { user: { app_metadata: { providers: opts.providers ?? ["google"] } } }, error: null },
  )
  const profiles = {
    select: vi.fn(() => profiles),
    eq: vi.fn(() => profiles),
    single: vi.fn().mockResolvedValue(opts.profile ?? { data: { free_grant_state: "unclaimed" }, error: null }),
  } as unknown as Doubles["profiles"]

  // A thenable filter chain: the policy awaits `.eq(...).neq(...)` directly.
  // Which rule is being counted is recoverable from the filters applied.
  const neqCalls: Array<[string, unknown]> = []
  function headChain() {
    const filters: Record<string, unknown> = {}
    const chain = {
      eq: (col: string, v: unknown) => { filters[col] = v; return chain },
      neq: (col: string, v: unknown) => { neqCalls.push([col, v]); return chain },
      gte: () => chain,
      then: (resolve: (r: { count: number; error: null }) => void) => {
        const c = opts.counts ?? {}
        let count = 0
        if ("browser_key" in filters) count = c.browser ?? 0
        else if ("device_key" in filters && "ip_hash" in filters) count = c.deviceSameIp ?? 0
        else if ("device_key" in filters) count = c.device ?? 0
        else if ("ip_hash" in filters) count = c.ip ?? 0
        resolve({ count, error: null })
      },
    }
    return chain
  }
  const updateChain = { eq: vi.fn(() => updateChain), then: (r: (x: Result) => void) => r({ data: null, error: null }) }
  const signals = {
    upsert: vi.fn().mockResolvedValue(opts.signal ?? { data: null, error: null }),
    select: vi.fn(() => headChain()),
    update: vi.fn(() => updateChain),
  }

  mockFrom.mockImplementation((table: string) => {
    if (table === "profiles") return profiles
    if (table === "signup_signals") return signals
    // Best-effort telemetry (app_reports) may land here after a 500.
    return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
  })

  mockRpc.mockResolvedValue(
    opts.rpc ?? { data: [{ did_claim: true, old_credits: 0, new_credits: TIER_CREDITS.free, state: "granted" }], error: null },
  )

  return { profiles, signals, neqCalls }
}

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mockLogTransaction.mockResolvedValue(true)

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-test-user-id"]
    if (typeof header === "string" && header) req.userId = header
  })
  await app.register(async (instance) => {
    await claimSignupGrantRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function claim(body?: unknown, userId: string | null = TEST_USER_ID) {
  const headers: Record<string, string> = { "x-forwarded-for": `${CALLER_IP}, 10.0.0.1` }
  if (userId) headers["x-test-user-id"] = userId
  return app.inject({
    method: "POST",
    url: "/v1/credits/claim-signup-grant",
    headers,
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
}

/** The single object handed to `.upsert()`. */
function upsertedRow(doubles: Doubles): Record<string, unknown> {
  expect(doubles.signals.upsert).toHaveBeenCalledTimes(1)
  return doubles.signals.upsert.mock.calls[0]![0] as Record<string, unknown>
}

// ---------------------------------------------------------------------------

describe("POST /v1/credits/claim-signup-grant — auth", () => {
  it("401s without a session", async () => {
    wireSupabase({})
    const res = await claim({}, null)
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe("POST /v1/credits/claim-signup-grant — already decided", () => {
  it("is an idempotent no-op once granted: no signal row, no RPC", async () => {
    const doubles = wireSupabase({ profile: { data: { free_grant_state: "granted" }, error: null } })
    const res = await claim({ browserKey: HEX64 })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "granted", granted: false })
    expect(doubles.signals.upsert).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockLogTransaction).not.toHaveBeenCalled()
  })

  it("passes 'withheld' through untouched (PR 2 sets it; PR 1 only reports it)", async () => {
    const doubles = wireSupabase({ profile: { data: { free_grant_state: "withheld" }, error: null } })
    const res = await claim({})
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "withheld", granted: false })
    expect(doubles.signals.upsert).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe("POST /v1/credits/claim-signup-grant — the claim", () => {
  it("records the signals, claims via the RPC, and reports the new state", async () => {
    const doubles = wireSupabase({})
    const res = await claim({ browserKey: HEX64, deviceKey: OTHER_HEX64 })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "granted", granted: true })

    expect(upsertedRow(doubles)).toEqual({
      user_id: TEST_USER_ID,
      browser_key: HEX64,
      device_key: OTHER_HEX64,
      ip_hash: EXPECTED_IP_HASH,
      source: "claim",
    })
    // A KEYED claim may overwrite a keyless row the balance-read fallback
    // left first — the fingerprints are the observation worth keeping.
    expect(doubles.signals.upsert.mock.calls[0]![1]).toEqual({
      onConflict: "user_id,source",
      ignoreDuplicates: false,
    })

    expect(mockRpc).toHaveBeenCalledWith("claim_signup_grant", {
      p_user_id: TEST_USER_ID,
      p_grant_amount: TIER_CREDITS.free,
      p_withhold: false,
    })
  })

  it("derives ip_hash on the SERVER — the body cannot supply or override it", async () => {
    const doubles = wireSupabase({})
    const forged = createHash("sha256").update("198.51.100.9").digest("hex")
    const res = await claim({
      browserKey: HEX64,
      ip_hash: forged,
      ipHash: forged,
      ip: "198.51.100.9",
      "x-forwarded-for": "198.51.100.9",
    })

    expect(res.statusCode).toBe(200)
    const row = upsertedRow(doubles)
    expect(row.ip_hash).toBe(EXPECTED_IP_HASH)
    expect(row.ip_hash).not.toBe(forged)
    // No body key reaches the insert other than the two fingerprints.
    expect(Object.keys(row).sort()).toEqual(["browser_key", "device_key", "ip_hash", "source", "user_id"])
  })

  it("logs the top-up and invalidates the balance cache when credits actually rose", async () => {
    wireSupabase({})
    await claim({})
    expect(mockLogTransaction).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      amount: TIER_CREDITS.free,
      creditType: "subscription",
      source: "signup_grant",
      description: "Free signup grant",
      balanceAfter: TIER_CREDITS.free,
    })
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith(TEST_USER_ID)
  })

  it("writes no ledger row when the balance did not move (the PR-1 no-op case)", async () => {
    // While the column DEFAULT still stands, a fresh profile already holds
    // 1,500 — GREATEST() changes nothing, so there is nothing to log.
    wireSupabase({
      rpc: {
        data: [{ did_claim: true, old_credits: TIER_CREDITS.free, new_credits: TIER_CREDITS.free, state: "granted" }],
        error: null,
      },
    })
    const res = await claim({})
    expect(res.json()).toEqual({ state: "granted", granted: true })
    expect(mockLogTransaction).not.toHaveBeenCalled()
    expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
  })

  it("reports granted:false when a concurrent claim won the race", async () => {
    wireSupabase({
      rpc: {
        data: [{ did_claim: false, old_credits: TIER_CREDITS.free, new_credits: TIER_CREDITS.free, state: "granted" }],
        error: null,
      },
    })
    const res = await claim({})
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "granted", granted: false })
    expect(mockLogTransaction).not.toHaveBeenCalled()
  })

  it("accepts a bare object row from the RPC as well as a one-row array", async () => {
    wireSupabase({
      rpc: { data: { did_claim: true, old_credits: 0, new_credits: TIER_CREDITS.free, state: "granted" }, error: null },
    })
    const res = await claim({})
    expect(res.json()).toEqual({ state: "granted", granted: true })
  })
})

describe("POST /v1/credits/claim-signup-grant — fingerprints are signals, never gates", () => {
  it.each([
    ["too short", "abc123"],
    ["not hex", "z".repeat(64)],
    ["uppercase hex", "A".repeat(64)],
    ["65 chars", "a".repeat(65)],
    ["a number", 12345],
    ["null", null],
    ["an object", { nested: true }],
  ])("stores null for %s and still claims", async (_label, value) => {
    const doubles = wireSupabase({})
    const res = await claim({ browserKey: value, deviceKey: value })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "granted", granted: true })
    const row = upsertedRow(doubles)
    expect(row.browser_key).toBeNull()
    expect(row.device_key).toBeNull()
  })

  it("judges each key on its own — one garbage key does not discard the other", async () => {
    const doubles = wireSupabase({})
    const res = await claim({ browserKey: 42, deviceKey: OTHER_HEX64 })
    expect(res.statusCode).toBe(200)
    const row = upsertedRow(doubles)
    expect(row.browser_key).toBeNull()
    expect(row.device_key).toBe(OTHER_HEX64)
  })

  it("a KEYLESS claim never overwrites an existing signal row", async () => {
    const doubles = wireSupabase({})
    await claim({})
    expect(doubles.signals.upsert.mock.calls[0]![1]).toEqual({
      onConflict: "user_id,source",
      ignoreDuplicates: true,
    })
  })

  it("claims with no fingerprints at all", async () => {
    const doubles = wireSupabase({})
    const res = await claim({})
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "granted", granted: true })
    const row = upsertedRow(doubles)
    expect(row.browser_key).toBeNull()
    expect(row.device_key).toBeNull()
  })

  it("claims when the JSON body is not an object at all", async () => {
    const doubles = wireSupabase({})
    const res = await app.inject({
      method: "POST",
      url: "/v1/credits/claim-signup-grant",
      headers: {
        "x-test-user-id": TEST_USER_ID,
        "x-forwarded-for": CALLER_IP,
        "content-type": "application/json",
      },
      payload: '"nonsense"',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "granted", granted: true })
    expect(upsertedRow(doubles).browser_key).toBeNull()
  })

  it("claims when there is no body at all", async () => {
    const doubles = wireSupabase({})
    const res = await claim()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "granted", granted: true })
    expect(upsertedRow(doubles).ip_hash).toBe(EXPECTED_IP_HASH)
  })
})

describe("POST /v1/credits/claim-signup-grant — failure modes", () => {
  it("fails OPEN on a signal-insert error: the grant still lands", async () => {
    wireSupabase({ signal: { data: null, error: { message: "signals table missing" } } })
    const res = await claim({ browserKey: HEX64 })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "granted", granted: true })
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it("sanitizes a 500 when the RPC fails", async () => {
    wireSupabase({ rpc: { data: null, error: { message: 'function public.claim_signup_grant does not exist' } } })
    const res = await claim({})
    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
    expect(JSON.stringify(body)).not.toContain("claim_signup_grant")
  })

  it("sanitizes a 500 when the profile read fails", async () => {
    const doubles = wireSupabase({
      profile: { data: null, error: { message: 'column profiles.free_grant_state does not exist' } },
    })
    const res = await claim({})
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(JSON.stringify(res.json())).not.toContain("free_grant_state")
    expect(doubles.signals.upsert).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// PR 2 — the decision reaches the RPC, and the response never explains itself
// ---------------------------------------------------------------------------

const WITHHELD_ROW = { data: [{ did_claim: false, old_credits: 0, new_credits: 0, state: "withheld" }], error: null }

describe("POST /v1/credits/claim-signup-grant — withholding", () => {
  it("withholds an email-only account: RPC told to withhold, no ledger row, state reported", async () => {
    const doubles = wireSupabase({ providers: ["email"], rpc: WITHHELD_ROW })
    const res = await claim({ browserKey: HEX64 })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ state: "withheld", granted: false })
    expect(mockRpc).toHaveBeenCalledWith("claim_signup_grant", {
      p_user_id: TEST_USER_ID,
      p_grant_amount: TIER_CREDITS.free,
      p_withhold: true,
    })
    expect(mockLogTransaction).not.toHaveBeenCalled()
    // The reasons land on the signal row for admin review …
    expect(doubles.signals.update).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "withheld", reasons: ["email_only_provider"] }),
    )
    // … and NEVER in the response body.
    expect(JSON.stringify(res.json())).not.toContain("email_only_provider")
  })

  it("withholds a Google account whose browser already claimed for someone else", async () => {
    wireSupabase({ providers: ["google"], counts: { browser: 1 }, rpc: WITHHELD_ROW })
    const res = await claim({ browserKey: HEX64, deviceKey: OTHER_HEX64 })
    expect(res.json()).toEqual({ state: "withheld", granted: false })
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_withhold: true })
  })

  it("grants a Google account with clean signals", async () => {
    wireSupabase({ providers: ["google"] })
    const res = await claim({ browserKey: HEX64, deviceKey: OTHER_HEX64 })
    expect(res.json()).toEqual({ state: "granted", granted: true })
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_withhold: false })
  })

  it("FAILS OPEN when GoTrue cannot be asked about the providers", async () => {
    wireSupabase({ providers: null })
    const res = await claim({})
    expect(res.json()).toEqual({ state: "granted", granted: true })
    expect(mockRpc.mock.calls[0]![1]).toMatchObject({ p_withhold: false })
  })

  it("counts only OTHER accounts — the claimant's own fresh row is excluded", async () => {
    // A count that included the row just upserted would withhold every first
    // claim from every device. The chain double resolves counts from the
    // filters, so this pins that the policy applies neq(user_id) at all.
    const doubles = wireSupabase({ providers: ["google"] })
    await claim({ browserKey: HEX64, deviceKey: OTHER_HEX64 })
    expect(doubles.signals.select).toHaveBeenCalledWith("user_id", { count: "exact", head: true })
    // browser, device+ip, device, ip velocity — four counts, four exclusions.
    expect(doubles.neqCalls).toHaveLength(4)
    for (const call of doubles.neqCalls) expect(call).toEqual(["user_id", TEST_USER_ID])
  })
})
