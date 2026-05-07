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

vi.mock("@/lib/three-d-title-validator.js", () => ({
  validateThreeDTitlePlan: vi.fn(),
}))

vi.mock("@/prompts/three-d-title-system.js", () => ({
  THREE_D_TITLE_SYSTEM_PROMPT: "test system prompt",
}))

vi.mock("@/lib/aspect-dimensions.js", () => ({
  ASPECT_DIMENSIONS: { "16:9": { width: 1920, height: 1080 } },
}))

import { threeDTitleAIRoutes } from "../three-d-title-ai.js"
import { supabase } from "../../lib/supabase.js"
import { CreditsService } from "../../ee/billing/credits.js"
import { getAnthropicClient } from "../../lib/anthropic.js"
import { validateThreeDTitlePlan } from "../../lib/three-d-title-validator.js"

let app: FastifyInstance

const VALID_PAYLOAD = {
  prompt: "epic 3D title",
  durationSeconds: 10,
  userId: "00000000-0000-4000-8000-000000000001",
}

const MOCK_TITLE_PLAN = { texts: [{ text: "EPIC", fontSize: 72 }], camera: { position: [0, 0, 5] } } as never

const MOCK_ANTHROPIC_RESPONSE = {
  content: [{ type: "text", text: JSON.stringify(MOCK_TITLE_PLAN) }],
  usage: { input_tokens: 100, output_tokens: 300 },
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
  await app.register(async (instance) => { await threeDTitleAIRoutes(instance) })
  await app.ready()

  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert, update: mockUpdate } as never)

  const mockCreate = vi.fn().mockResolvedValue(MOCK_ANTHROPIC_RESPONSE)
  vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)

  vi.mocked(validateThreeDTitlePlan).mockReturnValue({
    valid: true, plan: MOCK_TITLE_PLAN, errors: [], autoFixed: [],
  })
})

afterEach(async () => { await app.close() })

describe("POST /v1/3d-title/generate", () => {
  it("returns 400 when prompt is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/3d-title/generate",
      payload: { durationSeconds: 10, userId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when durationSeconds exceeds max of 60", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/3d-title/generate",
      payload: { prompt: "test", durationSeconds: 61, userId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 when userId is invalid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/3d-title/generate",
      payload: { prompt: "test", durationSeconds: 10, userId: "bad" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    const { config } = await import("../../lib/config.js")
    const original = config.ANTHROPIC_API_KEY
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = ""
    const res = await app.inject({ method: "POST", url: "/v1/3d-title/generate", payload: VALID_PAYLOAD })
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = original
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")
  })

  it("returns 500 when job insert fails", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({ method: "POST", url: "/v1/3d-title/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("returns 200 with titlePlan on happy path", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/3d-title/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.titlePlan).toEqual(MOCK_TITLE_PLAN)
    expect(body.validationErrors).toEqual([])
    expect(CreditsService.commitCredits).toHaveBeenCalledWith("usage-1")
  })

  it("returns 502 when Claude API throws", async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error("API error"))
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)

    const res = await app.inject({ method: "POST", url: "/v1/3d-title/generate", payload: VALID_PAYLOAD })
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

    const res = await app.inject({ method: "POST", url: "/v1/3d-title/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(502)
    expect(CreditsService.refundCredits).toHaveBeenCalledWith("usage-1")
  })

  it("returns autoFixes when validator auto-fixes issues", async () => {
    vi.mocked(validateThreeDTitlePlan).mockReturnValueOnce({
      valid: true, plan: MOCK_TITLE_PLAN, errors: [], autoFixed: ["fixed camera angle"],
    })

    const res = await app.inject({ method: "POST", url: "/v1/3d-title/generate", payload: VALID_PAYLOAD })
    expect(res.statusCode).toBe(200)
    expect(res.json().autoFixes).toEqual(["fixed camera angle"])
  })

  it("accepts optional backgroundMediaUrl", async () => {
    const payload = { ...VALID_PAYLOAD, backgroundMediaUrl: "https://example.com/bg.mp4" }
    const res = await app.inject({ method: "POST", url: "/v1/3d-title/generate", payload })
    expect(res.statusCode).toBe(200)
  })
})
