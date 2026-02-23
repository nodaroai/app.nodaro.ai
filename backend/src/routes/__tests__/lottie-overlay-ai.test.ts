import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

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
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1" }),
}))

vi.mock("@/middleware/rate-limit.js", () => ({ rateLimiter: () => async () => {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/billing/credits.js", () => ({
  CreditsService: { commitCredits: vi.fn().mockResolvedValue(undefined), refundCredits: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock("@/lib/anthropic.js", () => ({
  getAnthropicClient: vi.fn(),
  CLAUDE_MODEL: "claude-sonnet-4-5-20250929",
}))

vi.mock("@/lib/json-utils.js", () => ({
  extractJsonFromAIResponse: vi.fn((text: string) => text),
}))

vi.mock("@/lib/lottie-overlay-validator.js", () => ({
  validateLottieOverlayPlan: vi.fn(),
}))

vi.mock("@/prompts/lottie-overlay-system.js", () => ({
  LOTTIE_OVERLAY_SYSTEM_PROMPT: "test system prompt",
}))

import { lottieOverlayAIRoutes } from "../lottie-overlay-ai.js"
import { supabase } from "../../lib/supabase.js"
import { CreditsService } from "../../billing/credits.js"
import { getAnthropicClient } from "../../lib/anthropic.js"
import { validateLottieOverlayPlan } from "../../lib/lottie-overlay-validator.js"

let app: FastifyInstance

const VALID_PAYLOAD = {
  prompt: "sparkle overlays",
  inputVideoUrl: "https://example.com/video.mp4",
  durationSeconds: 10,
  userId: "00000000-0000-4000-8000-000000000001",
}

const MOCK_OVERLAY_PLAN = { overlays: [{ lottieUrl: "https://example.com/sparkle.json", startFrame: 0, endFrame: 300 }] } as never

const MOCK_ANTHROPIC_RESPONSE = {
  content: [{ type: "text", text: JSON.stringify(MOCK_OVERLAY_PLAN) }],
  usage: { input_tokens: 100, output_tokens: 200 },
}

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req, reply) => {
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })
  await app.register(async (instance) => { await lottieOverlayAIRoutes(instance) })
  await app.ready()

  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert, update: mockUpdate } as never)

  const mockCreate = vi.fn().mockResolvedValue(MOCK_ANTHROPIC_RESPONSE)
  vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)

  vi.mocked(validateLottieOverlayPlan).mockReturnValue({
    valid: true,
    plan: MOCK_OVERLAY_PLAN,
    errors: [],
    autoFixed: [],
  })
})

afterEach(async () => { await app.close() })

describe("POST /v1/lottie-overlay/generate", () => {
  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/lottie-overlay/generate",
      payload: { inputVideoUrl: "https://example.com/video.mp4", durationSeconds: 10, userId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when inputVideoUrl is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/lottie-overlay/generate",
      payload: { prompt: "test", durationSeconds: 10, userId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when durationSeconds is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/lottie-overlay/generate",
      payload: { prompt: "test", inputVideoUrl: "https://example.com/video.mp4", userId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when userId is invalid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/lottie-overlay/generate",
      payload: { prompt: "test", inputVideoUrl: "https://example.com/video.mp4", durationSeconds: 10, userId: "not-uuid" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    const { config } = await import("../../lib/config.js")
    const original = config.ANTHROPIC_API_KEY
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = ""
    const res = await app.inject({ method: "POST", url: "/v1/lottie-overlay/generate", payload: VALID_PAYLOAD })
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = original
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")
  })

  it("returns 500 when job insert fails", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({ method: "POST", url: "/v1/lottie-overlay/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("returns 200 with overlayPlan on happy path", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/lottie-overlay/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.overlayPlan).toEqual(MOCK_OVERLAY_PLAN)
    expect(body.validationErrors).toEqual([])
    expect(body.autoFixes).toEqual([])
    expect(CreditsService.commitCredits).toHaveBeenCalledWith("usage-1")
  })

  it("returns 502 when Claude API throws", async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error("API error"))
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)

    const res = await app.inject({ method: "POST", url: "/v1/lottie-overlay/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("llm_error")
    expect(CreditsService.refundCredits).toHaveBeenCalledWith("usage-1")
  })

  it("returns 502 when AI returns invalid JSON", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "not json" }],
      usage: { input_tokens: 100, output_tokens: 200 },
    })
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)
    const { extractJsonFromAIResponse } = await import("../../lib/json-utils.js")
    vi.mocked(extractJsonFromAIResponse).mockReturnValueOnce("not json")

    const res = await app.inject({ method: "POST", url: "/v1/lottie-overlay/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("llm_error")
    expect(CreditsService.refundCredits).toHaveBeenCalledWith("usage-1")
  })

  it("returns autoFixes when validator auto-fixes issues", async () => {
    vi.mocked(validateLottieOverlayPlan).mockReturnValueOnce({
      valid: true,
      plan: MOCK_OVERLAY_PLAN,
      errors: [],
      autoFixed: ["fixed overlay timing"],
    })

    const res = await app.inject({ method: "POST", url: "/v1/lottie-overlay/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(200)
    expect(res.json().autoFixes).toEqual(["fixed overlay timing"])
  })

  it("accepts optional lottieAssets array", async () => {
    const payload = {
      ...VALID_PAYLOAD,
      lottieAssets: [{ id: "asset-1", url: "https://example.com/sparkle.json", name: "Sparkle" }],
    }
    const res = await app.inject({ method: "POST", url: "/v1/lottie-overlay/generate", payload })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
  })
})
