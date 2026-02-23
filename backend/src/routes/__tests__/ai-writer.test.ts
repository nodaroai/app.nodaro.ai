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

vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

vi.mock("@/billing/credits.js", () => ({
  CreditsService: { commitCredits: vi.fn().mockResolvedValue(undefined), refundCredits: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock("@/lib/anthropic.js", () => ({
  getAnthropicClient: vi.fn(),
}))

vi.mock("@/lib/sse.js", () => ({
  createSSEStream: vi.fn(),
}))

import { aiWriterRoutes } from "../ai-writer.js"
import { supabase } from "../../lib/supabase.js"
import { CreditsService } from "../../billing/credits.js"
import { getAnthropicClient } from "../../lib/anthropic.js"
import { createSSEStream } from "../../lib/sse.js"

let app: FastifyInstance

const VALID_SYNC_PAYLOAD = {
  systemPrompt: "You are a helpful writer",
  userInput: "Write me a poem about cats",
  userId: "00000000-0000-4000-8000-000000000001",
}

const MOCK_ANTHROPIC_RESPONSE = {
  content: [{ type: "text", text: "Roses are red, cats are great..." }],
  usage: { input_tokens: 50, output_tokens: 100 },
  stop_reason: "end_turn",
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
  await app.register(async (instance) => { await aiWriterRoutes(instance) })
  await app.ready()

  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert, update: mockUpdate } as never)

  const mockCreate = vi.fn().mockResolvedValue(MOCK_ANTHROPIC_RESPONSE)
  vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)
})

afterEach(async () => { await app.close() })

describe("POST /v1/ai-writer/generate (sync)", () => {
  it("returns 400 when userInput is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/ai-writer/generate",
      payload: { systemPrompt: "test", userId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not provided", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/ai-writer/generate",
      payload: { systemPrompt: "test", userInput: "hello" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    const { config } = await import("../../lib/config.js")
    const original = config.ANTHROPIC_API_KEY
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = ""
    const res = await app.inject({ method: "POST", url: "/v1/ai-writer/generate", payload: VALID_SYNC_PAYLOAD })
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = original
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")
  })

  it("returns 500 when job insert fails", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({ method: "POST", url: "/v1/ai-writer/generate", payload: VALID_SYNC_PAYLOAD })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("returns 200 with generatedText on happy path", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/ai-writer/generate", payload: VALID_SYNC_PAYLOAD })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.generatedText).toBe("Roses are red, cats are great...")
    expect(CreditsService.commitCredits).toHaveBeenCalledWith("usage-1")
  })

  it("returns 502 when Claude API throws", async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error("API error"))
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never)

    const res = await app.inject({ method: "POST", url: "/v1/ai-writer/generate", payload: VALID_SYNC_PAYLOAD })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("llm_error")
    expect(CreditsService.refundCredits).toHaveBeenCalledWith("usage-1")
  })
})

describe("POST /v1/ai-writer/generate-stream (SSE)", () => {
  it("returns 400 when userInput is missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/ai-writer/generate-stream",
      payload: { systemPrompt: "test", userId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when userId is not provided", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/ai-writer/generate-stream",
      payload: { systemPrompt: "test", userInput: "hello" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    const { config } = await import("../../lib/config.js")
    const original = config.ANTHROPIC_API_KEY
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = ""
    const res = await app.inject({ method: "POST", url: "/v1/ai-writer/generate-stream", payload: VALID_SYNC_PAYLOAD })
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = original
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")
  })

  it("returns 500 when job insert fails", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

    const res = await app.inject({ method: "POST", url: "/v1/ai-writer/generate-stream", payload: VALID_SYNC_PAYLOAD })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("opens SSE stream and sends events on happy path", async () => {
    const mockSendEvent = vi.fn()
    const mockClose = vi.fn()
    vi.mocked(createSSEStream).mockReturnValue({
      sendEvent: mockSendEvent,
      sendComment: vi.fn(),
      close: mockClose,
      isClosed: false,
    } as never)

    const mockFinalMessage = {
      usage: { input_tokens: 50, output_tokens: 100 },
    }
    const mockStream = {
      on: vi.fn((event: string, cb: (data: string) => void) => {
        if (event === "text") {
          cb("Hello ")
          cb("World")
        }
        return mockStream
      }),
      finalMessage: vi.fn().mockResolvedValue(mockFinalMessage),
      abort: vi.fn(),
    }
    vi.mocked(getAnthropicClient).mockReturnValue({
      messages: {
        create: vi.fn(),
        stream: vi.fn().mockReturnValue(mockStream),
      },
    } as never)

    const res = await app.inject({ method: "POST", url: "/v1/ai-writer/generate-stream", payload: VALID_SYNC_PAYLOAD })

    // SSE endpoint streams via reply.raw, so inject won't see the stream content
    // But we can verify that createSSEStream was called and events were sent
    expect(createSSEStream).toHaveBeenCalled()
    expect(mockSendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "metadata" }),
    )
  })
})
