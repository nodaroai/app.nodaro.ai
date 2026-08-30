// P14/W4b+W4c — the SCOPE RULE for the workspace entitlement override.
//
// A route that installs `creditGuard` but never reserves in-request must
// keep a PERSONAL preflight: a workspace context there would bypass the
// personal-balance comparison, the request reserves nothing, and nobody —
// not the member, not the workspace — ever pays. A free proxy.
//
// The set is SMALL and every candidate must be verified by reading the
// route's whole spend chain, not by scanning for a call name: the LLM
// caption routes look check-only and are NOT — they reserve through the
// `meterSyncLlm` indirection, so check-then-charge must agree on the payer
// and they take the default (payer-aware) guard.
//
// The mechanism (W4c): `creditGuard(resolver, { checkOnly: true })` keeps the
// preflight PERSONAL; every other guard threads `req.billingContext` into the
// preflight so a reserving route's zero-balance class member is not refused
// for a personal balance the workspace covers.
//
// Three guards below:
//   1. A pinned enumeration of the no-in-request-reserve set — a NEW route
//      of that shape fails the equality and must be classified consciously.
//   2. EVERY `creditGuard` install in a pinned file carries `checkOnly: true`
//      — counted per install, not substring-matched per file.
//   3. Behavioral, both shapes: a default guard honors a workspace context;
//      a checkOnly guard stays personal and still 402s.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const { mockFrom, tableResponses } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  function createChain(response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    }
  }
  const mockFrom = vi.fn().mockImplementation((table: string) =>
    createChain(tableResponses.get(table) ?? null),
  )
  return { mockFrom, tableResponses }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}))

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import { creditGuardImpl, reserveCreditsForJobImpl } from "../credit-guard-impl.js"
import { CreditsService } from "../../billing/credits.js"
import type { BillingContext } from "../../../lib/billing-context.js"

// ---------------------------------------------------------------------------
// Halves 1+2 — the pinned check-only set
// ---------------------------------------------------------------------------

// Route-registration dirs only, on purpose: creditGuard is a route
// preHandler. (A guard installed from anywhere else would be a convention
// break for review, not for this scanner.)
const ROUTE_DIRS = [
  join(__dirname, "..", "..", "..", "routes"),
  join(__dirname, "..", "..", "routes"),
]

/**
 * Routes that install creditGuard and never reserve in-request:
 * - nodaro-exclusive.ts registers only when !hasCredits() — its guard is a
 *   shape-parity pass-through; the cloud versions live in the plugin and
 *   reserve in-request there (default guard, payer-aware).
 * - save-to-storage.ts is a zero-cost storage-quota check.
 * The four LLM caption routes are NOT here on purpose: they reserve through
 * `meterSyncLlm` (an indirection the first draft of this scanner missed and
 * misclassified — the review caught it), so the default payer-aware guard is
 * correct for them.
 */
const CHECK_ONLY_ROUTES = ["nodaro-exclusive.ts", "save-to-storage.ts"].sort()

/**
 * Markers whose presence means the route DOES reserve in-request. The
 * substring scan cannot see through an indirection, so every wrapper that
 * reserves on behalf of a route handler must be listed here — and
 * `meter-sync-llm.ts` carries a comment pointing new wrappers back at this
 * list.
 */
const RESERVE_MARKERS = ["reserveCreditsForJob", "reserveCredits(", "meterSyncLlm("]

function scanCheckOnlyRoutes(): string[] {
  const found: string[] = []
  for (const dir of ROUTE_DIRS) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue
      const source = readFileSync(join(dir, file), "utf8")
      if (!source.includes("creditGuard(")) continue
      if (RESERVE_MARKERS.some((m) => source.includes(m))) continue
      found.push(file)
    }
  }
  return found.sort()
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe("check-only creditGuard routes (P14 scope rule)", () => {
  it("the check-only set is exactly the pinned list — a new member must be classified here", () => {
    expect(scanCheckOnlyRoutes()).toEqual(CHECK_ONLY_ROUTES)
  })

  it("EVERY creditGuard install in a pinned check-only route opts out via checkOnly: true", () => {
    let seen = 0
    for (const dir of ROUTE_DIRS) {
      for (const file of readdirSync(dir)) {
        if (!CHECK_ONLY_ROUTES.includes(file)) continue
        seen++
        const source = readFileSync(join(dir, file), "utf8")
        const installs = countOf(source, "creditGuard(")
        const optOuts = countOf(source, "checkOnly: true")
        expect(installs, `${file} must install creditGuard at least once`).toBeGreaterThan(0)
        expect(optOuts, `${file}: every creditGuard install must carry checkOnly: true — see this test's header`).toBe(installs)
      }
    }
    expect(seen).toBe(CHECK_ONLY_ROUTES.length)
  })
})

// ---------------------------------------------------------------------------
// Half 3 — behavioral, both shapes
// ---------------------------------------------------------------------------

const WS_CTX: BillingContext = {
  payer: "workspace",
  userId: "user-123",
  workspaceId: "ws-1",
  orgId: "org-1",
  memberCap: null,
  entitlements: {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business",
    freeTierBlocklist: false,
    webFreeMode: false,
    appCreditsAllowance: false,
  },
}

function zeroBalanceWorld(): void {
  tableResponses.set("profiles", {
    data: {
      role: "user",
      tier: "free",
      subscription_tier: null,
      lifetime_topup_credits: 0,
      subscription_credits: 0,
      topup_credits: 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString().slice(0, 10),
      storage_used_bytes: 0,
      storage_limit_bytes: 1_000_000_000,
    },
    error: null,
  })
  tableResponses.set("model_pricing", {
    data: { credit_cost: 5, is_enabled: true, tier_restriction: null },
    error: null,
  })
}

function makeReply() {
  const sent: Array<{ status: number; body: unknown }> = []
  return {
    sent,
    reply: {
      status(code: number) {
        return { send: (body: unknown) => { sent.push({ status: code, body }) } }
      },
    },
  }
}

function makeReq(): Record<string, unknown> {
  return {
    userId: "user-123",
    url: "/v1/generate-image",
    headers: {},
    body: {},
    billingContext: WS_CTX,
  }
}

describe("creditGuardImpl — the override follows the reservation, never the wealth check", () => {
  beforeEach(() => {
    tableResponses.clear()
    mockFrom.mockClear()
  })

  it("a RESERVING route's guard honors the workspace context: zero balance passes, unwatermarked", async () => {
    zeroBalanceWorld()
    const guard = creditGuardImpl(() => "flux")
    const { sent, reply } = makeReply()
    const req = makeReq()

    await guard(req as never, reply as never)

    expect(sent).toHaveLength(0)
    expect((req.creditReservation as { watermark: boolean }).watermark).toBe(false)
  })

  it("a checkOnly route's guard stays PERSONAL: the same request still 402s", async () => {
    zeroBalanceWorld()
    const guard = creditGuardImpl(() => "flux", { checkOnly: true })
    const { sent, reply } = makeReply()

    await guard(makeReq() as never, reply as never)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.status).toBe(402)
    expect((sent[0]?.body as { error: { code: string } }).error.code).toBe("insufficient_credits")
  })

  it("reserveCreditsForJobImpl carries the request's resolved payer onto the reservation", async () => {
    const reserveSpy = vi.spyOn(CreditsService, "reserveCredits").mockResolvedValue({
      usageLogId: "log-1",
      creditsReserved: 5,
      watermark: false,
    })
    try {
      const { reply } = makeReply()
      await reserveCreditsForJobImpl(makeReq() as never, reply as never, "job-1", "flux")
      expect(reserveSpy).toHaveBeenCalledWith(
        "user-123",
        "job-1",
        "flux",
        0,
        0,
        expect.objectContaining({ billingContext: WS_CTX }),
      )
    } finally {
      reserveSpy.mockRestore()
    }
  })
})
