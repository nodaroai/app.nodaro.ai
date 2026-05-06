import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import type { LlmContentBlock } from "../llm-client.js"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: undefined, NODE_ENV: "test" },
}))

vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({}),
}))

describe("LlmContentBlock type coverage", () => {
  it("supports the five block types end-to-end (compile-time)", () => {
    const blocks: LlmContentBlock[] = [
      { type: "text", text: "hi" },
      { type: "image", url: "https://x/y.png" },
      { type: "image_base64", mediaType: "image/png", data: "AAAA" },
      { type: "video", url: "https://x/y.mp4" },
      { type: "audio", url: "https://x/y.mp3" },
    ]
    expect(blocks.length).toBe(5)
  })
})

// Helper: a Response stand-in for non-streaming fetch mocks.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// Helper: a Response stand-in for streaming fetch mocks. Body is a ReadableStream
// that yields the supplied chunks then closes.
function streamResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  })
}

describe("KIE error envelope handling (regression: empty output for Gemini/GPT)", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("non-stream chat-completions throws on `{code:500,msg:...}` (KIE maintenance)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 500, msg: "The server is currently being maintained, please try again later~" }),
    )
    await expect(
      llmComplete({
        modelId: "gemini-3-flash",
        system: "",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/code 500.*maintained/i)
  })

  it("non-stream chat-completions throws on `{code:422,msg:'model not supported'}`", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ code: 422, msg: "The model is not supported", data: null }))
    await expect(
      llmComplete({
        modelId: "gpt-5.2",
        system: "",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/code 422.*not supported/i)
  })

  it("non-stream chat-completions returns text on normal OpenAI-shape body (no `code`)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "hello world" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    )
    const res = await llmComplete({
      modelId: "gemini-3-flash",
      system: "",
      messages: [{ role: "user", content: "hi" }],
    })
    expect(res.text).toBe("hello world")
  })

  it("non-stream responses (GPT-5.4) hits /codex/v1/responses URL, not /api/v1/responses", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({
        output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    )
    await llmComplete({
      modelId: "gpt-5.4",
      system: "",
      messages: [{ role: "user", content: "hi" }],
    })
    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? ""
    expect(calledUrl).toBe("https://api.kie.ai/codex/v1/responses")
    expect(calledUrl).not.toContain("/api/v1/responses")
  })

  it("non-stream responses throws envelope error", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ code: 422, msg: "The model is not supported" }))
    await expect(
      llmComplete({
        modelId: "gpt-5.4",
        system: "",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/code 422/)
  })

  it("non-stream messages (Claude via KIE) throws envelope error", async () => {
    const { llmComplete } = await import("../llm-client.js")
    // claude-haiku-4.5 has directFallbackModel set but ANTHROPIC_API_KEY is mocked undefined,
    // so it falls through to KIE messages path.
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: "maintenance" }))
    await expect(
      llmComplete({
        modelId: "claude-haiku-4.5",
        system: "",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/code 500/)
  })

  it("stream chat-completions throws when first chunk is `{code:500}` JSON envelope", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        '{"code":500,"msg":"The server is currently being maintained, please try again later~"}',
      ]),
    )
    const tokens: string[] = []
    await expect(
      llmStream(
        { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "hi" }] },
        (t) => tokens.push(t),
      ),
    ).rejects.toThrow(/code 500.*maintained/i)
    expect(tokens).toEqual([])
  })

  it("stream responses uses /codex/v1/responses URL", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"response.output_text.delta","delta":"hi"}\n',
        "data: [DONE]\n",
      ]),
    )
    await llmStream(
      { modelId: "gpt-5.4", system: "", messages: [{ role: "user", content: "test" }] },
      () => {},
    )
    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? ""
    expect(calledUrl).toBe("https://api.kie.ai/codex/v1/responses")
  })

  it("stream chat-completions delivers tokens from valid SSE", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        "data: [DONE]\n",
      ]),
    )
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "hi" }] },
      (t) => tokens.push(t),
    )
    expect(tokens.join("")).toBe("hello")
    expect(res.text).toBe("hello")
  })
})
