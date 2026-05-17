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

import { generateCharacterMotionRoutes, resolveFrontBodyAngleUrl } from "../generate-character-motion.js"
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
  charRow?: {
    source_image_url: string | null
    canonical_description: string | null
    body_angles?: unknown
  } | null
  charError?: { message: string } | null
  jobInsertResult?: { data: { id: string } | null; error: { message: string } | null }
}) {
  const charSingle = vi.fn().mockResolvedValue({
    data: opts.charRow ?? null,
    error: opts.charError ?? null,
  })
  // characters select chain:
  //   .select("...").eq("id", ...).eq("user_id", ...).is("deleted_at", null).single()
  // The `.is("deleted_at", null)` step rejects soft-deleted rows so a soft-deleted
  // character can't trip a portrait_required false-positive or attach assets.
  const charIs = vi.fn().mockReturnValue({ single: charSingle })
  const charEq2 = vi.fn().mockReturnValue({ is: charIs })
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

  return { charSelect, charEq1, charEq2, charIs, charSingle, jobInsert, jobSelect, jobSingle }
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

  // ──────────────────────────────────────────────────────────────────────
  // Full-body source-frame preference. When the character has body_angles
  // populated, motion gen should pick the canonical "front" angle over the
  // anchor portrait — character motion looks much better when the source
  // frame is a full-body shot. See `resolveFrontBodyAngleUrl()`.
  // ──────────────────────────────────────────────────────────────────────

  it("prefers the front body angle URL over the anchor portrait when body_angles has a 'front' entry", async () => {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/portrait.png",
        canonical_description: "tall woman",
        body_angles: [
          { name: "back", url: "https://example.com/body-back.png" },
          { name: "front", url: "https://example.com/body-front.png" },
          { name: "3/4 left", url: "https://example.com/body-34left.png" },
        ],
      },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        motionPrompt: "she waves slowly toward the camera",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "wave",
      },
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.sourceImageUrl).toBe("https://example.com/body-front.png")
  })

  it("explicit sourceImageUrl still wins over a 'front' body angle (caller's override is final)", async () => {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/portrait.png",
        canonical_description: "tall woman",
        body_angles: [{ name: "front", url: "https://example.com/body-front.png" }],
      },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({
        sourceImageUrl: OVERRIDE_URL,
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "wave",
      }),
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.sourceImageUrl).toBe(OVERRIDE_URL)
  })

  it("falls back to the portrait when body_angles is empty (legacy character path still works)", async () => {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/portrait.png",
        canonical_description: "tall woman",
        body_angles: [],
      },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        motionPrompt: "she waves",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "wave",
      },
    })

    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.sourceImageUrl).toBe("https://example.com/portrait.png")
  })

  it("falls back to the most-recently-saved body angle when no 'front' entry exists", async () => {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/portrait.png",
        canonical_description: "tall woman",
        body_angles: [
          { name: "back", url: "https://example.com/body-back.png" },
          { name: "left profile", url: "https://example.com/body-left.png" },
        ],
      },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        motionPrompt: "she waves",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "wave",
      },
    })

    // No "front" → take the LAST entry (newest append).
    const enqueuedPayload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueuedPayload.sourceImageUrl).toBe("https://example.com/body-left.png")
  })

  it("400 portrait_required when character has no portrait AND no body angles", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: null, canonical_description: "tall woman", body_angles: [] },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        motionPrompt: "she waves",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachName: "wave",
      },
    })

    // Portrait gate still fires first — a character without source_image_url
    // is rejected regardless of body_angles. (The frontend auto-chains a body
    // angle gen BEFORE the motion call so this case is unreachable in the UI,
    // but the route stays strict for non-studio callers.)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("portrait_required")
    expect(videoQueue.add).not.toHaveBeenCalled()
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

  it("returns 400 validation_error when neither attachToCharacterId nor sourceImageUrl is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { motionPrompt: "she waves" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

// ---------------------------------------------------------------------------
// Per-asset-type aspect-ratio defaults (smart-defaults feature).
// Motions default to 9:16; node toggle overrides default; explicit beats both.
// ---------------------------------------------------------------------------
describe("POST /v1/generate-character-motion — aspect-ratio defaults", () => {
  function getAspect(): string {
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    return enqueued.aspectRatio as string
  }

  it("motions default to 9:16 when nothing is set", async () => {
    setupSupabaseMock({ charRow: { source_image_url: PORTRAIT_URL, canonical_description: null } })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload(),
    })
    expect(getAspect()).toBe("9:16")
  })

  it("characterNodeAspectRatio overrides the motions default", async () => {
    setupSupabaseMock({ charRow: { source_image_url: PORTRAIT_URL, canonical_description: null } })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({ characterNodeAspectRatio: "16:9" }),
    })
    expect(getAspect()).toBe("16:9")
  })

  it("explicit aspectRatio beats characterNodeAspectRatio and the motions default", async () => {
    setupSupabaseMock({ charRow: { source_image_url: PORTRAIT_URL, canonical_description: null } })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({ aspectRatio: "1:1", characterNodeAspectRatio: "16:9" }),
    })
    expect(getAspect()).toBe("1:1")
  })

  it("invalid aspectRatio value is rejected by Zod (validation_error)", async () => {
    setupSupabaseMock({ charRow: { source_image_url: PORTRAIT_URL, canonical_description: null } })
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-motion",
      headers: { "x-user-id": TEST_USER_ID },
      payload: basePayload({ aspectRatio: "21:9" }),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

// ---------------------------------------------------------------------------
// Unit tests for the `body_angles` URL resolver. Kept inline because the
// function is a tiny helper exported alongside the route; a separate test
// file would be heavier than the function it tests.
// ---------------------------------------------------------------------------
describe("resolveFrontBodyAngleUrl", () => {
  it("returns null for null / undefined / non-array input", () => {
    expect(resolveFrontBodyAngleUrl(null)).toBeNull()
    expect(resolveFrontBodyAngleUrl(undefined)).toBeNull()
    expect(resolveFrontBodyAngleUrl({})).toBeNull()
    expect(resolveFrontBodyAngleUrl("front-url")).toBeNull()
  })

  it("returns null for an empty array", () => {
    expect(resolveFrontBodyAngleUrl([])).toBeNull()
  })

  it("picks the 'front' entry when present, regardless of position", () => {
    const angles = [
      { name: "back", url: "https://example.com/back.png" },
      { name: "front", url: "https://example.com/front.png" },
      { name: "3/4 left", url: "https://example.com/34l.png" },
    ]
    expect(resolveFrontBodyAngleUrl(angles)).toBe("https://example.com/front.png")
  })

  it("matches 'front' case-insensitively and tolerates whitespace", () => {
    const angles = [
      { name: "back", url: "https://example.com/back.png" },
      { name: "  Front  ", url: "https://example.com/case.png" },
    ]
    expect(resolveFrontBodyAngleUrl(angles)).toBe("https://example.com/case.png")
  })

  it("falls back to the LAST entry when no 'front' exists (most-recently-saved)", () => {
    const angles = [
      { name: "back", url: "https://example.com/back.png" },
      { name: "left profile", url: "https://example.com/left.png" },
    ]
    expect(resolveFrontBodyAngleUrl(angles)).toBe("https://example.com/left.png")
  })

  it("skips entries without a usable url field", () => {
    const angles = [
      { name: "front", url: "" },              // empty URL — skipped in pass 1
      { name: "back", url: "https://example.com/back.png" }, // last viable
    ]
    expect(resolveFrontBodyAngleUrl(angles)).toBe("https://example.com/back.png")
  })

  it("returns null when no entry has a URL at all", () => {
    const angles = [
      { name: "front" },
      { name: "back", url: 123 as unknown as string },
    ]
    expect(resolveFrontBodyAngleUrl(angles)).toBeNull()
  })

  it("tolerates entries that are missing `name` (still considered for the fallback pass)", () => {
    const angles = [
      { url: "https://example.com/nameless.png" },
    ]
    expect(resolveFrontBodyAngleUrl(angles)).toBe("https://example.com/nameless.png")
  })
})
