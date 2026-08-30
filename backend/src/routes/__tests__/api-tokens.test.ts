import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const { mockOrchestrationQueueAdd, mockResolveToken } = vi.hoisted(() => ({
  mockOrchestrationQueueAdd: vi.fn().mockResolvedValue({ id: "orch-job-1" }),
  mockResolveToken: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/api-token-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-token-resolver.js")>()
  return { ...actual, resolveApiToken: mockResolveToken }
})

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: {
    add: mockOrchestrationQueueAdd,
  },
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  CreditsService: {
    getModelCreditCost: vi.fn().mockResolvedValue(5),
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { apiTokenRoutes } from "../api-tokens.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_TOKEN_ID = "00000000-0000-4000-8000-000000000099"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth -- set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await apiTokenRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authedPost(url: string, payload: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url,
    headers: { "x-user-id": TEST_USER_ID },
    payload,
  })
}

function authedGet(url: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { "x-user-id": TEST_USER_ID },
  })
}

function authedPatch(url: string, payload: Record<string, unknown> = {}) {
  return app.inject({
    method: "PATCH",
    url,
    headers: { "x-user-id": TEST_USER_ID },
    payload,
  })
}

function authedDelete(url: string) {
  return app.inject({
    method: "DELETE",
    url,
    headers: { "x-user-id": TEST_USER_ID },
  })
}

// Chain builder for supabase mock
function chainMock(finalValue: { data: unknown; error: unknown; count?: number }) {
  const self: Record<string, unknown> = {}
  const proxy = new Proxy(self, {
    get(_target, prop) {
      if (prop === "then") return undefined
      if (prop === "single" || prop === "maybeSingle") return vi.fn().mockResolvedValue(finalValue)
      return vi.fn().mockReturnValue(
        new Proxy({}, {
          get(_t2, p2) {
            if (p2 === "then") return undefined
            if (p2 === "single" || p2 === "maybeSingle") return vi.fn().mockResolvedValue(finalValue)
            return vi.fn().mockReturnValue(
              new Proxy({}, {
                get(_t3, p3) {
                  if (p3 === "then") return undefined
                  if (p3 === "single" || p3 === "maybeSingle") return vi.fn().mockResolvedValue(finalValue)
                  return vi.fn().mockResolvedValue(finalValue)
                },
              })
            )
          },
        })
      )
    },
  })
  return proxy
}

// ==========================================================================
// POST /v1/api-tokens (Create token)
// ==========================================================================

describe("POST /v1/api-tokens", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/api-tokens",
      payload: { name: "My Token" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 400 for missing name", async () => {
    const res = await authedPost("/v1/api-tokens", {})
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for empty name", async () => {
    const res = await authedPost("/v1/api-tokens", { name: "" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when max 10 tokens reached", async () => {
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        // Count query: from().select("id", { count, head }).eq("user_id", ...)
        // The .eq() call resolves directly to { count, data, error }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null, count: 10 }),
          }),
        } as never
      }
      return chainMock({ data: null, error: null }) as never
    })

    const res = await authedPost("/v1/api-tokens", { name: "My Token" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("limit_reached")
  })

  it("returns 201 on success with token plaintext", async () => {
    const tokenRow = {
      id: TEST_TOKEN_ID,
      name: "My Token",
      token_prefix: "ndr_abcd...",
      workflow_ids: [],
      rate_limit: 30,
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
    }

    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        return chainMock({ data: null, error: null, count: 2 }) as never
      }
      return chainMock({ data: tokenRow, error: null }) as never
    })

    const res = await authedPost("/v1/api-tokens", { name: "My Token" })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.data.name).toBe("My Token")
    expect(body.data.token).toMatch(/^ndr_/)
    expect(body.data.id).toBe(TEST_TOKEN_ID)
  })

  it("returns 400 for invalid workflowIds (not owned)", async () => {
    const fakeWfId = "00000000-0000-4000-8000-000000000099"

    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        return chainMock({ data: null, error: null, count: 0 }) as never
      }
      return {
        select: vi.fn().mockReturnValue({
          // .eq("user_id") -> .is("workspace_id", null) -> .in("id", …):
          // a token binds to personal workflows only, so the ownership check
          // filters the workspace half out before it looks at the ids.
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      } as never
    })

    const res = await authedPost("/v1/api-tokens", {
      name: "My Token",
      workflowIds: [fakeWfId],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_workflow")
  })
})

// ==========================================================================
// GET /v1/api-tokens (List tokens)
// ==========================================================================

describe("GET /v1/api-tokens", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/api-tokens",
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 200 with empty token list", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/api-tokens")
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })

  it("returns 200 with token data", async () => {
    const tokenRow = {
      id: TEST_TOKEN_ID,
      name: "My Token",
      token_prefix: "ndr_abcd...",
      workflow_ids: [],
      rate_limit: 30,
      is_active: true,
      last_used_at: null,
      created_at: "2026-01-01T00:00:00Z",
    }

    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [tokenRow], error: null }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/api-tokens")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe(TEST_TOKEN_ID)
    expect(body.data[0].prefix).toBe("ndr_abcd...")
    expect(body.data[0].isActive).toBe(true)
  })
})

// ==========================================================================
// PATCH /v1/api-tokens/:id (Update token)
// ==========================================================================

describe("PATCH /v1/api-tokens/:id", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/api-tokens/${TEST_TOKEN_ID}`,
      payload: { name: "Updated" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await authedPatch("/v1/api-tokens/not-a-uuid", { name: "Updated" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 404 when token not found (PGRST116)", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: "PGRST116", message: "not found" },
              }),
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedPatch(`/v1/api-tokens/${TEST_TOKEN_ID}`, { name: "Updated" })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 on name update", async () => {
    const updatedRow = {
      id: TEST_TOKEN_ID,
      name: "Updated",
      token_prefix: "ndr_abcd...",
      workflow_ids: [],
      rate_limit: 30,
      is_active: true,
      last_used_at: null,
      created_at: "2026-01-01T00:00:00Z",
    }

    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updatedRow, error: null }),
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedPatch(`/v1/api-tokens/${TEST_TOKEN_ID}`, { name: "Updated" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.name).toBe("Updated")
  })

  it("returns 200 on isActive toggle", async () => {
    const updatedRow = {
      id: TEST_TOKEN_ID,
      name: "My Token",
      token_prefix: "ndr_abcd...",
      workflow_ids: [],
      rate_limit: 30,
      is_active: false,
      last_used_at: null,
      created_at: "2026-01-01T00:00:00Z",
    }

    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updatedRow, error: null }),
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedPatch(`/v1/api-tokens/${TEST_TOKEN_ID}`, { isActive: false })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.isActive).toBe(false)
  })
})

// ==========================================================================
// DELETE /v1/api-tokens/:id
// ==========================================================================

describe("DELETE /v1/api-tokens/:id", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/api-tokens/${TEST_TOKEN_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await authedDelete("/v1/api-tokens/not-a-uuid")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  // .delete().eq().eq().select("id") — the route reads the deleted rows back
  // and answers 404 when the owner scope matched nothing (#699).
  const deleteChain = (result: { data: unknown[] | null; error: unknown }) => ({
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue(result) }),
      }),
    }),
  })

  it("returns success on valid delete", async () => {
    vi.mocked(supabase.from).mockReturnValue(deleteChain({ data: [{ id: TEST_TOKEN_ID }], error: null }) as never)

    const res = await authedDelete(`/v1/api-tokens/${TEST_TOKEN_ID}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("returns 404 when the scoped delete matched nothing (someone else's token)", async () => {
    vi.mocked(supabase.from).mockReturnValue(deleteChain({ data: [], error: null }) as never)

    const res = await authedDelete(`/v1/api-tokens/${TEST_TOKEN_ID}`)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(supabase.from).mockReturnValue(deleteChain({ data: null, error: { message: "DB error" } }) as never)

    const res = await authedDelete(`/v1/api-tokens/${TEST_TOKEN_ID}`)
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ==========================================================================
// Zod schema validation edge cases
// ==========================================================================

describe("Zod validation edge cases", () => {
  it("rejects create with name > 100 chars", async () => {
    const res = await authedPost("/v1/api-tokens", { name: "a".repeat(101) })
    expect(res.statusCode).toBe(400)
  })

  it("rejects create with rateLimit > 120", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockImplementation(() => {
      return chainMock({ data: null, error: null, count: 0 }) as never
    })

    const res = await authedPost("/v1/api-tokens", { name: "Test", rateLimit: 200 })
    expect(res.statusCode).toBe(400)
  })

  it("rejects create with rateLimit < 1", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockImplementation(() => {
      return chainMock({ data: null, error: null, count: 0 }) as never
    })

    const res = await authedPost("/v1/api-tokens", { name: "Test", rateLimit: 0 })
    expect(res.statusCode).toBe(400)
  })

  it("rejects create with invalid UUID in workflowIds", async () => {
    const res = await authedPost("/v1/api-tokens", {
      name: "Test",
      workflowIds: ["not-a-uuid"],
    })
    expect(res.statusCode).toBe(400)
  })

  it("rejects create with > 50 workflowIds", async () => {
    const ids = Array.from({ length: 51 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    )
    const res = await authedPost("/v1/api-tokens", { name: "Test", workflowIds: ids })
    expect(res.statusCode).toBe(400)
  })
})

// ==========================================================================
// Privilege-escalation guard: API-token management is JWT-only.
// An OAuth app token (any scope) must NOT be able to mint a personal API token
// (which is unscoped → every requireScope becomes a no-op → account takeover).
// ==========================================================================

describe("api-token management rejects programmatic tokens", () => {
  async function appWithAuth(mut: (req: FastifyRequest) => void): Promise<FastifyInstance> {
    const a = Fastify({ logger: false })
    a.addHook("preHandler", async (req) => { mut(req) })
    await a.register(async (i) => { await apiTokenRoutes(i) })
    await a.ready()
    return a
  }

  const ID = "00000000-0000-4000-8000-000000000099"

  it("POST /v1/api-tokens returns 403 for an OAuth app token (cannot mint a personal token)", async () => {
    const app2 = await appWithAuth((req) => {
      req.userId = TEST_USER_ID
      req.appAuthorization = { appId: "a", authorizationId: "z", scopes: ["jobs:read"] }
    })
    const res = await app2.inject({ method: "POST", url: "/v1/api-tokens", payload: { name: "evil" } })
    expect(res.statusCode).toBe(403)
    await app2.close()
  })

  it("POST /v1/api-tokens returns 403 for a personal API token", async () => {
    const app2 = await appWithAuth((req) => {
      req.userId = TEST_USER_ID
      req.apiToken = { userId: TEST_USER_ID } as unknown as FastifyRequest["apiToken"]
    })
    const res = await app2.inject({ method: "POST", url: "/v1/api-tokens", payload: { name: "x" } })
    expect(res.statusCode).toBe(403)
    await app2.close()
  })

  it("GET / PATCH / DELETE /v1/api-tokens also reject OAuth app tokens", async () => {
    const app2 = await appWithAuth((req) => {
      req.userId = TEST_USER_ID
      req.appAuthorization = { appId: "a", authorizationId: "z", scopes: ["jobs:read"] }
    })
    expect((await app2.inject({ method: "GET", url: "/v1/api-tokens" })).statusCode).toBe(403)
    expect((await app2.inject({ method: "PATCH", url: `/v1/api-tokens/${ID}`, payload: { name: "n" } })).statusCode).toBe(403)
    expect((await app2.inject({ method: "DELETE", url: `/v1/api-tokens/${ID}` })).statusCode).toBe(403)
    await app2.close()
  })
})

// ==========================================================================
// POST /v1/api/run — the external token lane
// ==========================================================================

describe("POST /v1/api/run — token runs are PERSONAL-ONLY (P9 doctrine, enforced at run time)", () => {
  it("a workspace-homed workflow is unreachable: the lookup filters workspace_id IS NULL and answers 404", async () => {
    mockResolveToken.mockResolvedValue({
      id: TEST_TOKEN_ID,
      userId: TEST_USER_ID,
      workflowIds: [],
      rateLimit: 60,
      tokenHash: "th-run-scope",
      workspaceId: null,
    })

    const isCalls: unknown[][] = []
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "eq", "in", "order", "limit", "lt"]) {
        chain[m] = vi.fn().mockReturnValue(chain)
      }
      chain.is = vi.fn().mockImplementation((...args: unknown[]) => {
        isCalls.push(args)
        return chain
      })
      chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
      return chain as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/api/run",
      headers: { authorization: "Bearer ndr_test_token" },
      payload: { workflowId: "00000000-0000-4000-8000-000000000042" },
    })

    expect(res.statusCode).toBe(404)
    // The pin: the ownership lookup carries the personal-only filter — drop
    // the .is("workspace_id", null) (bind and list always had it; the run
    // route gained it in the P14 stage-9 review) and this goes red.
    expect(isCalls).toContainEqual(["workspace_id", null])
    expect(mockOrchestrationQueueAdd).not.toHaveBeenCalled()
  })
})
