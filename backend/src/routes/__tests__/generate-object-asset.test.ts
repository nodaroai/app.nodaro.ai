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
    text: "polished brass with intricate filigree engravings, warm honeyed patina",
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

import { generateObjectAssetRoutes } from "../generate-object-asset.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { llmComplete } from "../../lib/llm-client.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_OBJECT_ID = "00000000-0000-4000-8000-000000000099"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // Re-prime llmComplete after clearAllMocks wipes the implementation.
  vi.mocked(llmComplete).mockResolvedValue({
    text: "polished brass with intricate filigree engravings, warm honeyed patina",
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
    await generateObjectAssetRoutes(instance)
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
 *   - "objects" → fetch chain returning the supplied row (or null + error)
 *   - "jobs"    → insert chain returning job-1 by default
 *
 * The objects chain uses `.maybeSingle()` (matches the route's pre-check).
 */
function setupSupabaseMock(opts: {
  objectRow?: { source_image_url: string | null; canonical_description: string | null } | null
  objectError?: { message: string } | null
  jobInsertResult?: { data: { id: string } | null; error: { message: string } | null }
} = {}) {
  const objectMaybeSingle = vi.fn().mockResolvedValue({
    data: opts.objectRow === undefined ? null : opts.objectRow,
    error: opts.objectError ?? null,
  })
  // objects select chain:
  //   .select("...").eq("id", ...).eq("user_id", ...).is("deleted_at", null).maybeSingle()
  const objectIs = vi.fn().mockReturnValue({ maybeSingle: objectMaybeSingle })
  const objectEq2 = vi.fn().mockReturnValue({ is: objectIs })
  const objectEq1 = vi.fn().mockReturnValue({ eq: objectEq2 })
  const objectSelect = vi.fn().mockReturnValue({ eq: objectEq1 })

  const jobInsertResult = opts.jobInsertResult ?? { data: { id: "job-1" }, error: null }
  const jobSingle = vi.fn().mockResolvedValue(jobInsertResult)
  const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
  const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "objects") return { select: objectSelect } as never
    if (table === "jobs") return { insert: jobInsert } as never
    return {} as never
  })

  return { objectSelect, objectMaybeSingle, jobInsert, jobSingle }
}

// ---------------------------------------------------------------------------
// Tests — Phase C2a/2 (Studio-gated LLM draft + auto-attach)
// ---------------------------------------------------------------------------

describe("POST /v1/generate-object-asset — auth + validation", () => {
  it("returns 401 when unauthenticated", async () => {
    setupSupabaseMock({
      objectRow: { source_image_url: "https://example.com/g.png", canonical_description: null },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      // intentionally no x-user-id header
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
      },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 400 validation_error on invalid variant for non-custom asset type", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "plutonium", // not in VARIANTS.materials
        name: "Ornate Goblet",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("description longer than 1000 chars is rejected with validation_error", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        description: "x".repeat(1001),
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

describe("POST /v1/generate-object-asset — ownership pre-check (spec Pass 3 F-30 + Pass 10 F-90b)", () => {
  it("returns 404 not_found when attachToObjectId does not exist / is cross-user", async () => {
    setupSupabaseMock({ objectRow: null, objectError: { message: "row not found" } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
      },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    // No LLM call, no enqueue, no credits reserved when pre-check rejects.
    expect(llmComplete).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("returns 404 not_found when attachToObjectId points to a soft-deleted row (uniform code)", async () => {
    // Route's `.is("deleted_at", null)` filter makes a soft-deleted row
    // return null — same uniform 404 as cross-user (Pass 10 F-90b: no
    // enumeration leak via per-path codes).
    setupSupabaseMock({ objectRow: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "angles",
        variant: "front",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "angles",
        attachName: "front",
      },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 400 main_image_required when object exists but has no source_image_url", async () => {
    setupSupabaseMock({
      objectRow: { source_image_url: null, canonical_description: "an ornate brass goblet" },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("main_image_required")
    expect(llmComplete).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })
})

describe("POST /v1/generate-object-asset — Studio-gated LLM draft (spec Pass 7 F-81)", () => {
  it("calls llmComplete to draft description when (attachToObjectId set + description absent + canonical present)", async () => {
    setupSupabaseMock({
      objectRow: {
        source_image_url: "https://example.com/goblet.png",
        canonical_description: "an ornate brass goblet with intricate engravings",
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).toHaveBeenCalledTimes(1)

    const call = vi.mocked(llmComplete).mock.calls[0][0]
    expect(call.modelId).toBe("claude-sonnet-4.6")
    // System prompt is the object-asset-description prompt from Phase C1a.
    expect(call.system.toLowerCase()).toContain("description")
    // Shared LLM options applied: maxTokens 400, temperature 0.8.
    expect(call.maxTokens).toBe(400)
    expect(call.temperature).toBe(0.8)
    // User message contains the canonical + asset type + variant.
    const userText = typeof call.messages[0].content === "string" ? call.messages[0].content : ""
    expect(userText).toContain("materials")
    expect(userText).toContain("wood")
    expect(userText).toContain("an ornate brass goblet with intricate engravings")
  })

  it("does NOT call llmComplete when caller supplied description (MCP/SDK path)", async () => {
    setupSupabaseMock({
      objectRow: {
        source_image_url: "https://example.com/goblet.png",
        canonical_description: "ornate brass goblet",
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        description: "raw oak wood grain with darkened iron banding",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).not.toHaveBeenCalled()
    // Caller's description flows verbatim to the queue.
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.description).toBe("raw oak wood grain with darkened iron banding")
  })

  it("does NOT call llmComplete when attachToObjectId is absent (legacy / non-studio path)", async () => {
    setupSupabaseMock({
      jobInsertResult: { data: { id: "job-1" }, error: null },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        // no description, no attachToObjectId
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("does NOT call llmComplete when canonical_description is null (object has no caption yet)", async () => {
    setupSupabaseMock({
      objectRow: {
        source_image_url: "https://example.com/goblet.png",
        canonical_description: null,
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
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
      objectRow: {
        source_image_url: "https://example.com/goblet.png",
        canonical_description: "an ornate brass goblet",
      },
    })
    vi.mocked(llmComplete).mockRejectedValueOnce(new Error("LLM provider blew up"))

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
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
      objectRow: {
        source_image_url: "https://example.com/goblet.png",
        canonical_description: "an ornate brass goblet",
      },
    })
    vi.mocked(llmComplete).mockResolvedValueOnce({
      text: "  polished brass with engravings  ",
      model: "claude-sonnet-4.6",
    } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
      },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.description).toBe("polished brass with engravings")
  })

  it("custom asset folds userPrompt into LLM input (NOT just the literal 'custom')", async () => {
    // Regression-shape mirror of generate-character-asset.ts:486 — the
    // shared object-asset-description helper prefers userPrompt over the
    // literal variant="custom" string.
    setupSupabaseMock({
      objectRow: {
        source_image_url: "https://example.com/goblet.png",
        canonical_description: "an ornate brass goblet with intricate engravings",
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "custom",
        variant: "custom", // literal — what the studio UI sends for custom assets
        name: "Ornate Goblet",
        userPrompt: "covered in moss, lying in a riverbed",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "variations",
        attachName: "custom-1",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).toHaveBeenCalledTimes(1)
    const call = vi.mocked(llmComplete).mock.calls[0][0]
    const userText = typeof call.messages[0].content === "string" ? call.messages[0].content : ""
    expect(userText).toContain("covered in moss, lying in a riverbed")
    expect(userText).not.toContain('Variant or prompt: "custom"')
  })
})

describe("POST /v1/generate-object-asset — auto-attach payload + source-image resolution", () => {
  it("auto-attach payload fields flow through to the worker queue", async () => {
    setupSupabaseMock({
      objectRow: {
        source_image_url: "https://example.com/goblet.png",
        canonical_description: "an ornate brass goblet",
      },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
        seedPromptHint: "ornate brass goblet",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-object-asset",
      expect.objectContaining({
        jobId: "job-1",
        assetType: "materials",
        variant: "wood",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
        seedPromptHint: "ornate brass goblet",
        usageLogId: "log-1",
      }),
    )
  })

  it("studio path uses object.source_image_url as sourceImageUrl by default", async () => {
    setupSupabaseMock({
      objectRow: {
        source_image_url: "https://example.com/anchor.png",
        canonical_description: "an ornate brass goblet",
      },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
      },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.sourceImageUrl).toBe("https://example.com/anchor.png")
  })

  it("user-supplied sourceImageUrl takes precedence over the object anchor", async () => {
    setupSupabaseMock({
      objectRow: {
        source_image_url: "https://example.com/anchor.png",
        canonical_description: "an ornate brass goblet",
      },
    })

    await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "materials",
        attachName: "wood",
        sourceImageUrl: "https://example.com/explicit-override.png",
      },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.sourceImageUrl).toBe("https://example.com/explicit-override.png")
  })

  it("non-studio path (no attachToObjectId): no anchor lookup, prompt built without LLM, queue payload sound", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "angles",
        variant: "front",
        name: "Ornate Goblet",
        category: "weapon",
        description: "an ornate brass goblet",
        sourceImageUrl: "https://example.com/ref.png",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(llmComplete).not.toHaveBeenCalled()
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-object-asset",
      expect.objectContaining({
        jobId: "job-1",
        assetType: "angles",
        variant: "front",
        sourceImageUrl: "https://example.com/ref.png",
        description: "an ornate brass goblet",
        // No attach metadata when caller didn't ask for it.
        attachToObjectId: undefined,
        attachToColumn: undefined,
        attachName: undefined,
      }),
    )
  })

  it("invalid attachToColumn (not in OBJECT_ATTACH_COLUMNS) is rejected with validation_error", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "materials",
        variant: "wood",
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachToColumn: "bogus_column", // not in OBJECT_ATTACH_COLUMNS
        attachName: "wood",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
