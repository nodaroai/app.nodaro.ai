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
    ANTHROPIC_API_KEY: "test-anthropic-key",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/billing/credits.js", () => ({
  CreditsService: {
    commitCredits: vi.fn().mockResolvedValue(undefined),
    refundCredits: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("@/lib/anthropic.js", () => ({
  getAnthropicClient: vi.fn(),
  CLAUDE_MODEL: "claude-test",
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { imageToTextRoutes } from "../image-to-text.js"
import { supabase } from "../../lib/supabase.js"
import { getAnthropicClient } from "../../lib/anthropic.js"
import { CreditsService } from "../../billing/credits.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_UUID = "00000000-0000-4000-8000-000000000001"

const VALID_PAYLOAD = {
  imageUrl: "https://example.com/photo.jpg",
  userId: VALID_UUID,
}

const MOCK_ANTHROPIC_RESPONSE = {
  content: [{ type: "text", text: "A beautiful sunset over the ocean" }],
  usage: { input_tokens: 100, output_tokens: 50 },
}

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await imageToTextRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupSuccessDbMocks() {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert, update: mockUpdate } as never)
  return { mockInsert, mockUpdate, mockEq }
}

function setupAnthropicMock(response = MOCK_ANTHROPIC_RESPONSE) {
  const mockCreate = vi.fn().mockResolvedValue(response)
  vi.mocked(getAnthropicClient).mockReturnValue({
    messages: { create: mockCreate },
  } as never)
  return { mockCreate }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/image-to-text/describe", () => {
  it("returns 400 when imageUrl is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: { userId: VALID_UUID },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 when imageUrl is not a valid URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: { imageUrl: "not-a-url", userId: VALID_UUID },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: { imageUrl: "https://example.com/photo.jpg" },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("returns 503 when ANTHROPIC_API_KEY is empty", async () => {
    const { config } = await import("../../lib/config.js")
    const original = config.ANTHROPIC_API_KEY
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = ""

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: VALID_PAYLOAD,
    })

    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = original

    expect(res.statusCode).toBe(503)
    const body = res.json()
    expect(body.error.code).toBe("provider_unavailable")
  })

  it("returns 200 with generatedText on happy path", async () => {
    setupSuccessDbMocks()
    setupAnthropicMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: VALID_PAYLOAD,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.generatedText).toBe("A beautiful sunset over the ocean")

    // Verify credits were committed
    expect(CreditsService.commitCredits).toHaveBeenCalledWith("usage-1")
  })

  it("inserts job with correct input_data", async () => {
    const { mockInsert } = setupSuccessDbMocks()
    setupAnthropicMock()

    await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: {
        imageUrl: "https://example.com/photo.jpg",
        detailLevel: "brief",
        userId: VALID_UUID,
      },
    })

    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith("jobs")
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: VALID_UUID,
        status: "pending",
        input_data: expect.objectContaining({
          type: "image-to-text",
          imageUrl: "https://example.com/photo.jpg",
          detailLevel: "brief",
        }),
      })
    )
  })

  it("uses customPrompt as system prompt when provided", async () => {
    setupSuccessDbMocks()
    const { mockCreate } = setupAnthropicMock()

    await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: {
        imageUrl: "https://example.com/photo.jpg",
        customPrompt: "Describe this image as if you were a poet",
        userId: VALID_UUID,
      },
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "Describe this image as if you were a poet",
      })
    )
  })

  it("defaults detailLevel to detailed", async () => {
    setupSuccessDbMocks()
    const { mockCreate } = setupAnthropicMock()

    await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: VALID_PAYLOAD,
    })

    // The default detailLevel is "detailed", so the system prompt should match
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("comprehensive description"),
      })
    )
  })

  it("marks job as completed and updates output_data on success", async () => {
    const { mockUpdate, mockEq } = setupSuccessDbMocks()
    setupAnthropicMock()

    await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: VALID_PAYLOAD,
    })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        output_data: expect.objectContaining({
          generatedText: "A beautiful sunset over the ocean",
          detailLevel: "detailed",
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      })
    )
    expect(mockEq).toHaveBeenCalledWith("id", "job-1")
  })

  it("returns 502 when Claude API throws and refunds credits", async () => {
    setupSuccessDbMocks()
    const mockCreate = vi.fn().mockRejectedValue(new Error("Claude API error"))
    vi.mocked(getAnthropicClient).mockReturnValue({
      messages: { create: mockCreate },
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: VALID_PAYLOAD,
    })

    expect(res.statusCode).toBe(502)
    const body = res.json()
    expect(body.error.code).toBe("llm_error")
    expect(body.error.message).toBe("Claude API error")

    // Verify credits were refunded
    expect(CreditsService.refundCredits).toHaveBeenCalledWith("usage-1")
  })

  it("marks job as failed when Claude API throws", async () => {
    const { mockUpdate, mockEq } = setupSuccessDbMocks()
    const mockCreate = vi.fn().mockRejectedValue(new Error("Claude API error"))
    vi.mocked(getAnthropicClient).mockReturnValue({
      messages: { create: mockCreate },
    } as never)

    await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: VALID_PAYLOAD,
    })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        output_data: { error: "Claude API error" },
      })
    )
    expect(mockEq).toHaveBeenCalledWith("id", "job-1")
  })

  it("returns 500 when job insert fails", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "DB connection failed" },
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-to-text/describe",
      payload: VALID_PAYLOAD,
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("internal_error")
  })
})
