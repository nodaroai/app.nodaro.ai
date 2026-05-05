import { describe, it, expect, beforeEach, vi } from "vitest"
import Fastify from "fastify"
import { llmChatRoutes } from "../llm-chat.js"

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: async () => ({ usageLogId: "ul-1" }),
}))

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: "job-1" }, error: null }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}))

vi.mock("../../lib/llm-client.js", () => ({
  llmComplete: vi.fn(async () => ({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 } })),
  llmStream: vi.fn(),
}))

vi.mock("../../billing/credits.js", () => ({
  CreditsService: { commitCredits: async () => undefined, refundCredits: async () => undefined },
}))

vi.mock("../../lib/config.js", () => ({
  config: { KIE_API_KEY: "kie", ANTHROPIC_API_KEY: "ant" },
}))

async function buildApp() {
  const app = Fastify()
  // Stub raw.setTimeout / once on inject's fake req+reply BEFORE preHandler runs.
  // light-my-request's Request/Response don't expose .socket, so the real
  // IncomingMessage.setTimeout (which reaches into socket.setTimeout) blows up
  // with "listener must be a function". Override with a no-op for tests.
  app.addHook("onRequest", async (req, reply) => {
    ;(req.raw as { setTimeout: (ms: number) => void }).setTimeout = () => {}
    ;(reply.raw as { setTimeout: (ms: number) => void }).setTimeout = () => {}
    if (typeof (req.raw as { once?: unknown }).once !== "function") {
      ;(req.raw as { once: (event: string, listener: () => void) => void }).once = () => {}
    }
  })
  app.addHook("preHandler", async (req) => { (req as { userId?: string }).userId = "u1" })
  await app.register(llmChatRoutes)
  return app
}

describe("POST /v1/llm-chat/generate — capability filter", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects video ref + claude with 400 modality_not_supported", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "describe this",
        referenceVideoUrls: ["https://x/y.mp4"],
        llmModel: "claude-sonnet-4.6",
      },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe("modality_not_supported")
  })

  it("accepts video ref + gemini-3-flash", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "describe this",
        referenceVideoUrls: ["https://x/y.mp4"],
        llmModel: "gemini-3-flash",
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it("rejects audio ref + gpt-5.4 with 400", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "transcribe",
        referenceAudioUrls: ["https://x/y.mp3"],
        llmModel: "gpt-5.4",
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it("accepts image ref + claude (preserves prior behavior)", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "describe",
        referenceImageUrls: ["https://x/y.png"],
        llmModel: "claude-sonnet-4.6",
      },
    })
    expect(res.statusCode).toBe(200)
  })
})
