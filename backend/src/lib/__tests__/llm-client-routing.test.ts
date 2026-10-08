import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { LlmLaneError } from "../llm-errors.js"

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

  // Decided 2026-10-08: a call is priced on the lane it runs on. A Claude call
  // with no effort and no Advanced bills the aggregator price, so it is served
  // there — on KIE's STREAMING wire collapsed to one response (a real tool_use
  // block, and `credits_consumed`), with direct only as the failure fallback.
  it("plain non-streaming call goes to KIE first, on the streaming wire", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(streamResponse([
        'data: {"type":"content_block_delta","delta":{"text":"kie"}}\n',
        'data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n',
      ]))
    const res = await llmComplete({ modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).stream).toBe(true)
    expect(createSpy).not.toHaveBeenCalled()
    expect(res.text).toBe("kie")
  })

  it.each(["claude-opus-5", "claude-opus-5.5", "claude-sonnet-5.5", "claude-opus-4.8", "claude-fable-5", "claude-sonnet-5", "claude-opus-4.7", "claude-sonnet-4.6", "claude-haiku-4.5"])(
    "%s with no effort is served by KIE",
    async (modelId) => {
      const { llmComplete } = await import("../llm-client.js")
      fetchMock.mockResolvedValue(streamResponse([
        'data: {"type":"content_block_delta","delta":{"text":"kie"}}\n',
        'data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n',
      ]))
      const res = await llmComplete({ modelId, system: "", messages: [{ role: "user", content: "hi" }] })
      expect(createSpy).not.toHaveBeenCalled()
      expect(res.text).toBe("kie")
    },
  )

  // The direct lane is primary but not incident-free (Anthropic logged four
  // elevated-error incidents across 2026-08-04/05, two naming Opus 5). KIE's
  // STREAMING wire still works while its non-streaming one 500s, so collapsing
  // a stream gives llmComplete a real second lane rather than none.
  it("falls back to KIE's collapsed stream when the direct lane fails", async () => {
    const { llmComplete } = await import("../llm-client.js")
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    // An effort makes direct the primary lane (KIE ignores Claude effort).
    createSpy.mockReset().mockRejectedValue(new Error("anthropic 529 overloaded"))
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_delta","delta":{"text":"from-"}}\n',
        'data: {"type":"content_block_delta","delta":{"text":"kie-stream"}}\n',
        'data: {"type":"message_delta","usage":{"input_tokens":3,"output_tokens":4}}\n',
      ]),
    )
    const res = await llmComplete({ modelId: "claude-opus-5", system: "", messages: [{ role: "user", content: "hi" }], reasoningEffort: "high" })
    expect(createSpy).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(res.text).toBe("from-kie-stream")
    // A swallowed direct-lane failure is never silent (incident 2026-08-14).
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("[llm-lane-fallback]"))).toBe(true)
    // It must use the wire that WORKS — a stream:false body would 500 on KIE.
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.stream).toBe(true)
  })

  // Over SSE a forced tool arrives as real input_json_delta fragments, not the
  // malformed <tool_calls> pseudo-tag the non-streaming path has to decode.
  it("reassembles forced-tool JSON from the collapsed stream", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockReset().mockRejectedValue(new Error("anthropic down"))
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"r"}}\n',
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"ok\\":"}}\n',
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"true}"}}\n',
        'data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n',
      ]),
    )
    const res = await llmComplete({
      modelId: "claude-opus-5",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      jsonSchema: { name: "r", schema: { type: "object" } },
    })
    expect(res.text).toBe('{"ok":true}')
    expect(JSON.parse(res.text)).toEqual({ ok: true })
  })

  // KIE's Claude stream fails transiently ~1 call in 5, almost always as one
  // `event: error` frame that a retry clears. The backstop only runs because
  // direct already failed, so it gets exactly one more attempt.
  it("retries the collapsed stream once past a transient KIE error frame", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockReset().mockRejectedValue(new Error("anthropic down"))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock
      .mockResolvedValueOnce(
        streamResponse(['event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Server exception"}}\n']),
      )
      .mockResolvedValueOnce(
        streamResponse([
          'data: {"type":"content_block_delta","delta":{"text":"recovered"}}\n',
          'data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n',
        ]),
      )
    const res = await llmComplete({ modelId: "claude-opus-5", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(res.text).toBe("recovered")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("surfaces the error when BOTH lanes fail — no empty-success, and the retry is bounded", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockReset().mockRejectedValue(new Error("anthropic down"))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockResolvedValue(streamResponse(['{"code":500,"msg":"maintenance"}']))
    vi.useFakeTimers()
    try {
      const call = llmComplete({ modelId: "claude-opus-5", system: "", messages: [{ role: "user", content: "hi" }] })
      const assertion = expect(call).rejects.toThrow()
      // Drive the 400 / 2 000 / 6 000 / 15 000 / 30 000 ms transport ladder without sitting it out.
      await vi.advanceTimersByTimeAsync(60_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
    // One initial attempt plus the bounded ladder — a genuinely down proxy still
    // fails inside seconds rather than looping.
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  // The fallback lane's error is what the caller gets, and it used to leave no
  // log line: only the primary lane's warn was written, so a broken fallback
  // looked like a request that simply failed.
  it("a direct fallback that fails too is error-logged with its causes, and its own error surfaces", async () => {
    const { llmComplete } = await import("../llm-client.js")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      fetchMock.mockResolvedValue(streamResponse([
        'data: {"type":"error","error":{"type":"api_error","message":"no_available_account"}}\n',
      ]))
      const directErr = Object.assign(
        new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"rejected"}}', { cause: new Error("transport detail") }),
        { status: 400 },
      )
      createSpy.mockReset().mockRejectedValue(directErr)

      await expect(llmComplete({
        modelId: "claude-fable-5",
        system: "",
        messages: [{ role: "user", content: "hi" }],
        retryStreamOnError: false,
      })).rejects.toBe(directErr)

      const lines = errorSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[llm-lane-fallback]"))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("claude-fable-5: direct-anthropic lane also failed (after the kie lane)")
      expect(lines[0]).toContain("invalid_request_error")
      expect(lines[0]).toContain("transport detail")
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("a KIE fallback that fails too is error-logged, and KIE's own error surfaces", async () => {
    const { llmComplete } = await import("../llm-client.js")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      createSpy.mockReset().mockRejectedValue(new Error("anthropic 529 overloaded"))
      fetchMock.mockResolvedValue(streamResponse(['{"code":500,"msg":"maintenance"}']))

      // An effort makes direct the primary lane, and KIE the fallback.
      await expect(llmComplete({
        modelId: "claude-opus-5",
        system: "",
        messages: [{ role: "user", content: "hi" }],
        reasoningEffort: "high",
        retryStreamOnError: false,
      })).rejects.toBeInstanceOf(LlmLaneError)

      const lines = errorSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[llm-lane-fallback]"))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("claude-opus-5: kie lane also failed (after the direct-anthropic lane)")
      expect(lines[0]).toContain("maintenance")
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("falls back to direct Anthropic when KIE errors (no extra charge — billed as KIE)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockResolvedValue(streamResponse(['{"code":500,"msg":"maintenance"}']))
    vi.useFakeTimers()
    try {
      const call = llmComplete({ modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] })
      await vi.advanceTimersByTimeAsync(60_000)
      const res = await call
      expect(createSpy).toHaveBeenCalledOnce()
      expect(res.text).toBe("direct")
    } finally {
      vi.useRealTimers()
    }
  })

  // A structured call with an effort runs direct (KIE ignores the effort); this
  // pins that it carries the forced tool on the DIRECT wire.
  it("structured requests with an effort go direct and still force the tool", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockResolvedValue({
      content: [{ type: "tool_use", name: "r", input: { ok: true } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const res = await llmComplete({
      modelId: "claude-sonnet-5",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "low",
      jsonSchema: { name: "r", schema: { type: "object" } },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledOnce()

    // The forced-tool schema must actually be carried on the wire.
    const body = createSpy.mock.calls[0][0] as Record<string, unknown>
    const tools = body.tools as Array<Record<string, unknown>>
    expect(tools[0].name).toBe("r")
    expect(body.tool_choice).toEqual({ type: "tool", name: "r" })

    expect(res.text).toBe(JSON.stringify({ ok: true }))
  })

  it("a pinned direct lane serves a Claude model on the Anthropic SDK (Advanced mode)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    const res = await llmComplete({ modelId: "claude-haiku-4.5", system: "", messages: [{ role: "user", content: "hi" }], requireLane: "direct" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledOnce()
    expect(res.text).toBe("direct")
  })

  // KIE accepts Claude's thinking/effort and ignores it (measured 2026-10-08),
  // so an effort-carrying call is served direct — and billed so (llmServesDirect).
  it("effort-carrying call goes direct — KIE ignores Claude effort", async () => {
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

  it("a direct stream fallback that fails too is error-logged, and its own error surfaces", async () => {
    const { llmStream } = await import("../llm-client.js")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      fetchMock.mockResolvedValue(streamResponse(['{"code":500,"msg":"maintenance"}']))
      const directErr = new Error("direct stream refused")
      streamSpy.mockReturnValue({ on() { return this }, abort() {}, finalMessage: () => Promise.reject(directErr) })

      await expect(llmStream(
        { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
        () => {},
      )).rejects.toBe(directErr)

      const lines = errorSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[llm-lane-fallback]"))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("claude-sonnet-5: direct-anthropic lane also failed (after the kie lane) — Error: direct stream refused")
    } finally {
      errorSpy.mockRestore()
    }
  })

  // KIE's Claude stream can emit an `event: error` frame instead of content
  // (observed in 1 of 6 plain requests, 2026-08-06). That frame matches no
  // format branch, so before the fix the stream ended with fullText === "" and
  // was returned as a SUCCESSFUL empty completion — no throw, so the fallback
  // never ran and the user got a blank answer.
  it("KIE stream error event before any token → throws, so the direct fallback runs", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Server exception, please try again later"}}\n',
      ]),
    )
    streamSpy.mockReturnValue(anthropicStreamStub("direct-stream-text"))
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
      (t) => tokens.push(t),
    )
    expect(streamSpy).toHaveBeenCalledOnce()
    expect(res.text).toBe("direct-stream-text")
    expect(tokens).toEqual(["direct-stream-text"])
  })

  it("KIE stream error event AFTER a token → surfaces, never returns a truncated success", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_delta","delta":{"text":"He"}}\n',
        'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Server exception, please try again later"}}\n',
      ]),
    )
    const tokens: string[] = []
    await expect(
      llmStream(
        { modelId: "claude-sonnet-5", system: "", messages: [{ role: "user", content: "hi" }] },
        (t) => tokens.push(t),
      ),
    ).rejects.toThrow(/error event/)
    expect(streamSpy).not.toHaveBeenCalled()
    expect(tokens).toEqual(["He"])
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

  it("structured streaming request with no effort is served by KIE — the tool JSON is read off the stream", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      streamResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Here it is."}}\n',
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"r"}}\n',
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"ok\\":"}}\n',
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"true}"}}\n',
        'data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n',
      ]),
    )
    const res = await llmStream(
      {
        modelId: "claude-sonnet-5",
        system: "",
        messages: [{ role: "user", content: "hi" }],
        jsonSchema: { name: "r", schema: { type: "object" } },
      },
      () => {},
    )
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(streamSpy).not.toHaveBeenCalled()
    // The tool call is the answer; the sentence before it is preamble.
    expect(res.text).toBe('{"ok":true}')
  })
})
