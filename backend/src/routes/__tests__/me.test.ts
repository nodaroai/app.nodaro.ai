import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { meRoutes } from "../me.js"
import { supabase } from "../../lib/supabase.js"
import { __resetDeploymentPayerForTests, __setDeploymentPayerForTests } from "../../lib/deployment-payer.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

/** Wire the mocked supabase chain `.from().select().eq().single()` → result. */
function mockProfileSingle(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
  return { single, eq, select }
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from the `x-user-id` header (the auth middleware
  // sets req.userId for both Supabase JWTs and OAuth tokens).
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (userId && typeof userId === "string") {
      req.userId = userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await meRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests — GET /v1/me
// ---------------------------------------------------------------------------

describe("GET /v1/me", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" })

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe("Authentication required")
  })

  it("returns 404 when profile not found", async () => {
    mockProfileSingle({ data: null, error: { message: "not found" } })

    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe("Profile not found")
  })

  it("returns the mapped identity on success (full_name → displayName)", async () => {
    mockProfileSingle({
      data: {
        id: TEST_USER_ID,
        email: "ada@example.com",
        // display_name does not exist on profiles — the name lives in full_name
        full_name: "Ada Lovelace",
        avatar_url: "https://cdn.example.com/ada.png",
        subscription_tier: "pro",
      },
      error: null,
    })

    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      id: TEST_USER_ID,
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      avatarUrl: "https://cdn.example.com/ada.png",
      tier: "pro",
      isAdmin: false,
    })
  })

  it.each(["admin", "super_admin"])("surfaces isAdmin: true for role %s (descriptive only)", async (role) => {
    mockProfileSingle({
      data: {
        id: TEST_USER_ID,
        email: "ops@example.com",
        full_name: "Ops",
        avatar_url: null,
        subscription_tier: "pro",
        role,
      },
      error: null,
    })

    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.isAdmin).toBe(true)
  })

  it("coalesces null name/avatar/tier to sensible defaults", async () => {
    mockProfileSingle({
      data: {
        id: TEST_USER_ID,
        email: "anon@example.com",
        full_name: null,
        avatar_url: null,
        subscription_tier: null,
      },
      error: null,
    })

    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      id: TEST_USER_ID,
      email: "anon@example.com",
      displayName: null,
      avatarUrl: null,
      tier: "free",
      isAdmin: false,
    })
  })
})

describe("GET /v1/me under a deployment payer (decided 2026-11-08)", () => {
  const PAYER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  const storedFree = { id: TEST_USER_ID, email: "ada@example.com", full_name: null, avatar_url: null, tier: "free", subscription_tier: "free" }
  const getMe = () => app.inject({ method: "GET", url: "/v1/me", headers: { "x-user-id": TEST_USER_ID } })
  afterEach(() => __resetDeploymentPayerForTests())

  it("reports the payer account's plan, not the free tier every user there is stored at", async () => {
    __setDeploymentPayerForTests(PAYER, { tierForGates: "pro" })
    mockProfileSingle({ data: storedFree, error: null })
    expect((await getMe()).json().data.tier).toBe("pro")
  })

  it("a payg payer reads as free: payg is never a stored tier", async () => {
    __setDeploymentPayerForTests(PAYER, { tierForGates: "payg" })
    mockProfileSingle({ data: storedFree, error: null })
    expect((await getMe()).json().data.tier).toBe("free")
  })
})
