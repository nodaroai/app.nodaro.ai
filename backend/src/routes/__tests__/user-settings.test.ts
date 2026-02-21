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

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/config/prompt-templates.js", () => ({
  SYSTEM_PROMPT_TEMPLATES: {
    "character-description": "Include character '{name}': {description}.",
    "generate-image-wrapper": "{userPrompt}\n{assetDescriptions}",
  },
  applyTemplate: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { userSettingsRoutes } from "../user-settings.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body or query for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    const query = req.query as Record<string, unknown> | undefined
    const userId = body?.userId ?? query?.userId
    if (userId && typeof userId === "string") {
      req.userId = userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await userSettingsRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests — GET /v1/user/settings
// ---------------------------------------------------------------------------

describe("GET /v1/user/settings", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/user/settings",
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error).toBe("Authentication required")
  })

  it("returns 404 when profile not found", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "not found" },
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/user/settings?userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(404)
    const body = res.json()
    expect(body.error).toBe("Profile not found")
  })

  it("returns settings on success", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        tier: "standard",
        public_outputs: false,
        prompt_templates: { "character-description": "Custom template" },
      },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/user/settings?userId=${TEST_USER_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.tier).toBe("standard")
    expect(body.data.publicOutputs).toBe(false)
    expect(body.data.promptTemplates).toEqual({ "character-description": "Custom template" })
  })
})

// ---------------------------------------------------------------------------
// Tests — PATCH /v1/user/settings
// ---------------------------------------------------------------------------

describe("PATCH /v1/user/settings", () => {
  it("free tier cannot disable publicOutputs", async () => {
    // Mock profile lookup returning free tier
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        tier: "free",
        public_outputs: true,
        prompt_templates: {},
      },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/user/settings",
      payload: {
        userId: TEST_USER_ID,
        publicOutputs: false,
      },
    })

    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.error).toContain("Private mode")
  })
})
