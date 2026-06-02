import { describe, it, expect, beforeEach, vi } from "vitest"
import Fastify from "fastify"
import { promptHelperRoutes } from "../prompt-helper.js"
import { llmComplete } from "../../lib/llm-client.js"

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: async () => ({ usageLogId: "ul-1" }),
}))

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}))

vi.mock("../../lib/llm-client.js", () => ({ llmComplete: vi.fn() }))

vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: { commitCredits: async () => undefined, refundCredits: async () => undefined },
}))

vi.mock("../../lib/config.js", () => ({
  config: { KIE_API_KEY: "kie", ANTHROPIC_API_KEY: "ant" },
}))

function mockLlm(text: string) {
  vi.mocked(llmComplete).mockResolvedValueOnce({ text, usage: { inputTokens: 1, outputTokens: 1 } } as never)
}

async function buildApp() {
  const app = Fastify()
  app.addHook("preHandler", async (req) => { (req as { userId?: string }).userId = "u1" })
  await app.register(promptHelperRoutes)
  return app
}

describe("POST /v1/prompt-helper/wizard", () => {
  beforeEach(() => vi.clearAllMocks())

  it("analyze returns questions", async () => {
    mockLlm(JSON.stringify({ questions: [{ category: "subject", label: "Subject?", options: [{ value: "cat", label: "Cat" }], selected: "cat", allowCustom: true }] }))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: { action: "analyze", nodeType: "generate-image", prompt: "a cat" } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.jobId).toBe("job-1")
    expect(body.questions[0].category).toBe("subject")
  })

  it("generate returns an optimized prompt", async () => {
    mockLlm(JSON.stringify({ prompt: "a photorealistic cat" }))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: { action: "generate", nodeType: "generate-image", selections: [{ category: "subject", value: "cat", isCustom: false }] } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).prompt).toBe("a photorealistic cat")
  })

  it("enhance returns an optimized prompt one-shot (no selections)", async () => {
    mockLlm(JSON.stringify({ prompt: "a cinematic snow leopard at golden hour" }))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: { action: "enhance", nodeType: "generate-image", prompt: "snow leopard" } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.jobId).toBe("job-1")
    expect(body.prompt).toBe("a cinematic snow leopard at golden hour")
  })

  it("rejects an unknown action at the Zod boundary (400)", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: { action: "frobnicate", nodeType: "generate-image" } })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.code).toBe("validation_error")
  })

  it("returns 502 malformed_response when enhance LLM output is not valid JSON", async () => {
    mockLlm("not json at all")
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: { action: "enhance", nodeType: "generate-image", prompt: "x" } })
    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res.body).error.code).toBe("malformed_response")
  })

  it("enhance forwards reference image URLs as multimodal content", async () => {
    mockLlm(JSON.stringify({ prompt: "x" }))
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/prompt-helper/wizard",
      payload: { action: "enhance", nodeType: "generate-image", prompt: "snow leopard", nodeContext: { referenceImageUrls: ["https://x/y.png"] } },
    })
    expect(res.statusCode).toBe(200)
    const content = (vi.mocked(llmComplete).mock.calls[0][0] as { messages: Array<{ content: unknown }> }).messages[0].content as Array<{ type: string; url?: string }>
    expect(Array.isArray(content)).toBe(true)
    expect(content.some((p) => p.type === "image" && p.url === "https://x/y.png")).toBe(true)
  })
})
