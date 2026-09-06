import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import type { LlmContentBlock } from "../llm-client.js"
import { calculateLlmCost } from "../pricing/llm-cost.js"

vi.mock("../config.js", () => ({
  // KIE_API_BASE_URL is what providers/kie/client.ts builds KIE_API_BASE from,
  // and this suite asserts on whole URLs — omit it and every assertion reads
  // "undefined/codex/v1/responses".
  config: {
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    NODE_ENV: "test",
  },
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

  it("throws on an fps-bearing video block instead of sampling at 1 fps anyway", async () => {
    const { llmComplete } = await import("../llm-client.js")

    // `image_url` smuggling hands Gemini a bare URL, so a requested sampling
    // rate has nowhere to go and Gemini falls back to its 1 fps default. That
    // returns HTTP 200 with analysis grounded in a third of the frames the
    // caller asked for — indistinguishable from success. Fail loudly instead.
    await expect(
      llmComplete({
        modelId: "gemini-3-flash",
        system: "",
        messages: [{ role: "user", content: [{ type: "video", url: "https://x/clip.mp4", fps: 3 }] }],
      }),
    ).rejects.toThrow(/cannot carry a sampling rate/)

    expect(fetchMock).not.toHaveBeenCalled()
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

/**
 * A Claude `messages` SSE response. Non-streamed Claude calls are served over
 * KIE's STREAMING wire and collapsed back to one response
 * (KIE_CLAUDE_NONSTREAM_VERIFIED = false — its `stream: false` endpoint 500s),
 * so KIE-lane tests must answer with SSE rather than a JSON body.
 */
function claudeSse(
  text: string,
  usage: { input_tokens: number; output_tokens: number },
  creditsConsumed?: number,
): Response {
  return streamResponse([
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n`,
    `data: ${JSON.stringify({ type: "message_delta", usage, ...(creditsConsumed !== undefined ? { credits_consumed: creditsConsumed } : {}) })}\n`,
  ])
}

/**
 * A `responses` SSE response. gpt-6-astra is served over KIE's STREAMING wire
 * and collapsed back to one response (`kieCollapseStream` — its `stream: false`
 * lane 500s ~2 calls in 3, measured 2026-09-06), so non-streamed astra tests
 * must answer with SSE rather than a JSON body. Usage rides the
 * `response.completed` frame, exactly as on the live wire.
 */
function responsesSse(text: string, usage: { input_tokens: number; output_tokens: number }): Response {
  return streamResponse([
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n`,
    `data: ${JSON.stringify({ type: "response.completed", response: { usage } })}\n`,
    "data: [DONE]\n",
  ])
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

  it("non-stream responses (Grok 4.6) hits the grok family path with the dash slug and no sampling params", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({
        output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    )
    await llmComplete({
      modelId: "grok-4.6",
      system: "be terse",
      messages: [{ role: "user", content: "hi" }],
      // Live-probed 2026-08-18: grok's endpoint silently ignores temperature —
      // the registry strips it, so it must never reach the wire.
      temperature: 0.2,
    })
    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? ""
    expect(calledUrl).toBe("https://api.kie.ai/grok/v1/responses")
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body)
    expect(body.model).toBe("grok-4-6")
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
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
    // Fresh Response per call: this path is served over the collapsed stream and
    // retries once, and a single Response's body can only be read one time.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ code: 500, msg: "maintenance" })))
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

  it("stream responses (Grok 4.6) uses /grok/v1/responses and delivers tokens", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"response.output_text.delta","delta":"hi"}\n',
        "data: [DONE]\n",
      ]),
    )
    const tokens: string[] = []
    await llmStream(
      { modelId: "grok-4.6", system: "", messages: [{ role: "user", content: "test" }] },
      (t) => tokens.push(t),
    )
    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? ""
    expect(calledUrl).toBe("https://api.kie.ai/grok/v1/responses")
    expect(tokens).toEqual(["hi"])
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

  // gpt-6-astra, registered 2026-09-06. Same responses-dialect contract as the
  // GPT-5.6 family, with one extra lever: it reasons with NO reasoning param
  // sent (`thinkingDefaultOn`), so the output cap has to carry thinking too.
  it("responses format: sends reasoning.effort, never temperature/top_p (gpt-6-astra)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    // SSE, not a JSON body: astra is served collapsed (`kieCollapseStream`).
    fetchMock.mockImplementation(() => Promise.resolve(responsesSse("ok", { input_tokens: 1, output_tokens: 1 })))
    await llmComplete({
      modelId: "gpt-6-astra",
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      // Live-probed 2026-09-06: the endpoint echoed temperature 1.0 back after
      // being sent 0.2 — silently ignored, so the registry strips it and it
      // must never reach the wire (same posture as gpt-5.6-sol / grok-4.6).
      temperature: 0.2,
      topP: 0.9,
      // Legacy node data persists a 2048 cap; thinking shares that budget here.
      maxTokens: 2048,
      reasoningEffort: "xhigh",
      jsonSchema: { name: "answer", schema: { type: "object", properties: { a: { type: "string" } } } },
    })
    // The /codex/ family path is DERIVED from vendor "openai" — the slug is the
    // body model only, never a path segment.
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.kie.ai/codex/v1/responses")
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.model).toBe("gpt-6-astra")
    // xhigh is in the model's declared ladder (low|medium|high|xhigh) — it
    // survives the clamp instead of being knocked down to high.
    expect(body.reasoning).toEqual({ effort: "xhigh" })
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
    // The explicit 2048 is FLOORED to the reasoning headroom, not honoured.
    expect(body.max_output_tokens).toBe(32768)
    // structuredOutputMode "responses-json-schema" — live-verified 2026-09-06:
    // KIE's `response.created` echo showed the server defaulting `strict: true`
    // on its side; the client ships `strict: false` as for every responses
    // model, and the reply came back schema-valid.
    expect(body.text).toEqual({
      format: { type: "json_schema", name: "answer", strict: false, schema: { type: "object", properties: { a: { type: "string" } } } },
    })
  })

  it("responses format: floors max_output_tokens with NO effort param because gpt-6-astra reasons by default", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockImplementation(() => Promise.resolve(responsesSse("ok", { input_tokens: 1, output_tokens: 1 })))
    // This is the whole justification for `thinkingDefaultOn`: with no reasoning
    // param the server still reasons at "medium" (live-probed 2026-09-06), so a
    // 2048 cap would be shared with thinking and truncate a paid-for answer.
    await llmComplete({ modelId: "gpt-6-astra", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 2048 })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.reasoning).toBeUndefined()
    expect(body.max_output_tokens).toBe(32768)
  })

  // gemini-3.8-flash, registered 2026-09-06 — the third model on the KIE
  // OpenAI-compatible dialect, and the first whose output cap was MEASURED
  // rather than pinned to the 8192 KIE-safe intersection its 3.6/3.7 siblings sit at.
  it("chat-completions format (gemini-3.8-flash): slug path, reasoning_effort, response_format, measured 16384 cap", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    await llmComplete({
      modelId: "gemini-3.8-flash",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "high",
      jsonSchema: { name: "answer", schema: { type: "object", properties: { a: { type: "string" } } } },
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions")
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.model).toBe("gemini-3-8-flash-openai")
    // Unlike gemini-3-flash (no declared levels → clamped away), 3.8 declares
    // low|high, so the effort actually reaches the wire.
    expect(body.reasoning_effort).toBe("high")
    // 16384, NOT the 8192 its 3.6/3.7 siblings carry: max_tokens 20000 was
    // honoured for 14,892 completion tokens on 2026-09-06, so the registry
    // raised the cap and this is the only place that reaches the wire.
    expect(body.max_tokens).toBe(16384)
    // structuredOutputMode "kie-response-format" — live-verified enforced, not
    // accepted-and-ignored.
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "answer", strict: false, schema: { type: "object", properties: { a: { type: "string" } } } },
    })
  })

  it("chat-completions format: clamps an above-ladder effort down to gemini-3.8-flash's KIE-safe max", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    // KIE's endpoint enumerates low | high only. "max" must land on "high"
    // rather than reaching the wire and 400ing — and, being clamped, must NOT
    // trip the xhigh/max output-headroom floor either.
    await llmComplete({ modelId: "gemini-3.8-flash", system: "", messages: [{ role: "user", content: "hi" }], reasoningEffort: "max" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.reasoning_effort).toBe("high")
    expect(body.max_tokens).toBe(16384)
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
    fetchMock.mockResolvedValue(claudeSse("ok", { input_tokens: 1, output_tokens: 1 }))
    await llmComplete({ modelId: "claude-sonnet-5", system: "s", messages: [{ role: "user", content: "hi" }], temperature: 0.7, reasoningEffort: "high" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.thinking).toEqual({ type: "adaptive" })
    expect(body.output_config).toEqual({ effort: "high" })
    expect(body.temperature).toBeUndefined()
    expect(body.max_tokens).toBe(16384) // high does NOT trigger headroom
  })

  it("messages format: floors an explicit small maxTokens at max effort (legacy 2048 node data must not truncate)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(claudeSse("ok", { input_tokens: 1, output_tokens: 1 }))
    await llmComplete({ modelId: "claude-sonnet-5", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 2048, reasoningEffort: "max" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.max_tokens).toBe(32768)
  })

  it("messages format: an explicit maxTokens is respected at high effort (floor is xhigh/max only)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(claudeSse("ok", { input_tokens: 1, output_tokens: 1 }))
    await llmComplete({ modelId: "claude-sonnet-5", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 2048, reasoningEffort: "high" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.max_tokens).toBe(2048)
  })

  it("messages format without effort: no thinking/output_config, temperature still stripped for sonnet-5", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(claudeSse("ok", { input_tokens: 1, output_tokens: 1 }))
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

// ---------------------------------------------------------------------------
// The collapsed serving path for gpt-6-astra. These go through the REAL
// llmComplete entry point with a mocked global fetch — the point is the
// DISPATCH (registry flag → collapsed lane), which a direct call to the
// adapter would not exercise.
//
// Why it exists: measured on KIE 2026-09-06, 12 identical requests —
// `stream: false` succeeded 2/6 and 500'd 4/6 (after 34, 34, 35 and 64 s),
// while `stream: true` succeeded 5/6 in 4–5 s. The non-stream lane is the
// broken half, so llmComplete opens the streaming wire and collapses it.
// ---------------------------------------------------------------------------
describe("kieCollapseStream: gpt-6-astra served over the streaming wire", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnings: string[]
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    warnings = []
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { warnings.push(args.map(String).join(" ")) })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it("llmComplete posts stream:true and returns the collapsed text + usage from response.completed", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        streamResponse([
          'data: {"type":"response.created","response":{"id":"resp_1"}}\n',
          'data: {"type":"response.output_text.delta","delta":"hel"}\n',
          'data: {"type":"response.output_text.delta","delta":"lo"}\n',
          `data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 11, output_tokens: 4 } } })}\n`,
          "data: [DONE]\n",
        ]),
      ),
    )

    const res = await llmComplete({ modelId: "gpt-6-astra", system: "s", messages: [{ role: "user", content: "hi" }] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.kie.ai/codex/v1/responses")
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    // The whole point of the flag: a NON-streaming caller still opens the
    // streaming wire, because that is the half of KIE's lane that answers.
    expect(body.stream).toBe(true)
    expect(body.model).toBe("gpt-6-astra")
    // Deltas concatenate into the single response a non-streaming caller expects.
    expect(res.text).toBe("hello")
    expect(res.usage).toEqual({ inputTokens: 11, outputTokens: 4 })
    // No `credits_consumed` on the SSE, so providerCost is the rate-table
    // estimate rather than the real charge — the documented cost of this lane.
    expect(res.providerCost).toBe(calculateLlmCost("gpt-6-astra", { inputTokens: 11, outputTokens: 4 }))
  })

  it("retries exactly once after an `event: error` frame, then succeeds", async () => {
    const { llmComplete } = await import("../llm-client.js")
    // 1 of the 6 streaming probes died without a response.completed — the same
    // silent-failure shape parseSseStream turns into a throw.
    fetchMock
      .mockResolvedValueOnce(
        streamResponse(['data: {"type":"error","error":{"type":"server_error","message":"Server exception"}}\n']),
      )
      .mockImplementation(() => Promise.resolve(responsesSse("second try", { input_tokens: 3, output_tokens: 2 })))

    const res = await llmComplete({ modelId: "gpt-6-astra", system: "s", messages: [{ role: "user", content: "hi" }] })

    expect(res.text).toBe("second try")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The retry is announced, not silent — an ops signal that KIE's stream
    // wobbled without turning it into a caller-visible failure.
    expect(warnings.some((w) => w.startsWith("[llm-kie-stream-retry] gpt-6-astra"))).toBe(true)
  })

  // The silent half of that same probe: the stream simply STOPS after
  // `response.created` — no error frame, no `response.completed`. Nothing in
  // parseSseStream throws for it, so before the guard this returned `text: ""`
  // as a SUCCESS: llm-chat would show the user an empty reply and
  // llmCompleteStructured would parse "" and feed a fake `{}` back to the model.
  // The non-stream lane this replaces 500'd instead, so an empty success would
  // be a regression in failure honesty.
  it("treats a stream that closes with no output as a failure — retried once, then succeeds", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock
      .mockResolvedValueOnce(
        streamResponse(['data: {"type":"response.created","response":{"id":"resp_1"}}\n', "data: [DONE]\n"]),
      )
      .mockImplementation(() => Promise.resolve(responsesSse("second try", { input_tokens: 3, output_tokens: 2 })))

    const res = await llmComplete({ modelId: "gpt-6-astra", system: "s", messages: [{ role: "user", content: "hi" }] })

    expect(res.text).toBe("second try")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(warnings.some((w) => w.startsWith("[llm-kie-stream-retry] gpt-6-astra"))).toBe(true)
  })

  it("throws — never returns an empty success — when both streams close with no output", async () => {
    const { llmComplete } = await import("../llm-client.js")
    // A fresh Response per call: a body can only be read once.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        streamResponse(['data: {"type":"response.created","response":{"id":"resp_1"}}\n', "data: [DONE]\n"]),
      ),
    )

    await expect(
      llmComplete({ modelId: "gpt-6-astra", system: "s", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/closed without output/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("retries exactly once after a rejected fetch, then succeeds", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockImplementation(() => Promise.resolve(responsesSse("recovered", { input_tokens: 3, output_tokens: 2 })))

    const res = await llmComplete({ modelId: "gpt-6-astra", system: "s", messages: [{ role: "user", content: "hi" }] })

    expect(res.text).toBe("recovered")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("throws after two failed streams — the retry is bounded at one", async () => {
    const { llmComplete } = await import("../llm-client.js")
    // Bounded on purpose: nothing sits behind this lane for a responses-format
    // model (no direct-vendor fallback), so a genuinely down endpoint has to
    // surface fast instead of multiplying the caller's wait.
    fetchMock.mockRejectedValue(new Error("socket hang up"))

    await expect(
      llmComplete({ modelId: "gpt-6-astra", system: "s", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/socket hang up/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("leaves gpt-5.6-sol on the non-streaming lane — the FLAG drives dispatch, not the format", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
      ),
    )

    const res = await llmComplete({ modelId: "gpt-5.6-sol", system: "s", messages: [{ role: "user", content: "hi" }] })

    // Same kieFormat "responses", same /codex path — and still stream:false,
    // because gpt-5.6-sol does not declare kieCollapseStream. KIE serves the
    // GPT-5.6 family non-stream reliably (live-verified 2026-07-14); collapsing
    // it too would trade real `credits_consumed` for a rate-table estimate for
    // no reliability gain.
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.kie.ai/codex/v1/responses")
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.stream).toBe(false)
    expect(res.text).toBe("ok")
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
    fetchMock.mockResolvedValue(claudeSse("ok", { input_tokens: 1000, output_tokens: 500 }))
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

  // KIE's Claude SSE carries credits_consumed (verified live 2026-08-06), so
  // collapsing the stream must NOT quietly downgrade actual-cost capture to the
  // rate-table estimate — real billing still wins, same as the non-stream path.
  it("messages: credits_consumed on the collapsed stream beats the table estimate", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(claudeSse("ok", { input_tokens: 1000, output_tokens: 500 }, 2))
    const res = await llmComplete({
      modelId: "claude-opus-4.7",
      system: "",
      messages: [{ role: "user", content: "hi" }],
    })
    // 2 KIE credits * $0.005 = $0.01, distinct from the table estimate.
    expect(res.providerCost).toBeCloseTo(0.01, 10)
    expect(res.providerCost).not.toBeCloseTo(
      calculateLlmCost("claude-opus-4.7", { inputTokens: 1000, outputTokens: 500 }),
      6,
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

describe("media fail-open guard (minPromptTokens)", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock) })
  afterEach(() => { vi.unstubAllGlobals() })

  // The hazard, measured 2026-07-31: 3 of 7 KIE calls carrying a freshly
  // uploaded video reported prompt tokens equal to the SYSTEM PROMPT ALONE and
  // returned a fluent, schema-valid analysis of a video that does not exist.
  // Well-formed text + valid schema means nothing downstream can catch it; the
  // token count is the only honest signal.
  it("throws when the provider reports fewer prompt tokens than the floor", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "a confident description of nothing" } }],
        usage: { prompt_tokens: 7950, completion_tokens: 1800 },
      }),
    )
    await expect(
      llmComplete({
        modelId: "gemini-3-flash",
        system: "",
        messages: [{ role: "user", content: "analyse this video" }],
        minPromptTokens: 9000,
      }),
    ).rejects.toThrow(/media_not_ingested/)
  })

  it("passes when the media was actually ingested", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 13145, completion_tokens: 1800 },
      }),
    )
    const res = await llmComplete({
      modelId: "gemini-3-flash",
      system: "",
      messages: [{ role: "user", content: "analyse this video" }],
      minPromptTokens: 9000,
    })
    expect(res.text).toBe("ok")
  })

  // The collapsed lane (`kieCollapseStream`) returns parseSseStream's own object
  // instead of calling buildResponse, so without an explicit re-apply it would
  // be the one KIE format that silently ignores the floor the field's docstring
  // promises on all three. Usage rides `response.completed`, exactly as live.
  it("still throws on the collapsed responses lane, reading usage off response.completed", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockImplementation(() =>
      Promise.resolve(responsesSse("a confident description of nothing", { input_tokens: 7950, output_tokens: 1800 })),
    )
    await expect(
      llmComplete({
        modelId: "gpt-6-astra",
        system: "",
        messages: [{ role: "user", content: "analyse this media" }],
        minPromptTokens: 9000,
      }),
    ).rejects.toThrow(/media_not_ingested/)
    // NOT retried: an un-ingested answer is the provider answering, not the
    // stream failing, so it must not spend a second billed call.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("passes on the collapsed responses lane when the media was ingested", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockImplementation(() => Promise.resolve(responsesSse("ok", { input_tokens: 13145, output_tokens: 1800 })))
    const res = await llmComplete({
      modelId: "gpt-6-astra",
      system: "",
      messages: [{ role: "user", content: "analyse this media" }],
      minPromptTokens: 9000,
    })
    expect(res.text).toBe("ok")
    expect(res.usage).toEqual({ inputTokens: 13145, outputTokens: 1800 })
  })

  // Must never turn a working call into a failure: no floor set, or a provider
  // that reports no usage at all, both pass through untouched.
  it("is inert without a floor, and when usage is absent", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({ choices: [{ message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
    )
    const noFloor = await llmComplete({
      modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "hi" }],
    })
    expect(noFloor.text).toBe("ok")

    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { role: "assistant", content: "ok" } }] }))
    const noUsage = await llmComplete({
      modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "hi" }], minPromptTokens: 9000,
    })
    expect(noUsage.text).toBe("ok")
  })
})
