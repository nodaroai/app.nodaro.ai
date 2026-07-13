import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "test-anthropic-key", NODE_ENV: "test" },
}))
const createSpy = vi.fn()
const streamSpy = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: createSpy, stream: streamSpy } }),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
const kieOk = () => jsonResponse({ content: [{ type: "text", text: "kie" }], usage: { input_tokens: 1, output_tokens: 1 } })
const anthropicOk = { content: [{ type: "text", text: "direct" }], usage: { input_tokens: 1, output_tokens: 1 } }

/** A Response whose body is an SSE stream yielding the given raw chunks, then closing. */
function streamResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

/**
 * SSE stream that delivers one valid chunk then dies mid-stream — the SECOND
 * pull() throws. Distinct from a stream that fails before any data ever
 * arrives (use `streamResponse` with the `{code,msg}` JSON envelope for that).
 */
function streamThatFailsAfterFirstChunk(firstChunk: string): Response {
  let pulls = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      if (pulls === 1) {
        controller.enqueue(new TextEncoder().encode(firstChunk))
        return
      }
      throw new Error("stream broke mid-way")
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

/**
 * Minimal stand-in for the Anthropic SDK's `messages.stream(...)` return value —
 * implements only what `streamAnthropicDirect` consumes: `.on("text", cb)` and
 * `.finalMessage()`.
 */
function anthropicStreamStub(text: string, usage = { input_tokens: 4, output_tokens: 4 }) {
  return {
    on(event: string, cb: (delta: string) => void) {
      if (event === "text") cb(text)
      return this
    },
    abort() {},
    finalMessage: () => Promise.resolve({ usage }),
  }
}

describe("preferKie routing (claude-sonnet-5 / claude-opus-4.8)", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); createSpy.mockReset().mockResolvedValue(anthropicOk) })
  afterEach(() => { vi.unstubAllGlobals() })

  it("plain call goes to KIE first", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieOk())
    const res = await llmComplete({ modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0][0] as string)).toContain("/claude/v1/messages")
    expect(createSpy).not.toHaveBeenCalled()
    expect(res.text).toBe("kie")
  })

  it("falls back to direct Anthropic when KIE errors", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: "maintenance" }))
    const res = await llmComplete({ modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(createSpy).toHaveBeenCalledOnce()
    expect(res.text).toBe("direct")
  })

  // Forced tool_choice passthrough through the KIE proxy is verified — so
  // structured requests are no longer forced direct on that basis. This
  // replaces the original
  // "structured requests go direct while KIE tools passthrough is unverified"
  // test with its inverse, matching KIE_CLAUDE_TOOLS_VERIFIED = true.
  it("structured requests go KIE-first — tools passthrough verified", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      jsonResponse({
        content: [{ type: "tool_use", input: { ok: true } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )
    const res = await llmComplete({
      modelId: "claude-sonnet-5",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      jsonSchema: { name: "r", schema: { type: "object" } },
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0][0] as string)).toContain("/claude/v1/messages")
    expect(createSpy).not.toHaveBeenCalled()

    // The forced-tool schema must actually be carried on the wire — not just routed to KIE.
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.tools[0].name).toBe("r")
    expect(body.tools[0].input_schema).toEqual({ type: "object" })
    expect(body.tool_choice).toEqual({ type: "tool", name: "r" })

    // A forced-tool response carries a tool_use block, not text — the parser must prefer it.
    expect(res.text).toBe(JSON.stringify({ ok: true }))
  })

  it("plain call goes to KIE first (claude-opus-4.8)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieOk())
    const res = await llmComplete({ modelId: "claude-opus-4.8", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0][0] as string)).toContain("/claude/v1/messages")
    expect(createSpy).not.toHaveBeenCalled()
    expect(res.text).toBe("kie")
  })

  it("existing Claude models still go direct-first", async () => {
    const { llmComplete } = await import("../llm-client.js")
    await llmComplete({ modelId: "claude-sonnet-4.6", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledOnce()
  })

  // Thinking/output_config passthrough through the KIE proxy is NOT verified,
  // so effort-carrying calls still route direct per
  // KIE_CLAUDE_EFFORT_VERIFIED = false.
  it("effort-carrying call goes direct while KIE effort passthrough is unverified", async () => {
    const { llmComplete } = await import("../llm-client.js")
    await llmComplete({
      modelId: "claude-sonnet-5",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "high",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledOnce()
  })
})

describe("llmStream preferKie routing (claude-sonnet-5)", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    createSpy.mockReset().mockResolvedValue(anthropicOk)
    streamSpy.mockReset()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it("plain streaming call goes to KIE first — each SSE token reaches the callback exactly once", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_delta","delta":{"text":"He"}}\n',
        'data: {"type":"content_block_delta","delta":{"text":"llo"}}\n',
        "data: [DONE]\n",
      ]),
    )
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
      (t) => tokens.push(t),
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0][0] as string)).toContain("/claude/v1/messages")
    expect(createSpy).not.toHaveBeenCalled()
    expect(streamSpy).not.toHaveBeenCalled()
    expect(tokens).toEqual(["He", "llo"])
    expect(res.text).toBe("Hello")
  })

  it("KIE stream fails BEFORE any token → falls back to direct", async () => {
    const { llmStream } = await import("../llm-client.js")
    // The envelope guard throws pre-token, same shape as the existing non-stream test.
    fetchMock.mockResolvedValue(streamResponse(['{"code":500,"msg":"maintenance"}']))
    streamSpy.mockReturnValue(anthropicStreamStub("direct-stream-text"))
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
      (t) => tokens.push(t),
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(streamSpy).toHaveBeenCalledOnce()
    expect(tokens).toEqual(["direct-stream-text"])
    expect(res.text).toBe("direct-stream-text")
  })

  it("KIE stream fails AFTER >=1 token → error rethrown, no direct fallback, first token delivered exactly once", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamThatFailsAfterFirstChunk('data: {"type":"content_block_delta","delta":{"text":"He"}}\n'),
    )
    const tokens: string[] = []
    await expect(
      llmStream(
        { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
        (t) => tokens.push(t),
      ),
    ).rejects.toThrow()
    expect(createSpy).not.toHaveBeenCalled()
    expect(streamSpy).not.toHaveBeenCalled()
    expect(tokens).toEqual(["He"])
  })

  it("structured streaming request goes direct — streamed forced-tool output is not parsed on the KIE path", async () => {
    const { llmStream } = await import("../llm-client.js")
    // Configured so that if the fix regresses and this DOES hit KIE, the test
    // fails on the `fetchMock not called` assertion rather than an opaque throw.
    fetchMock.mockResolvedValue(
      jsonResponse({
        content: [{ type: "tool_use", input: { unexpected: true } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )
    streamSpy.mockReturnValue(anthropicStreamStub('{"ok":true}'))
    const tokens: string[] = []
    const res = await llmStream(
      {
        modelId: "claude-sonnet-5",
        system: "",
        messages: [{ role: "user", content: "hi" }],
        jsonSchema: { name: "r", schema: { type: "object" } },
      },
      (t) => tokens.push(t),
    )
    expect(streamSpy).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tokens).toEqual(['{"ok":true}'])
    expect(res.text).toBe('{"ok":true}')
  })
})
