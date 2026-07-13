import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import type { LlmContentBlock } from "../llm-client.js"
import { calculateLlmCost } from "../pricing/llm-cost.js"

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

describe("chat-completions wire mapping (KIE forwards ONLY image_url; drops video_url/audio_url)", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("maps video AND audio blocks to `image_url` parts (Gemini ingests by MIME) — never video_url/audio_url", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
    )
    await llmComplete({
      modelId: "gemini-3-flash",
      system: "",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", url: "https://x/pic.png" },
            { type: "video", url: "https://x/clip.mp4" },
            { type: "audio", url: "https://x/track.mp3" },
            { type: "text", text: "describe" },
          ],
        },
      ],
    })

    const init = fetchMock.mock.calls[0]?.[1] as { body: string }
    const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: unknown }> }
    const parts = body.messages[0].content as Array<Record<string, unknown>>

    // image, video, audio ALL serialize to `image_url` — the only part KIE's
    // chat-completions proxy actually forwards to Gemini.
    expect(parts[0]).toEqual({ type: "image_url", image_url: { url: "https://x/pic.png" } })
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: "https://x/clip.mp4" } })
    expect(parts[2]).toEqual({ type: "image_url", image_url: { url: "https://x/track.mp3" } })
    expect(parts[3]).toEqual({ type: "text", text: "describe" })

    // Regression guard: the silently-dropped shapes must never appear on the wire.
    const types = parts.map((p) => p.type)
    expect(types).not.toContain("video_url")
    expect(types).not.toContain("audio_url")
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

describe("reasoningEffort wire mapping + temperature strip", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock) })
  afterEach(() => { vi.unstubAllGlobals() })

  it("responses format: sends reasoning.effort, never temperature (gpt-5.6-sol)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 1, output_tokens: 1 } }))
    await llmComplete({ modelId: "gpt-5.6-sol", system: "s", messages: [{ role: "user", content: "hi" }], temperature: 0.7, reasoningEffort: "max" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.reasoning).toEqual({ effort: "max" })
    expect(body.temperature).toBeUndefined()
    expect(body.max_output_tokens).toBe(32768) // headroom at max effort with no explicit maxTokens
  })

  it("chat-completions format: sends reasoning_effort only when the model declares levels", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    await llmComplete({ modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "hi" }], reasoningEffort: "high" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.reasoning_effort).toBeUndefined() // gemini has no levels → clamp yields undefined
  })

  it("messages format (KIE Claude): adaptive thinking + output_config.effort, temperature stripped", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }))
    await llmComplete({ modelId: "claude-sonnet-5", system: "s", messages: [{ role: "user", content: "hi" }], temperature: 0.7, reasoningEffort: "high" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.thinking).toEqual({ type: "adaptive" })
    expect(body.output_config).toEqual({ effort: "high" })
    expect(body.temperature).toBeUndefined()
    expect(body.max_tokens).toBe(16384) // high does NOT trigger headroom
  })

  it("messages format: floors an explicit small maxTokens at max effort (legacy 2048 node data must not truncate)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }))
    await llmComplete({ modelId: "claude-sonnet-5", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 2048, reasoningEffort: "max" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.max_tokens).toBe(32768)
  })

  it("messages format: an explicit maxTokens is respected at high effort (floor is xhigh/max only)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }))
    await llmComplete({ modelId: "claude-sonnet-5", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 2048, reasoningEffort: "high" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.max_tokens).toBe(2048)
  })

  it("messages format without effort: no thinking/output_config, temperature still stripped for sonnet-5", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }))
    await llmComplete({ modelId: "claude-sonnet-5", system: "s", messages: [{ role: "user", content: "hi" }], temperature: 0.7 })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.thinking).toBeUndefined()
    expect(body.output_config).toBeUndefined()
    expect(body.temperature).toBeUndefined()
  })

  it("temperature still sent for models that accept it (gemini-3-flash)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    await llmComplete({ modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "hi" }], temperature: 0.5 })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.temperature).toBe(0.5)
  })
})

describe("actual-cost capture from KIE credits_consumed", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock) })
  afterEach(() => { vi.unstubAllGlobals() })

  it("chat-completions: credits_consumed wins over the table estimate", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
        credits_consumed: 2,
      }),
    )
    const res = await llmComplete({
      modelId: "gemini-3-flash",
      system: "",
      messages: [{ role: "user", content: "hi" }],
    })
    // 2 KIE credits * $0.005/credit = $0.01 — NOT the table estimate
    // ((1000 * 0.15 + 500 * 0.90) / 1e6 = 0.0006).
    expect(res.providerCost).toBeCloseTo(0.01, 10)
  })

  it("messages: no credits_consumed field falls back to the table estimate", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1000, output_tokens: 500 },
      }),
    )
    const res = await llmComplete({
      modelId: "claude-opus-4.7",
      system: "",
      messages: [{ role: "user", content: "hi" }],
    })
    expect(res.providerCost).toBeCloseTo(
      calculateLlmCost("claude-opus-4.7", { inputTokens: 1000, outputTokens: 500 }),
      10,
    )
  })

  it("responses: emits [llm-cost-drift] warning when actual diverges >25% from the table estimate", async () => {
    const { llmComplete } = await import("../llm-client.js")
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockResolvedValue(
      jsonResponse({
        output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
        usage: { input_tokens: 1000, output_tokens: 500 },
        credits_consumed: 1,
      }),
    )
    const res = await llmComplete({
      modelId: "gpt-5.4",
      system: "",
      messages: [{ role: "user", content: "hi" }],
    })
    // table estimate = (1000 * 0.70 + 500 * 5.60) / 1e6 = 0.0035
    // actual = 1 credit * $0.005 = 0.005 → drift = |0.005-0.0035|/0.0035 ≈ 0.4286 (> 0.25)
    expect(res.providerCost).toBeCloseTo(0.005, 10)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain("[llm-cost-drift]")
    warnSpy.mockRestore()
  })
})
