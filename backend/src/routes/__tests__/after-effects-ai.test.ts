import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// Mocks
vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return { supabase: { from: mockFrom } }
})

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", ANTHROPIC_API_KEY: "test-key", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 2, watermark: false }),
}))

vi.mock("@/middleware/rate-limit.js", () => ({
  rateLimiter: () => async () => {},
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { commitCredits: vi.fn().mockResolvedValue(undefined), refundCredits: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock("@/lib/anthropic.js", () => ({
  getAnthropicClient: vi.fn(),
  CLAUDE_MODEL: "claude-sonnet-4-5-20250929",
}))

vi.mock("@/lib/json-utils.js", () => ({
  extractJsonFromAIResponse: vi.fn((text: string) => text),
}))

vi.mock("@/lib/after-effects-validator.js", () => ({
  validateAfterEffectsPlan: vi.fn(),
}))

vi.mock("@/prompts/after-effects-system.js", () => ({
  AFTER_EFFECTS_SYSTEM_PROMPT: "test system prompt",
}))

vi.mock("@/lib/aspect-dimensions.js", () => ({
  ASPECT_DIMENSIONS: { "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 } },
}))

// Imports after mocks
import { afterEffectsAIRoutes } from "../after-effects-ai.js"
import { supabase } from "../../lib/supabase.js"
import { CreditsService } from "../../ee/billing/credits.js"
import { getAnthropicClient } from "../../lib/anthropic.js"
import { validateAfterEffectsPlan } from "../../lib/after-effects-validator.js"

// Setup
let app: FastifyInstance

const VALID_PAYLOAD = {
  prompt: "cinematic color grade",
  inputVideoUrl: "https://example.com/video.mp4",
  durationSeconds: 10,
  userId: "00000000-0000-4000-8000-000000000001",
}

const MOCK_EFFECT_PLAN = { effects: [{ type: "color-grade", startFrame: 0, endFrame: 300 }] } as never

const MOCK_ANTHROPIC_RESPONSE = {
  content: [{ type: "text", text: JSON.stringify(MOCK_EFFECT_PLAN) }],
  usage: { input_tokens: 100, output_tokens: 200 },
}

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req, reply) => {
    // Stub setTimeout on raw objects for inject() compatibility
    req.raw.setTimeout = (() => req.raw) as never
    reply.raw.setTimeout = (() => reply.raw) as never
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })
  await app.register(async (instance) => { await afterEffectsAIRoutes(instance) })
  await app.ready()

  // Default supabase chain mock for job insert
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert, update: mockUpdate } as never)

  // Default anthropic mock
  const mockCreate = vi.fn().mockResolvedValue(MOCK_ANTHROPIC_RESPONSE)
  vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)

  // Default validator mock
  vi.mocked(validateAfterEffectsPlan).mockReturnValue({
    valid: true,
    plan: MOCK_EFFECT_PLAN,
    errors: [],
    autoFixed: [],
  })
})

afterEach(async () => { await app.close() })

// Tests
describe("POST /v1/after-effects/generate", () => {
  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/after-effects/generate",
      payload: { inputVideoUrl: "https://example.com/video.mp4", durationSeconds: 10, userId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when inputVideoUrl is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/after-effects/generate",
      payload: { prompt: "test", durationSeconds: 10, userId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when durationSeconds is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/after-effects/generate",
      payload: { prompt: "test", inputVideoUrl: "https://example.com/video.mp4", userId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when userId is not a valid UUID", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/after-effects/generate",
      payload: { prompt: "test", inputVideoUrl: "https://example.com/video.mp4", durationSeconds: 10, userId: "not-a-uuid" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    const { config } = await import("../../lib/config.js")
    const original = config.ANTHROPIC_API_KEY
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = ""
    const res = await app.inject({ method: "POST", url: "/v1/after-effects/generate", payload: VALID_PAYLOAD })
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = original
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")
  })

  it("returns 500 when job insert fails", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({ method: "POST", url: "/v1/after-effects/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("returns 200 with effectPlan on happy path", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/after-effects/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.effectPlan).toEqual(MOCK_EFFECT_PLAN)
    expect(body.validationErrors).toEqual([])
    expect(body.autoFixes).toEqual([])
    expect(CreditsService.commitCredits).toHaveBeenCalledWith("usage-1")
  })

  it("returns 502 when Claude API throws", async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"))
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)

    const res = await app.inject({ method: "POST", url: "/v1/after-effects/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("llm_error")
    expect(CreditsService.refundCredits).toHaveBeenCalledWith("usage-1")
  })

  it("returns 502 when AI returns invalid JSON", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "not valid json at all" }],
      usage: { input_tokens: 100, output_tokens: 200 },
    })
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)
    const { extractJsonFromAIResponse } = await import("../../lib/json-utils.js")
    vi.mocked(extractJsonFromAIResponse).mockReturnValueOnce("not valid json")

    const res = await app.inject({ method: "POST", url: "/v1/after-effects/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("llm_error")
    expect(CreditsService.refundCredits).toHaveBeenCalledWith("usage-1")
  })

  it("returns autoFixes when validator auto-fixes issues", async () => {
    vi.mocked(validateAfterEffectsPlan).mockReturnValueOnce({
      valid: true,
      plan: MOCK_EFFECT_PLAN,
      errors: [],
      autoFixed: ["clamped duration to max"],
    })

    const res = await app.inject({ method: "POST", url: "/v1/after-effects/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(200)
    expect(res.json().autoFixes).toEqual(["clamped duration to max"])
  })

  it("attempts to salvage invalid plan by filtering effects", async () => {
    // First call returns invalid, second (filtered) returns valid
    vi.mocked(validateAfterEffectsPlan)
      .mockReturnValueOnce({ valid: false, plan: null, errors: ["bad effect"], autoFixed: [] })
      .mockReturnValueOnce({ valid: true, plan: MOCK_EFFECT_PLAN, errors: [], autoFixed: [] })

    const planWithMixedEffects = {
      effects: [
        { type: "color-grade", startFrame: 0, endFrame: 300 },
        { type: "unknown-effect", startFrame: 0, endFrame: 100 },
      ],
    }
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(planWithMixedEffects) }],
      usage: { input_tokens: 100, output_tokens: 200 },
    })
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)

    const res = await app.inject({ method: "POST", url: "/v1/after-effects/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(200)
    expect(res.json().effectPlan).toEqual(MOCK_EFFECT_PLAN)
  })
})
