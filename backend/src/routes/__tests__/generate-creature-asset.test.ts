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
    text: "sleek russet fur with white-tipped tail, alert upright ears",
    model: "claude-sonnet-4.6",
  }),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
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

import { generateCreatureAssetRoutes } from "../generate-creature-asset.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { llmComplete } from "../../lib/llm-client.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_CREATURE_ID = "00000000-0000-4000-8000-000000000099"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // Re-prime llmComplete after clearAllMocks wipes the implementation.
  vi.mocked(llmComplete).mockResolvedValue({
    text: "sleek russet fur with white-tipped tail, alert upright ears",
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
    await generateCreatureAssetRoutes(instance)
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
 *   - "creatures" → fetch chain returning the supplied row (or null + error)
 *   - "jobs"      → insert chain returning job-1 by default
 *
 * The creatures chain uses `.maybeSingle()` (matches the route's pre-check).
 */
function setupSupabaseMock(opts: {
  creatureRow?: { source_image_url: string | null; canonical_description: string | null } | null
  creatureError?: { message: string } | null
  jobInsertResult?: { data: { id: string } | null; error: { message: string } | null }
} = {}) {
  const creatureMaybeSingle = vi.fn().mockResolvedValue({
    data: opts.creatureRow === undefined ? null : opts.creatureRow,
    error: opts.creatureError ?? null,
  })
  // creatures select chain:
  //   .select("...").eq("id", ...).eq("user_id", ...).is("deleted_at", null).maybeSingle()
  const creatureIs = vi.fn().mockReturnValue({ maybeSingle: creatureMaybeSingle })
  const creatureEq2 = vi.fn().mockReturnValue({ is: creatureIs })
  const creatureEq1 = vi.fn().mockReturnValue({ eq: creatureEq2 })
  const creatureSelect = vi.fn().mockReturnValue({ eq: creatureEq1 })

  const jobInsertResult = opts.jobInsertResult ?? { data: { id: "job-1" }, error: null }
  const jobSingle = vi.fn().mockResolvedValue(jobInsertResult)
  const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
  const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "creatures") return { select: creatureSelect } as never
    if (table === "jobs") return { insert: jobInsert } as never
    return {} as never
  })

  return { creatureSelect, creatureMaybeSingle, jobInsert, jobSingle }
}

// ---------------------------------------------------------------------------
// Tests — Studio-gated LLM draft + auto-attach
// ---------------------------------------------------------------------------

describe("POST /v1/generate-creature-asset — auth + validation", () => {
  it("returns 401 when unauthenticated", async () => {
    setupSupabaseMock({
      creatureRow: { source_image_url: "https://example.com/g.png", canonical_description: null },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      // intentionally no x-user-id header
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
      },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 400 validation_error on invalid variant for non-custom asset type", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "moonwalk", // not in VARIANTS.poses
        name: "Frost Fox",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("accepts the `poses` asset type (creature delta: materials→poses)", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        sourceImageUrl: "https://example.com/ref.png",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
  })

  it("rejects the object-only `materials` asset type with validation_error", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials", // object-only — NOT a creature asset type
        variant: "wood",
        name: "Frost Fox",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("description longer than 1000 chars is rejected with validation_error", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        description: "x".repeat(1001),
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

describe("POST /v1/generate-creature-asset — ownership pre-check (uniform not_found)", () => {
  it("returns 404 not_found when attachToCreatureId does not exist / is cross-user", async () => {
    setupSupabaseMock({ creatureRow: null, creatureError: { message: "row not found" } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "idle",
      },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    // No LLM call, no enqueue, no credits reserved when pre-check rejects.
    expect(llmComplete).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("returns 404 not_found when attachToCreatureId points to a soft-deleted row (uniform code)", async () => {
    setupSupabaseMock({ creatureRow: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "angles",
        variant: "front",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "angles",
        attachName: "front",
      },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 400 main_image_required when creature exists but has no source_image_url", async () => {
    setupSupabaseMock({
      creatureRow: { source_image_url: null, canonical_description: "a russet frost fox" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "idle",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("main_image_required")
    expect(llmComplete).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })
})

describe("POST /v1/generate-creature-asset — Studio-gated LLM draft", () => {
  it("calls llmComplete to draft description when (attachToCreatureId set + description absent + canonical present)", async () => {
    setupSupabaseMock({
      creatureRow: {
        source_image_url: "https://example.com/fox.png",
        canonical_description: "a russet frost fox with white-tipped tail and ice-blue eyes",
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "idle",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).toHaveBeenCalledTimes(1)

    const call = vi.mocked(llmComplete).mock.calls[0][0]
    expect(call.modelId).toBe("claude-sonnet-4.6")
    // System prompt is the creature-asset-description prompt.
    expect(call.system.toLowerCase()).toContain("description")
    // Shared LLM options applied: maxTokens 400, temperature 0.8.
    expect(call.maxTokens).toBe(400)
    expect(call.temperature).toBe(0.8)
    // User message contains the canonical + asset type + variant.
    const userText = typeof call.messages[0].content === "string" ? call.messages[0].content : ""
    expect(userText).toContain("poses")
    expect(userText).toContain("idle")
    expect(userText).toContain("a russet frost fox with white-tipped tail and ice-blue eyes")
  })

  it("does NOT call llmComplete when caller supplied description (MCP/SDK path)", async () => {
    setupSupabaseMock({
      creatureRow: {
        source_image_url: "https://example.com/fox.png",
        canonical_description: "russet frost fox",
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        description: "tense crouched stance, hackles raised, tail low",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "idle",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).not.toHaveBeenCalled()
    // Caller's description flows verbatim to the queue.
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.description).toBe("tense crouched stance, hackles raised, tail low")
  })

  it("does NOT call llmComplete when attachToCreatureId is absent (legacy / non-studio path)", async () => {
    setupSupabaseMock({
      jobInsertResult: { data: { id: "job-1" }, error: null },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        // no description, no attachToCreatureId
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("does NOT call llmComplete when canonical_description is null (creature has no caption yet)", async () => {
    setupSupabaseMock({
      creatureRow: {
        source_image_url: "https://example.com/fox.png",
        canonical_description: null,
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "idle",
      },
    })

    expect(res.statusCode).toBe(200)
    // LLM draft skipped: nothing to anchor on without a canonical_description.
    expect(llmComplete).not.toHaveBeenCalled()
    // Worker still gets the job — just with description undefined.
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.description).toBeUndefined()
  })

  it("LLM failure is non-fatal — still inserts job + returns 200 with description undefined", async () => {
    setupSupabaseMock({
      creatureRow: {
        source_image_url: "https://example.com/fox.png",
        canonical_description: "a russet frost fox",
      },
    })
    vi.mocked(llmComplete).mockRejectedValueOnce(new Error("LLM provider blew up"))

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "idle",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.description).toBeUndefined()
  })

  it("LLM draft text is trimmed before flowing to the queue payload", async () => {
    setupSupabaseMock({
      creatureRow: {
        source_image_url: "https://example.com/fox.png",
        canonical_description: "a russet frost fox",
      },
    })
    vi.mocked(llmComplete).mockResolvedValueOnce({
      text: "  alert upright stance, ears forward  ",
      model: "claude-sonnet-4.6",
    } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "alert",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "alert",
      },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.description).toBe("alert upright stance, ears forward")
  })

  it("custom asset folds userPrompt into LLM input (NOT just the literal 'custom')", async () => {
    setupSupabaseMock({
      creatureRow: {
        source_image_url: "https://example.com/fox.png",
        canonical_description: "a russet frost fox with white-tipped tail",
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "custom",
        variant: "custom", // literal — what the studio UI sends for custom assets
        name: "Frost Fox",
        userPrompt: "leaping mid-air over a snowbank",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "variations",
        attachName: "custom-1",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).toHaveBeenCalledTimes(1)
    const call = vi.mocked(llmComplete).mock.calls[0][0]
    const userText = typeof call.messages[0].content === "string" ? call.messages[0].content : ""
    expect(userText).toContain("leaping mid-air over a snowbank")
    expect(userText).not.toContain('Variant or prompt: "custom"')
  })
})

describe("POST /v1/generate-creature-asset — auto-attach payload + source-image resolution", () => {
  it("auto-attach payload fields flow through to the worker queue (job name generate-creature-asset)", async () => {
    setupSupabaseMock({
      creatureRow: {
        source_image_url: "https://example.com/fox.png",
        canonical_description: "a russet frost fox",
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "idle",
        seedPromptHint: "russet frost fox",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-creature-asset",
      expect.objectContaining({
        jobId: "job-1",
        assetType: "poses",
        variant: "idle",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "idle",
        seedPromptHint: "russet frost fox",
        usageLogId: "log-1",
      }),
    )
  })

  it("studio path uses creature.source_image_url as sourceImageUrl by default", async () => {
    setupSupabaseMock({
      creatureRow: {
        source_image_url: "https://example.com/anchor.png",
        canonical_description: "a russet frost fox",
      },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "idle",
      },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.sourceImageUrl).toBe("https://example.com/anchor.png")
  })

  it("user-supplied sourceImageUrl takes precedence over the creature anchor", async () => {
    setupSupabaseMock({
      creatureRow: {
        source_image_url: "https://example.com/anchor.png",
        canonical_description: "a russet frost fox",
      },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "poses",
        attachName: "idle",
        sourceImageUrl: "https://example.com/explicit-override.png",
      },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.sourceImageUrl).toBe("https://example.com/explicit-override.png")
  })

  it("non-studio path (no attachToCreatureId): no anchor lookup, prompt built without LLM, queue payload sound", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "angles",
        variant: "front",
        name: "Frost Fox",
        category: "beast",
        description: "a russet frost fox",
        sourceImageUrl: "https://example.com/ref.png",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).not.toHaveBeenCalled()
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-creature-asset",
      expect.objectContaining({
        jobId: "job-1",
        assetType: "angles",
        variant: "front",
        sourceImageUrl: "https://example.com/ref.png",
        description: "a russet frost fox",
        // No attach metadata when caller didn't ask for it.
        attachToCreatureId: undefined,
        attachToColumn: undefined,
        attachName: undefined,
      }),
    )
  })

  it("invalid attachToColumn (not in CREATURE_ATTACH_COLUMNS) is rejected with validation_error", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "bogus_column", // not in CREATURE_ATTACH_COLUMNS
        attachName: "idle",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects the object-only `materials` attachToColumn (creature delta: materials→poses)", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "poses",
        variant: "idle",
        name: "Frost Fox",
        attachToCreatureId: TEST_CREATURE_ID,
        attachToColumn: "materials", // object-only column — NOT in CREATURE_ATTACH_COLUMNS
        attachName: "idle",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
