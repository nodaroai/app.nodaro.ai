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
    PUBLIC_URL: "https://app.nodaro.ai",
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { embedRoutes } from "../embed.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockPublishedAppLookup(result: { data: unknown; error: unknown }) {
  const mockSingle = vi.fn().mockResolvedValue(result)
  const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
  const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
  return { select: mockSelect } as never
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  await app.register(async (instance) => {
    await embedRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// GET /v1/embed/:slug
// ---------------------------------------------------------------------------

describe("GET /v1/embed/:slug", () => {
  it("returns 404 when app not found", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      mockPublishedAppLookup({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      })
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/embed/my-cool-app",
    })
    expect(res.statusCode).toBe(404)
    expect(res.body).toBe("App not found")
  })

  it("returns 403 when not embeddable", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      mockPublishedAppLookup({
        data: {
          id: "00000000-0000-4000-8000-000000000010",
          slug: "my-cool-app",
          is_embeddable: false,
          allowed_origins: [],
        },
        error: null,
      })
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/embed/my-cool-app",
    })
    expect(res.statusCode).toBe(403)
    expect(res.body).toBe("This app does not allow embedding")
  })

  it("returns 403 when allowed_origins is empty", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      mockPublishedAppLookup({
        data: {
          id: "00000000-0000-4000-8000-000000000010",
          slug: "my-cool-app",
          is_embeddable: true,
          allowed_origins: [],
        },
        error: null,
      })
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/embed/my-cool-app",
    })

    expect(res.statusCode).toBe(403)
    expect(res.body).toContain("Embedding requires an allowed domains list")
  })

  it("returns 200 with custom allowed_origins in CSP", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      mockPublishedAppLookup({
        data: {
          id: "00000000-0000-4000-8000-000000000010",
          slug: "my-cool-app",
          is_embeddable: true,
          allowed_origins: ["https://example.com", "https://other.dev"],
        },
        error: null,
      })
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/embed/my-cool-app",
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-security-policy"]).toBe(
      "frame-ancestors https://example.com https://other.dev"
    )
  })

  it("returns 200 with theme query param forwarded", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      mockPublishedAppLookup({
        data: {
          id: "00000000-0000-4000-8000-000000000010",
          slug: "my-cool-app",
          is_embeddable: true,
          allowed_origins: ["https://example.com"],
        },
        error: null,
      })
    )

    const res = await app.inject({
      method: "GET",
      url: "/v1/embed/my-cool-app?theme=light",
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain("theme=light")
    // Should NOT contain theme=dark when light is specified
    expect(res.body).not.toContain("theme=dark")
  })
})
