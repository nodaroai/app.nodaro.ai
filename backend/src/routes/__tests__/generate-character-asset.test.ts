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
import { CLOTHED_DEFAULT, CLOTHED_MATCH_REFERENCES } from "../../lib/character-prompts.js"
import { MODEST_ATTIRE_CLAUSE } from "../../lib/prompt-policies/index.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { resolveEntityImageParams } from "../../lib/entity-credit-identifier.js"
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
  charRow?: Record<string, unknown> | null
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

  it("custom asset folds userPrompt into LLM input (NOT just the literal 'custom')", async () => {
    // Regression: assetType="custom" sends `variant: "custom"` (literal) per
    // the studio UI. Without folding in userPrompt, the LLM gets
    // `Variant or prompt: "custom"` — a meaningless input that yields a
    // useless description. The shared helper must prefer userPrompt for
    // custom assets.
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/portrait.png",
        canonical_description: "tall woman with red hair",
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "custom",
        variant: "custom", // literal — what the studio UI sends for custom assets
        name: "Kira",
        userPrompt: "a stoic warrior with a scar",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "custom-1",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).toHaveBeenCalledTimes(1)
    const call = vi.mocked(llmComplete).mock.calls[0][0]
    const userText = typeof call.messages[0].content === "string" ? call.messages[0].content : ""
    // The fix: userPrompt is folded into the LLM input for custom assets.
    expect(userText).toContain("a stoic warrior with a scar")
    // Sanity: the literal "custom" string is NOT used as the variant-or-prompt slot.
    expect(userText).not.toContain('Variant or prompt: "custom"')
    // Sanity: shared LLM options applied (maxTokens 400, temperature 0.8).
    expect(call.maxTokens).toBe(400)
    expect(call.temperature).toBe(0.8)
  })

  it("accepts assetType=bodyAngles + attachToColumn=body_angles (new column added in migration 118)", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/portrait.png", canonical_description: "tall woman" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "bodyAngles",
        variant: "front",
        name: "Kira",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "body_angles",
        attachName: "front",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-character-asset",
      expect.objectContaining({
        assetType: "bodyAngles",
        variant: "front",
        attachToColumn: "body_angles",
        attachName: "front",
      }),
    )
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

// ---------------------------------------------------------------------------
// Per-asset-type aspect-ratio defaults (smart-defaults feature).
//
// Spec: resolveCharacterAspectRatio precedence is explicit > nodeOverride >
//       per-asset-type default. These cases exercise all three layers
//       end-to-end through the route handler.
// ---------------------------------------------------------------------------
describe("POST /v1/generate-character-asset — aspect-ratio defaults", () => {
  function getAspect(): string {
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    return enqueued.aspectRatio as string
  }

  it("expressions defaults to 1:1 when nothing is set", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { assetType: "expressions", variant: "smile", name: "Kira" },
    })
    expect(getAspect()).toBe("1:1")
  })

  it("poses defaults to 9:16 when nothing is set", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { assetType: "poses", variant: "standing", name: "Kira" },
    })
    expect(getAspect()).toBe("9:16")
  })

  it("headAngles defaults to 3:4 when nothing is set", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { assetType: "headAngles", variant: "front", name: "Kira" },
    })
    expect(getAspect()).toBe("3:4")
  })

  it("bodyAngles defaults to 9:16 when nothing is set", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { assetType: "bodyAngles", variant: "front", name: "Kira" },
    })
    expect(getAspect()).toBe("9:16")
  })

  it("lighting defaults to 3:4 when nothing is set", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { assetType: "lighting", variant: "daylight", name: "Kira" },
    })
    expect(getAspect()).toBe("3:4")
  })

  it("legacy 'angles' alias defaults to 3:4 (same as headAngles)", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { assetType: "angles", variant: "front", name: "Kira" },
    })
    expect(getAspect()).toBe("3:4")
  })

  it("custom asset falls back to the portrait default (3:4)", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "custom",
        variant: "custom",
        name: "Kira",
        userPrompt: "a stoic warrior with a scar",
      },
    })
    expect(getAspect()).toBe("3:4")
  })

  it("characterNodeAspectRatio overrides the per-asset-type default", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        // expressions defaults to 1:1, but the node toggle says 16:9 → 16:9 wins.
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        characterNodeAspectRatio: "16:9",
      },
    })
    expect(getAspect()).toBe("16:9")
  })

  it("explicit aspectRatio beats characterNodeAspectRatio and the per-asset-type default", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        // poses defaults to 9:16, node says 16:9, but explicit 1:1 wins.
        assetType: "poses",
        variant: "standing",
        name: "Kira",
        aspectRatio: "1:1",
        characterNodeAspectRatio: "16:9",
      },
    })
    expect(getAspect()).toBe("1:1")
  })

  it("invalid aspectRatio value is rejected by Zod (validation_error)", async () => {
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
        aspectRatio: "21:9", // outside the 4-value union
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

// ---------------------------------------------------------------------------
// Credit-affecting quality/resolution levers (mirrors generate-image).
// The DEBIT identifier (reserveCreditsForJob's 4th arg) comes from the shared
// resolver — the same function the (mocked no-op here) credit-guard CHECK
// runs, so asserting the DEBIT pins both sides.
// ---------------------------------------------------------------------------

describe("POST /v1/generate-character-asset — quality / resolution levers", () => {
  it("quality=high + gpt-image reserves the composite id and threads the SNAPPED levers to the queue", async () => {
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
        provider: "gpt-image",
        quality: "high",
        resolution: "1K",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "job-1", "gpt-image:high",
    )
    // `resolution: "1K"` is DROPPED: gpt-image declares no resolutions at all,
    // and the catalog snap now removes a lever the model does not have instead
    // of forwarding it into the worker's `extraParams`. `quality: "high"` is
    // declared, so it survives and keeps its composite price.
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-character-asset",
      expect.objectContaining({ quality: "high", resolution: undefined }),
    )
  })

  it("omitting the levers keeps the legacy plain-provider identifier", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { assetType: "expressions", variant: "smile", name: "Kira" },
    })

    expect(res.statusCode).toBe(200)
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "job-1", "nano-banana",
    )
  })

  it("a value outside the enum is rejected by Zod (validation_error)", async () => {
    setupSupabaseMock({
      charRow: { source_image_url: "https://example.com/p.png", canonical_description: null },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { assetType: "expressions", variant: "smile", name: "Kira", quality: "ultra" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

// ---------------------------------------------------------------------------
// Multi-image identity references + identity-lock (design 2026-07-01).
// ---------------------------------------------------------------------------
describe("POST /v1/generate-character-asset — identity references", () => {
  function enqueued(): Record<string, unknown> {
    return vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
  }

  it("selects reference_photos + the identity asset columns on the studio path", async () => {
    const { charSelect } = setupSupabaseMock({
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
        description: "warm smile",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
      },
    })

    expect(charSelect).toHaveBeenCalledTimes(1)
    const selectArg = charSelect.mock.calls[0][0] as string
    expect(selectArg).toContain("reference_photos")
    expect(selectArg).toContain("expressions")
    expect(selectArg).toContain("body_angles")
  })

  it("assembles a ranked multi-URL reference set: portrait anchor first, angle-matched photo next, prior asset included", async () => {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://cdn/anchor.png",
        canonical_description: "tall woman",
        reference_photos: [
          { url: "https://cdn/left.png", kind: "sideLeft" },
          { url: "https://cdn/front.png", kind: "frontFace" },
        ],
        expressions: [{ name: "smile", url: "https://cdn/expr-smile.png" }],
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "headAngles",
        variant: "left profile",
        name: "Kira",
        description: "left profile",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "angles",
        attachName: "left profile",
      },
    })

    expect(res.statusCode).toBe(200)
    const refs = enqueued().assembledReferenceUrls as string[]
    expect(refs[0]).toBe("https://cdn/anchor.png") // portrait anchor
    expect(refs[1]).toBe("https://cdn/left.png") // sideLeft angle-matched for headAngles + left profile
    expect(refs).toContain("https://cdn/expr-smile.png") // prior generated asset included
  })

  async function postStudioAsset(identityLock: "off" | "soft" | "strict") {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/anchor.png",
        canonical_description: "tall woman",
        identity_lock: identityLock,
      },
    })
    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        description: "warm smile",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
      },
    })
    return enqueued().prompt as string
  }

  it("identity_lock=strict → ref-bound strict identity clause in the prompt", async () => {
    expect(await postStudioAsset("strict")).toContain(
      "The facial identity of the subject in reference image A must match exactly",
    )
  })

  it("identity_lock=soft → ref-bound soft likeness clause, not the strict wording", async () => {
    const prompt = await postStudioAsset("soft")
    expect(prompt).toContain("Preserve the overall facial likeness of the subject in reference image A")
    expect(prompt).not.toContain("must match exactly")
  })

  it("identity_lock=off → no identity-lock clause even with references present", async () => {
    const prompt = await postStudioAsset("off")
    expect(prompt).not.toContain("must match exactly")
    expect(prompt).not.toContain("overall facial likeness")
  })

  it("subject binds to reference image A when references exist; clothing matches the reference outfit", async () => {
    const prompt = await postStudioAsset("strict")
    expect(prompt).toContain("Portrait headshot of the person from reference image A")
    // With references the clothing directive asks for the SAME outfit as the
    // refs (with the everyday-attire fallback), never invent-an-outfit-first —
    // otherwise every asset render re-invents clothes and the sheet drifts.
    expect(prompt).toContain("wearing the same outfit as shown in the reference images")
    expect(prompt).not.toContain("unless the outfit is otherwise described,")
  })

  it("omits the identity-lock clause and sends an empty ref set on the non-studio path with no source image", async () => {
    setupSupabaseMock({ jobInsertResult: { data: { id: "job-1" }, error: null } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        // no attachToCharacterId, no sourceImageUrl → no references
      },
    })

    expect(enqueued().assembledReferenceUrls).toEqual([])
    const prompt = enqueued().prompt as string
    expect(prompt).not.toContain("must match exactly")
    // No references → the subject stays the name, never "reference image A".
    expect(prompt).toContain("Portrait headshot of Kira")
    expect(prompt).not.toContain("reference image A")
    // The clothed default is unconditional — text-to-image renders need it too.
    expect(prompt).toContain("fully clothed in simple everyday attire")
  })

  it("reserves the per-reference Flux 2 credit tier reflecting the assembled ref count (not the sourceImageUrl heuristic)", async () => {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://cdn/anchor.png",
        canonical_description: "tall woman",
        reference_photos: [{ url: "https://cdn/front.png", kind: "frontFace" }],
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "expressions",
        variant: "smile",
        name: "Kira",
        description: "warm smile",
        provider: "flux-2-max",
        resolution: "2 MP",
        attachToCharacterId: TEST_CHARACTER_ID,
        attachToColumn: "expressions",
        attachName: "smile",
      },
    })

    expect(res.statusCode).toBe(200)
    // portrait anchor + 1 reference photo = 2 refs; the reserved id must reflect
    // 2ref, not the body-sourceImageUrl-based 0ref that would under-charge Flux 2.
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "job-1", "flux-2-max:2MP:2ref",
    )
  })
})

// ---------------------------------------------------------------------------
// W1-a minor-age floor — the asset route decides the subject's age ONCE from
// the character row's `person` value and rides the decision to the worker.
// ---------------------------------------------------------------------------
describe("POST /v1/generate-character-asset — minor-age floor (W1-a)", () => {
  it("adult byte-identity pin: the enqueued prompt is the pre-change string", async () => {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/portrait.png",
        canonical_description: "tall woman",
        person: { age: "age-30s" },
      },
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
      },
    })

    expect(res.statusCode).toBe(200)
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    // Literal, NOT the CLOTHED_MATCH_REFERENCES constant — the pin has to fail
    // if the adult clothing floor itself ever changes.
    expect(enqueued.prompt).toBe(
      "Portrait headshot of the person from reference image A, gentle warm smile, looking at camera. Single character character Kira, warm closed-mouth smile, eyes softened, in their 30s. realistic art style, 4k, highly detailed, wearing the same outfit as shown in the reference images unless a different outfit is described; if no outfit is visible or described, fully clothed in simple everyday attire, white/plain background, no text, no labels, no watermarks.",
    )
  })

  it("adult: subjectMinor rides the job as false", async () => {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/portrait.png",
        canonical_description: "tall woman",
        person: { age: "age-30s" },
      },
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
      },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.subjectMinor).toBe(false)
  })

  it("row.person is null: the text signal reads the row's canonical description (incident-path shape)", async () => {
    // The asset route's incident shape: the picker value was never persisted,
    // so the row's own description is the only age-bearing text — and it is
    // what the LLM drafts `description` from, so it reaches the prompt anyway.
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/portrait.png",
        canonical_description: "a young child around 5 years old, brown hair",
        person: null,
      },
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
      },
    })

    expect(res.statusCode).toBe(200)
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.subjectMinor).toBe(true)
    const prompt = enqueued.prompt as string
    expect(prompt.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
    expect(prompt).not.toContain(CLOTHED_MATCH_REFERENCES)
  })

  it("row.person is null: the text signal reads the caller's userPrompt", async () => {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/portrait.png",
        canonical_description: "tall woman",
        person: null,
      },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "custom",
        variant: "custom",
        name: "Kira",
        userPrompt: "a 12 year old sitting on a bench",
        attachToCharacterId: TEST_CHARACTER_ID,
      },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.subjectMinor).toBe(true)
  })

  it("minor: subjectMinor rides the job as true and the base carries the modest clause once (neither self-disabling floor)", async () => {
    setupSupabaseMock({
      charRow: {
        source_image_url: "https://example.com/portrait.png",
        canonical_description: "a child",
        person: { age: "age-child", bust: "bust-full" },
      },
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
      },
    })

    expect(res.statusCode).toBe(200)
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.subjectMinor).toBe(true)
    const prompt = enqueued.prompt as string
    expect(prompt.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
    expect(prompt).not.toContain(CLOTHED_DEFAULT)
    expect(prompt).not.toContain(CLOTHED_MATCH_REFERENCES)
    // Layer 1 already dropped the flagged picker hint from the person value.
    expect(prompt).not.toMatch(/full bust/)
  })
})

// ---------------------------------------------------------------------------
// Catalog-snap parity: CHECK === DEBIT === input_data === queue payload
// ---------------------------------------------------------------------------
/**
 * `resolution` / `quality` are PRICING dimensions on this route (composite ids
 * like "gpt-image:high"), and the entity worker forwards both verbatim into
 * `extraParams`. So the catalog snap lives inside the ONE resolver the
 * preHandler CHECK and the handler DEBIT share — anything else splits the two,
 * and `commit_credits` never collects an upward delta (the reserve IS the
 * charge). `creditGuard` is mocked to a no-op here, so the CHECK is exercised
 * by calling that exact resolver directly on the same raw body.
 *
 * The assertion is four-way on purpose: a run that reserves one tier, records
 * another on the job row and sends a third to the provider is the exact bug
 * this block exists to make impossible.
 */
describe("POST /v1/generate-character-asset — catalog snap parity", () => {
  const BASE = { assetType: "expressions", variant: "smile", name: "Kira", description: "warm smile" }

  async function run(payload: Record<string, unknown>) {
    const { jobInsert } = setupSupabaseMock({})
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { ...BASE, ...payload },
    })
    expect(res.statusCode).toBe(200)
    return {
      // No `refCountOverride`: every provider below is priced per-model, not
      // per-reference, so the handler's assembled count is inert and the raw-body
      // CHECK is the same derivation the DEBIT runs.
      check: resolveEntityImageParams({ ...BASE, ...payload }).identifier,
      debit: vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3],
      inputData: (jobInsert.mock.calls[0][0] as { input_data: Record<string, unknown> }).input_data,
      enqueued: vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>,
    }
  }

  it("snaps a quality gpt-image does not accept, everywhere at once", async () => {
    const { check, debit, inputData, enqueued } = await run({ provider: "gpt-image", quality: "basic" })
    expect(check).toBe(debit)
    expect(check).toBe("gpt-image")
    expect(inputData.quality).toBe("medium")
    expect(enqueued.quality).toBe("medium")
  })

  it("drops a resolution nano-banana does not have (never reaches the worker)", async () => {
    const { check, debit, inputData, enqueued } = await run({ provider: "nano-banana", resolution: "2K" })
    expect(check).toBe(debit)
    expect(check).toBe("nano-banana")
    expect(inputData.resolution).toBeUndefined()
    expect(enqueued.resolution).toBeUndefined()
  })

  it("leaves a catalog-valid pair byte-identical, composite price included", async () => {
    const { check, debit, inputData, enqueued } = await run({ provider: "gpt-image", quality: "high" })
    expect(check).toBe(debit)
    expect(check).toBe("gpt-image:high")
    expect(inputData.quality).toBe("high")
    expect(enqueued.quality).toBe("high")
  })

  it("never lets the snap erase the resolved aspect ratio", async () => {
    const { enqueued, inputData } = await run({ provider: "gpt-image", quality: "basic", aspectRatio: "16:9" })
    expect(enqueued.aspectRatio).toBe("16:9")
    expect(inputData.aspectRatio).toBe("16:9")
  })
})
