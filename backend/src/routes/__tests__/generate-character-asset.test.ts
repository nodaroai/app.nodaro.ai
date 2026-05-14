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

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "log-1",
    creditsReserved: 2,
    watermark: false,
  }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

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

vi.mock("@/lib/llm-client.js", () => ({
  llmComplete: vi.fn().mockResolvedValue({
    text: "warm closed-mouth smile, eyes softened",
    model: "claude-sonnet-4.6",
  }),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  // Mirror the protocol gate of the real safeUrlSchema so cap-exceeding
  // and obvious bad-protocol cases get the same treatment as in prod.
  const safeUrlSchema = z
    .string()
    .url()
    .refine((url) => {
      try {
        const { protocol } = new URL(url)
        return protocol === "http:" || protocol === "https:"
      } catch {
        return false
      }
    })
  return { safeUrlSchema }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateCharacterAssetRoutes } from "../generate-character-asset.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { llmComplete } from "../../lib/llm-client.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_CHARACTER_ID = "00000000-0000-4000-8000-000000000099"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // Re-prime llmComplete after clearAllMocks wipes the implementation.
  vi.mocked(llmComplete).mockResolvedValue({
    text: "warm closed-mouth smile, eyes softened",
    model: "claude-sonnet-4.6",
  } as never)
  vi.mocked(reserveCreditsForJob).mockResolvedValue({
    usageLogId: "log-1",
    creditsReserved: 2,
    watermark: false,
  } as never)

  app = Fastify({ logger: false })
  // Bypass auth — read userId from header so test cases can opt in/out.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateCharacterAssetRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a chainable supabase mock that routes by table name.
 *   - "characters" -> fetch chain returning the supplied char row (or error)
 *   - "jobs"       -> insert chain returning job-1 by default
 */
function setupSupabaseMock(opts: {
  charRow?: { source_image_url: string | null; canonical_description: string | null } | null
  charError?: { message: string } | null
  jobInsertResult?: { data: { id: string } | null; error: { message: string } | null }
}) {
  const charSingle = vi.fn().mockResolvedValue({
    data: opts.charRow ?? null,
    error: opts.charError ?? null,
  })
  // characters select chain: .select("...").eq("id", ...).eq("user_id", ...).single()
  const charEq2 = vi.fn().mockReturnValue({ single: charSingle })
  const charEq1 = vi.fn().mockReturnValue({ eq: charEq2 })
  const charSelect = vi.fn().mockReturnValue({ eq: charEq1 })

  const jobInsertResult = opts.jobInsertResult ?? { data: { id: "job-1" }, error: null }
  const jobSingle = vi.fn().mockResolvedValue(jobInsertResult)
  const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
  const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "characters") return { select: charSelect } as never
    if (table === "jobs") return { insert: jobInsert } as never
    return {} as never
  })

  return { charSelect, charEq1, charEq2, charSingle, jobInsert, jobSelect, jobSingle }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-character-asset — v2 behavior", () => {
  it("returns 401 when unauthenticated", async () => {
    setupSupabaseMock({ charRow: { source_image_url: "https://example.com/p.png", canonical_description: null } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      // intentionally no x-user-id header
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
      },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 400 validation_error on bad Zod input (realLifeRefs length > 5)", async () => {
    setupSupabaseMock({ charRow: { source_image_url: "https://example.com/p.png", canonical_description: null } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        realLifeRefs: [
          "https://example.com/r1.png",
          "https://example.com/r2.png",
          "https://example.com/r3.png",
          "https://example.com/r4.png",
          "https://example.com/r5.png",
          "https://example.com/r6.png",
        ],
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 portrait_required when character has null source_image_url", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: null, canonical_description: "tall woman" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("portrait_required")
    // No LLM call, no job insert, no enqueue when portrait gate rejects.
    expect(llmComplete).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("returns 404 not_found when character does not exist / is cross-user", async () => {
    setupSupabaseMock({ charRow: null, charError: { message: "row not found" } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "standing",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "poses",
        attachName: "standing",
      },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(llmComplete).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("calls llmComplete to draft description when attachToCharacterId present and description absent", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman with red hair" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).toHaveBeenCalledTimes(1)
    // Sanity: the canonical description and asset type/variant feed the user msg
    const call = vi.mocked(llmComplete).mock.calls[0][0]
    expect(call.modelId).toBe("claude-sonnet-4.6")
    expect(call.system.toLowerCase()).toContain("description")
    const userText = typeof call.messages[0].content === "string" ? call.messages[0].content : ""
    expect(userText).toContain("expressions")
    expect(userText).toContain("smile")
    expect(userText).toContain("tall woman with red hair")
  })

  it("does NOT call llmComplete when description is provided (studio path)", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        description: "warm closed-mouth smile, soft eyes",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("does NOT call llmComplete when attachToCharacterId is absent (non-studio path)", async () => {
    setupSupabaseMock({
      jobInsertResult: { data: { id: "job-1" }, error: null },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        // no description, no attachToCharacterId
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("LLM failure is non-fatal — still inserts job + returns 200 with description undefined in worker payload", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman" },
    })
    vi.mocked(llmComplete).mockRejectedValueOnce(new Error("LLM provider blew up"))

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.description).toBeUndefined()
  })

  it("force_private: true unconditional on the inserted job row", async () => {
    const { jobInsert } = setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman" },
    })

    // Even with body.forcePrivate=false explicitly set, the route must force true.
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
        forcePrivate: false,
      },
    })

    expect(jobInsert).toHaveBeenCalledTimes(1)
    expect(jobInsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({ force_private: true }),
    )
  })

  it("worker queue payload includes description (from LLM draft) and realLifeRefs", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman" },
    })
    vi.mocked(llmComplete).mockResolvedValueOnce({
      text: "  warm smile, soft eyes  ",
      model: "claude-sonnet-4.6",
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
        realLifeRefs: ["https://example.com/me-1.png", "https://example.com/me-2.png"],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-character-asset",
      expect.objectContaining({
        jobId: "job-1",
        description: "warm smile, soft eyes",
        realLifeRefs: ["https://example.com/me-1.png", "https://example.com/me-2.png"],
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
        usageLogId: "log-1",
      }),
    )
  })

  it("studio path uses character.source_image_url as sourceImageUrl by default", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/anchor.png", canonical_description: "tall woman" },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
      },
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.sourceImageUrl).toBe("https://example.com/anchor.png")
  })

  it("user-supplied sourceImageUrl takes precedence over the character anchor", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/anchor.png", canonical_description: "tall woman" },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
        sourceImageUrl: "https://example.com/explicit-override.png",
      },
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.sourceImageUrl).toBe("https://example.com/explicit-override.png")
  })

  it("description longer than 1000 chars is rejected with validation_error", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        description: "x".repeat(1001),
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
