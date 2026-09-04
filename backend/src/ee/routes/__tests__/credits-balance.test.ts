import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  hasCredits: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
  },
}))

// The real module statically imports surface-profile.js + config.js, and the
// config mock above exports only `hasCredits` -- pulling that graph in would
// die on a missing export before a single test ran. The route consults exactly
// these two predicates, so mocking them is the whole seam.
vi.mock("@/lib/deployment-payer.js", () => ({
  deploymentPayerActive: vi.fn(),
  deploymentPayerId: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerCreditsBalanceRoutes } from "../credits-balance.js"
import { supabase } from "../../../lib/supabase.js"
import { deploymentPayerActive, deploymentPayerId } from "../../../lib/deployment-payer.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const PAYER_ID = "00000000-0000-4000-8000-0000000009e1"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // clearAllMocks resets CALLS, not implementations -- without these two lines
  // a `mockReturnValue(true)` from one test leaks into every later one.
  vi.mocked(deploymentPayerActive).mockReturnValue(false)
  vi.mocked(deploymentPayerId).mockReturnValue(null)

  app = Fastify({ logger: false })

  // Bypass auth -- set userId from header for protected routes.
  // `authKind` is set ONLY when the header is present: mainline requests in
  // this suite leave it undefined, which is what the byte-identity case needs.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-test-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
    }
    const kind = req.headers["x-test-auth-kind"]
    if (kind && typeof kind === "string") {
      req.authKind = kind as typeof req.authKind
    }
  })

  await registerCreditsBalanceRoutes(app)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function authedGet(url: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { "x-test-user-id": TEST_USER_ID },
  })
}

function getAs(url: string, userId: string, authKind?: string) {
  const headers: Record<string, string> = { "x-test-user-id": userId }
  if (authKind) headers["x-test-auth-kind"] = authKind
  return app.inject({ method: "GET", url, headers })
}

/** A profile row the balance route would happily answer with. */
function mockProfileRow(row: Record<string, unknown>) {
  vi.mocked(supabase.from).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      }),
    }),
  } as never)
}

function activePayer(id = PAYER_ID) {
  vi.mocked(deploymentPayerActive).mockReturnValue(true)
  vi.mocked(deploymentPayerId).mockReturnValue(id)
}

// ---------------------------------------------------------------------------
// GET /v1/credits/balance
// ---------------------------------------------------------------------------

describe("GET /v1/credits/balance", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/credits/balance" })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns total/subscription/topup/tier on success", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { subscription_credits: 100, topup_credits: 50, tier: "pro" },
            error: null,
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/balance")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(150)
    expect(body.subscription).toBe(100)
    expect(body.topup).toBe(50)
    expect(body.tier).toBe("pro")
  })

  it("returns 404 when profile not found", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/balance")
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 500 when supabase errors", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "boom" },
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/balance")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("falls back to 0/0/'free' when columns are null", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { subscription_credits: null, topup_credits: null, tier: null },
            error: null,
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/balance")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({ total: 0, subscription: 0, topup: 0, tier: "free", effectiveTier: "free" })
  })
})

// ---------------------------------------------------------------------------
// GET /v1/credits/balance -- the payer-balance leak (spec D10 / §13.1)
// ---------------------------------------------------------------------------

describe("GET /v1/credits/balance under a deployment payer", () => {
  const PAYER_POOL = { subscription_credits: 4_000_000, topup_credits: 250_000, tier: "business" }

  it("403s payer_balance_jwt_only for the payer via an api_token", async () => {
    activePayer()
    mockProfileRow(PAYER_POOL)

    const res = await getAs("/v1/credits/balance", PAYER_ID, "api_token")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("payer_balance_jwt_only")
    // The pool never appears, in any spelling.
    expect(res.payload).not.toContain("4000000")
    // Closed BEFORE the read -- catches a future "check after lookup" refactor.
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("403s payer_balance_jwt_only for the payer via an app_token (the relay credential)", async () => {
    activePayer()
    mockProfileRow(PAYER_POOL)

    const res = await getAs("/v1/credits/balance", PAYER_ID, "app_token")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("payer_balance_jwt_only")
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("403s when authKind is unset (no credential kind is not a browser session)", async () => {
    activePayer()
    mockProfileRow(PAYER_POOL)

    const res = await getAs("/v1/credits/balance", PAYER_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("payer_balance_jwt_only")
  })

  it("still answers the payer's OWN browser session (jwt) unchanged", async () => {
    activePayer()
    mockProfileRow(PAYER_POOL)

    const res = await getAs("/v1/credits/balance", PAYER_ID, "jwt")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(4_250_000)
    expect(body.subscription).toBe(4_000_000)
    expect(body.topup).toBe(250_000)
  })

  it("is identity-specific: an ordinary user's api_token on a payer instance still gets 200", async () => {
    activePayer()
    mockProfileRow({ subscription_credits: 10, topup_credits: 0, tier: "free" })

    const res = await getAs("/v1/credits/balance", TEST_USER_ID, "api_token")
    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(10)
  })

  it("byte-identical with no deployment payer configured: api_token still gets 200", async () => {
    // deploymentPayerActive() is false (beforeEach default) -- mainline.
    mockProfileRow(PAYER_POOL)

    const res = await getAs("/v1/credits/balance", PAYER_ID, "api_token")
    expect(res.statusCode).toBe(200)
    expect(res.json().total).toBe(4_250_000)
    expect(supabase.from).toHaveBeenCalledWith("profiles")
  })
})

// ---------------------------------------------------------------------------
// GET /v1/credits/transactions
// ---------------------------------------------------------------------------

describe("GET /v1/credits/transactions", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/credits/transactions",
    })
    expect(res.statusCode).toBe(401)
  })

  it("rejects invalid limit with 400", async () => {
    const res = await authedGet("/v1/credits/transactions?limit=abc")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects limit > 50 with 400", async () => {
    const res = await authedGet("/v1/credits/transactions?limit=999")
    expect(res.statusCode).toBe(400)
  })

  it("returns rows + null nextCursor when fewer than limit", async () => {
    const rows = [
      {
        id: "log-1",
        created_at: "2026-04-29T10:00:00Z",
        credits_used: 5,
        action: "generate-image",
        provider: "kie",
        metadata: {},
      },
    ]
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions?limit=20")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // D3: every row gains top-level `payer` / `workspaceId`. These mocked rows
    // carry no workspace_id column, so they are personal.
    expect(body.data).toEqual(rows.map((r) => ({ ...r, payer: "user", workspaceId: null })))
    expect(body.nextCursor).toBeNull()
  })

  it("D3: a workspace-paid row reports payer=workspace and echoes workspaceId", async () => {
    const rows = [
      {
        id: "log-ws",
        created_at: "2026-04-29T10:00:00Z",
        credits_used: 12,
        action: "generate-image",
        provider: "kie",
        metadata: {},
        workspace_id: "b0000000-0000-4000-8000-000000000931",
      },
    ]
    // Spy on `.select(...)` so the mutant "drop workspace_id from the select"
    // (which stays green when the mock bakes the column into `rows`) is caught.
    const selectSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    })
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({ select: selectSpy } as never)

    const res = await authedGet("/v1/credits/transactions?limit=20")
    expect(res.statusCode).toBe(200)
    // The route MUST select workspace_id — derivation is from the COLUMN.
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining("workspace_id"))
    const item = res.json().data[0]
    expect(item.payer).toBe("workspace")
    expect(item.workspaceId).toBe("b0000000-0000-4000-8000-000000000931")
    // The snake_case column is dropped; only the camelCase field is public.
    expect(item).not.toHaveProperty("workspace_id")
  })

  it("D3: payer comes from the COLUMN, not metadata.payer (allowlist strips the latter)", async () => {
    const rows = [
      {
        id: "log-meta",
        created_at: "2026-04-29T10:00:00Z",
        credits_used: 4,
        action: "generate-image",
        provider: "kie",
        // A workspace payer stamped ONLY in metadata, with a NULL column.
        metadata: { payer: { kind: "workspace", workspaceId: "b0000000-0000-4000-8000-000000000931" } },
        workspace_id: null,
      },
    ]
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions?limit=20")
    expect(res.statusCode).toBe(200)
    const item = res.json().data[0]
    // Column is NULL, so payer is "user" regardless of metadata; and the
    // economics allowlist strips metadata.payer.
    expect(item.payer).toBe("user")
    expect(item.workspaceId).toBeNull()
    expect(item.metadata).not.toHaveProperty("payer")
  })

  it("D3: a personal row reports payer=user and workspaceId=null", async () => {
    const rows = [
      {
        id: "log-personal",
        created_at: "2026-04-29T10:00:00Z",
        credits_used: 3,
        action: "generate-image",
        provider: "kie",
        metadata: {},
        workspace_id: null,
      },
    ]
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions?limit=20")
    expect(res.statusCode).toBe(200)
    const item = res.json().data[0]
    expect(item.payer).toBe("user")
    expect(item.workspaceId).toBeNull()
    expect(item).not.toHaveProperty("workspace_id")
  })

  it("returns nextCursor when results fill the limit", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `log-${i}`,
      created_at: `2026-04-29T10:0${i}:00Z`,
      credits_used: 1,
      action: "generate-image",
      provider: "kie",
      metadata: {},
    }))
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions?limit=5")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(5)
    expect(body.nextCursor).toBe("2026-04-29T10:04:00Z")
  })

  it("applies cursor as a created_at upper bound when present", async () => {
    const ltSpy = vi.fn().mockResolvedValue({ data: [], error: null })
    const limitSpy = vi.fn().mockReturnValue({ lt: ltSpy })
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: limitSpy,
          }),
        }),
      }),
    } as never)

    const res = await authedGet(
      "/v1/credits/transactions?limit=10&cursor=2026-04-29T10:00:00Z",
    )
    expect(res.statusCode).toBe(200)
    expect(ltSpy).toHaveBeenCalledWith("created_at", "2026-04-29T10:00:00Z")
  })

  it("returns 500 when supabase errors", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("PR9: carries the usage_logs.status lifecycle column on each row", async () => {
    const rows = [
      {
        id: "log-refunded",
        created_at: "2026-04-29T10:00:00Z",
        credits_used: 5,
        action: "generate-video",
        provider: "kie",
        status: "refunded",
        metadata: {},
      },
    ]
    const selectSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    })
    vi.mocked(supabase.from).mockReturnValue({ select: selectSpy } as never)

    const res = await authedGet("/v1/credits/transactions?limit=20")
    expect(res.statusCode).toBe(200)
    // The route MUST select status — a mock that bakes the column into `rows`
    // without the route actually asking for it would stay green otherwise.
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining("status"))
    expect(res.json().data[0].status).toBe("refunded")
  })

  it("strips Nodaro's USD valuation from metadata, both spellings", async () => {
    const rows = [
      {
        id: "log-1",
        created_at: "2026-04-29T10:00:00Z",
        credits_used: 5,
        action: "generate-image",
        provider: "kie",
        metadata: {
          model: "nano-banana",
          from_sub: 5,
          from_topup: 0,
          display_cost: 0.01, // reserve_credits' spelling (311:151)
          display_cost_usd: 0.01, // the zero-cost bypass spelling (credits.ts:2114)
          some_future_key: "leak", // an allowlist hides new keys by default
        },
      },
    ]
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions?limit=20")
    expect(res.statusCode).toBe(200)
    const [tx] = res.json().data
    expect(tx.metadata).toEqual({ model: "nano-banana", from_sub: 5, from_topup: 0 })
    expect(JSON.stringify(res.json())).not.toContain("display_cost")
    // the surviving top-level columns are untouched
    expect(tx.id).toBe("log-1")
    expect(tx.credits_used).toBe(5)
  })

  it("keeps `metadata` a present object when the row has none", async () => {
    const rows = [
      {
        id: "log-2",
        created_at: "2026-04-29T11:00:00Z",
        credits_used: 3,
        action: "generate-image",
        provider: "kie",
        metadata: null,
      },
    ]
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions?limit=20")
    expect(res.statusCode).toBe(200)
    // the documented Transaction.metadata field must not vanish
    expect(res.json().data[0].metadata).toEqual({})
  })

  it("still paginates after projection (cursor reads created_at off the last item)", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `log-${i}`,
      created_at: `2026-04-29T12:0${i}:00Z`,
      credits_used: 1,
      action: "generate-image",
      provider: "kie",
      metadata: { display_cost: 0.02, from_sub: 1 }, // banned key present
    }))
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions?limit=5")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.nextCursor).toBe("2026-04-29T12:04:00Z")
    expect(JSON.stringify(body)).not.toContain("display_cost")
  })
})

// ---------------------------------------------------------------------------
// hasCredits() gating
// ---------------------------------------------------------------------------

describe("registerCreditsBalanceRoutes self-hosted gating", () => {
  it("does not register routes when hasCredits() returns false", async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ hasCredits: () => false }))
    const mod = await import("../credits-balance.js")

    const localApp = Fastify({ logger: false })
    localApp.addHook("preHandler", async (req) => {
      req.userId = TEST_USER_ID
    })
    await mod.registerCreditsBalanceRoutes(localApp)
    await localApp.ready()

    const res = await localApp.inject({ method: "GET", url: "/v1/credits/balance" })
    expect(res.statusCode).toBe(404)
    await localApp.close()

    vi.doUnmock("@/lib/config.js")
  })
})
