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
    creditsReserved: 22,
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
    text: JSON.stringify({
      description: "warm presence, soft smile, casual stance",
      motionDescription: "slow head turn toward camera",
    }),
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

import { generateCharacterMotionRoutes } from "../generate-character-motion.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { llmComplete } from "../../lib/llm-client.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_CHARACTER_ID = "00000000-0000-4000-8000-000000000099"
const PORTRAIT_URL = "https://example.com/portrait.png"
const OVERRIDE_URL = "https://example.com/explicit-override.png"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(llmComplete).mockResolvedValue({
    text: JSON.stringify({
      description: "warm presence, soft smile, casual stance",
      motionDescription: "slow head turn toward camera",
    }),
    model: "claude-sonnet-4.6",
  } as never)
  vi.mocked(reserveCreditsForJob).mockResolvedValue({
    usageLogId: "log-1",
    creditsReserved: 22,
    watermark: false,
  } as never)

  app = Fastify({ logger: false })
  // Bypass auth — read userId from header so test cases can opt in/out.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateCharacterMotionRoutes(instance)
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

function basePayload(extra: Record<string, unknown> = {}) {
  return {
    motionPrompt: "slow head turn toward the camera",
    sourceImageUrl: PORTRAIT_URL,
    name: "Kira",
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-character-motion — Task 8 behavior", () => {
  it("returns 401 when unauthenticated", async () => {
    setupSupabaseMock({ charRow: { source_image_url: PORTRAIT_URL, canonical_description: null } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      // intentionally no x-user-id header
      payload: basePayload(),
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 400 validation_error when motionDescription > 500 chars", async () => {
    setupSupabaseMock({ charRow: { source_image_url: PORTRAIT_URL, canonical_description: null } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({ motionDescription: "x".repeat(501) }),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 validation_error when realLifeRefs.length > 5", async () => {
    setupSupabaseMock({ charRow: { source_image_url: PORTRAIT_URL, canonical_description: null } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        realLifeRefs: [
          "https://example.com/r1.png",
          "https://example.com/r2.png",
          "https://example.com/r3.png",
          "https://example.com/r4.png",
          "https://example.com/r5.png",
          "https://example.com/r6.png",
        ],
      }),
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
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("portrait_required")
    expect(llmComplete).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("returns 404 not_found when character does not exist / is cross-user", async () => {
    setupSupabaseMock({ charRow: null, charError: { message: "row not found" } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(llmComplete).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("calls llmComplete ONCE with dual-output system prompt when both description fields absent", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman with red hair" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).toHaveBeenCalledTimes(1)
    const call = vi.mocked(llmComplete).mock.calls[0][0]
    expect(call.modelId).toBe("claude-sonnet-4.6")
    // System prompt mentions BOTH outputs by key + asks for JSON.
    expect(call.system).toContain("description")
    expect(call.system).toContain("motionDescription")
    expect(call.system.toLowerCase()).toContain("json")
    // User message folds in motion prompt + canonical description.
    const userText = typeof call.messages[0].content === "string" ? call.messages[0].content : ""
    expect(userText).toContain("slow head turn toward the camera")
    expect(userText).toContain("tall woman with red hair")
  })

  it("does NOT call llmComplete when BOTH description AND motionDescription are user-provided", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        description: "warm presence",
        motionDescription: "slow head turn",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).not.toHaveBeenCalled()
    // Worker payload preserves user-provided values verbatim.
    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.description).toBe("warm presence")
    expect(enqueuedPayload.motionDescription).toBe("slow head turn")
  })

  it("calls llmComplete when only description is provided (motionDescription needed)", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        description: "user-supplied description, do not discard",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).toHaveBeenCalledTimes(1)
    // User-provided description wins; LLM's motionDescription is kept.
    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.description).toBe("user-supplied description, do not discard")
    expect(enqueuedPayload.motionDescription).toBe("slow head turn toward camera")
  })

  it("calls llmComplete when only motionDescription is provided (description needed)", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        motionDescription: "user-supplied motion, do not discard",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).toHaveBeenCalledTimes(1)
    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.description).toBe("warm presence, soft smile, casual stance")
    expect(enqueuedPayload.motionDescription).toBe("user-supplied motion, do not discard")
  })

  it("does NOT call llmComplete when attachToCharacterId is absent (non-studio path)", async () => {
    setupSupabaseMock({
      jobInsertResult: { data: { id: "job-1" }, error: null },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload(),
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("LLM returns valid JSON → both fields populated in worker payload", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(200)
    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.description).toBe("warm presence, soft smile, casual stance")
    expect(enqueuedPayload.motionDescription).toBe("slow head turn toward camera")
  })

  it("LLM returns JSON wrapped in markdown fences → still parses correctly", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman" },
    })
    vi.mocked(llmComplete).mockResolvedValueOnce({
      text: '```json\n{"description":"fenced desc","motionDescription":"fenced motion"}\n```',
      model: "claude-sonnet-4.6",
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(200)
    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.description).toBe("fenced desc")
    expect(enqueuedPayload.motionDescription).toBe("fenced motion")
  })

  it("LLM returns malformed JSON → both fields stay undefined, still 200 + queued", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman" },
    })
    vi.mocked(llmComplete).mockResolvedValueOnce({
      text: "this is not JSON at all, just prose",
      model: "claude-sonnet-4.6",
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.description).toBeUndefined()
    expect(enqueuedPayload.motionDescription).toBeUndefined()
  })

  it("LLM returns partial JSON (only one field) → use whichever landed; other stays undefined", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman" },
    })
    vi.mocked(llmComplete).mockResolvedValueOnce({
      text: JSON.stringify({ motionDescription: "partial: only motion" }),
      model: "claude-sonnet-4.6",
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(200)
    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.description).toBeUndefined()
    expect(enqueuedPayload.motionDescription).toBe("partial: only motion")
  })

  it("LLM throws → both fields stay undefined, still 200 + queued, structured log", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman" },
    })
    vi.mocked(llmComplete).mockRejectedValueOnce(new Error("LLM provider blew up"))

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.description).toBeUndefined()
    expect(enqueuedPayload.motionDescription).toBeUndefined()
  })

  it("force_private: true unconditional on the inserted job row (even when forcePrivate: false in body)", async () => {
    const { jobInsert } = setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman" },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
        forcePrivate: false,
      }),
    })

    expect(jobInsert).toHaveBeenCalledTimes(1)
    expect(jobInsert.mock.calls[0][0]).toEqual(
      expect.objectContaining({ force_private: true }),
    )
  })

  it("worker queue payload includes description + motionDescription + realLifeRefs", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: "tall woman" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
        realLifeRefs: ["https://example.com/me-1.png", "https://example.com/me-2.png"],
      }),
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-character-motion",
      expect.objectContaining({
        jobId: "job-1",
        description: "warm presence, soft smile, casual stance",
        motionDescription: "slow head turn toward camera",
        realLifeRefs: ["https://example.com/me-1.png", "https://example.com/me-2.png"],
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
        usageLogId: "log-1",
      }),
    )
  })

  it("studio path uses character.source_image_url as sourceImageUrl by default (overrides caller's URL when not given)", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/anchor.png", canonical_description: "tall woman" },
    })

    // Caller provides a sourceImageUrl required for non-studio Zod parse; the
    // studio path should ignore it in favor of the character's portrait when
    // the caller didn't intend an override. The simplest expression of the
    // precedence rule is: when caller passes the same URL as the anchor (or
    // doesn't care), we end up using the anchor URL. We test override below.
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        motionPrompt: "slow head turn",
        // No sourceImageUrl in body — let the character's anchor fill in.
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      },
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.sourceImageUrl).toBe("https://example.com/anchor.png")
  })

  it("user-supplied sourceImageUrl takes precedence over the character anchor (studio path)", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/anchor.png", canonical_description: "tall woman" },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        sourceImageUrl: OVERRIDE_URL,
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "head-turn",
      }),
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.sourceImageUrl).toBe(OVERRIDE_URL)
  })

  it("description longer than 1000 chars is rejected with validation_error", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: PORTRAIT_URL, canonical_description: null },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({ description: "x".repeat(1001) }),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
