import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"

// ANTHROPIC_API_KEY set so claude models route to the direct SDK (tool path);
// Gemini/GPT have no directFallbackModel so they always go through KIE.
vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "test-ant-key", NODE_ENV: "test" },
}))

const anthropicCreate = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

/** A Response whose body is an SSE stream yielding the given chunks, then closing. */
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

/** A normal OpenAI-shape (Gemini via KIE) completion carrying `content`. */
function geminiContent(content: string): Response {
  return jsonResponse({ choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
}

const schema = z.object({ prompt: z.string(), mood: z.string().optional() })

describe("llmCompleteStructured", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    anthropicCreate.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(["transport", "error-frame", "silent-close"])(
    "does not restart Astra's underlying stream after %s when retries are disabled", async (failure) => {
      const { llmCompleteStructured, StructuredLlmError } = await import("../llm-client.js")
      fetchMock.mockImplementation(() => {
        if (failure === "transport") return Promise.reject(new Error("socket closed"))
        return Promise.resolve(streamResponse(failure === "error-frame"
          ? ['event: error\ndata: {"error":{"message":"upstream failed"}}\n\n']
          : ['data: {"type":"response.created","response":{"id":"response-1"}}\n\n', 'data: [DONE]\n\n']))
      })
      const result = llmCompleteStructured(
        { modelId: "gpt-6-astra", system: "", messages: [{ role: "user", content: "scene" }] },
        schema, { maxRetries: 0 },
      )
      await expect(result).rejects.toBeInstanceOf(StructuredLlmError)
      await expect(result).rejects.toMatchObject({ usage: {
        inputTokens: 0, outputTokens: 0, complete: false,
      } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it("returns validated output on the first valid response (Gemini path)", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(geminiContent(JSON.stringify({ prompt: "a sunset", mood: "calm" })))
    const r = await llmCompleteStructured(
      { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
    )
    expect(r.output).toEqual({ prompt: "a sunset", mood: "calm" })
    expect(r.inputTokens).toBe(10)
    expect(r.outputTokens).toBe(5)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("adds response_format.json_schema to the Gemini KIE body", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(geminiContent('{"prompt":"x"}'))
    await llmCompleteStructured(
      { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
      { schemaName: "out" },
    )
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.response_format.type).toBe("json_schema")
    expect(body.response_format.json_schema.name).toBe("out")
    expect(body.response_format.json_schema.strict).toBe(false)
    expect(body.response_format.json_schema.schema.properties.prompt).toBeDefined()
  })

  it("does NOT add response_format for GPT (no native structured mode via KIE)", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(geminiContent('{"prompt":"gpt"}'))
    await llmCompleteStructured(
      { modelId: "gpt-5.2", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
    )
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.response_format).toBeUndefined()
  })

  it("retries on invalid JSON, then succeeds", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock
      .mockResolvedValueOnce(geminiContent("not json"))
      .mockResolvedValueOnce(geminiContent("still not json"))
      .mockResolvedValueOnce(geminiContent('{"prompt":"ok"}'))
    const r = await llmCompleteStructured(
      { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
    )
    expect(r.output).toEqual({ prompt: "ok" })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("retries on schema mismatch (valid JSON, wrong shape), then succeeds", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock
      .mockResolvedValueOnce(geminiContent('{"wrong":"field"}'))
      .mockResolvedValueOnce(geminiContent('{"prompt":"fixed"}'))
    const r = await llmCompleteStructured(
      { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
    )
    expect(r.output.prompt).toBe("fixed")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Usage accumulates across ALL attempts (each call is billed), not just the
    // winning one — 2 attempts × {in:10, out:5} from geminiContent.
    expect(r.inputTokens).toBe(20)
    expect(r.outputTokens).toBe(10)
  })

  it("throws after exhausting retries on persistently invalid output", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    // Fresh Response per call — a Response body can only be read once.
    fetchMock.mockImplementation(() => geminiContent("never json"))
    await expect(
      llmCompleteStructured(
        { modelId: "gemini-3-flash", system: "", messages: [{ role: "user", content: "x" }] },
        schema,
        { maxRetries: 1 },
      ),
    ).rejects.toThrow(/llm-structured: validation failed after 2 attempt/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  /** Verbatim KIE Claude-proxy wire shape (live-captured 2026-07-14): a forced
   *  tool call arrives as ONE text block wrapping a <tool_calls> pseudo-tag
   *  whose tool object's closing brace is MISSING — never a real tool_use block. */
  function kieClaudeToolTag(inputJson: string): Response {
    const text = `<tool_calls>[{"type":"tool_use","id":"toolu_01x","name":"out","input":${inputJson}]</tool_calls>`
    return jsonResponse({
      role: "assistant", type: "message", model: "claude-opus-4-7", stop_reason: "end_turn",
      content: [{ type: "text", text }],
      usage: { input_tokens: 12, output_tokens: 9 },
    })
  }

  it("structured Claude goes straight to the direct SDK — KIE's non-stream lane is 500ing", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    // KIE would decode fine here; the point is that it is never asked. While
    // KIE_CLAUDE_NONSTREAM_VERIFIED is false, spending a round-trip on a
    // guaranteed 500 before falling back is pure latency.
    fetchMock.mockResolvedValue(kieClaudeToolTag('{"prompt":"from-kie-tag"}'))
    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "out", input: { prompt: "from-direct" } }],
      usage: { input_tokens: 7, output_tokens: 3 },
    })
    const r = await llmCompleteStructured(
      { modelId: "claude-opus-4.7", system: "sys", messages: [{ role: "user", content: "x" }] },
      schema,
      { schemaName: "out" },
    )
    expect(r.output).toEqual({ prompt: "from-direct" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(anthropicCreate).toHaveBeenCalledTimes(1)
  })

  /**
   * A deployment with no ANTHROPIC_API_KEY has no direct lane, so Claude is
   * served entirely by KIE — over the COLLAPSED STREAM, since KIE's
   * non-streaming Claude endpoint 500s unconditionally
   * (KIE_CLAUDE_NONSTREAM_VERIFIED = false). Before that switch this
   * configuration could not complete a single Claude call.
   *
   * The `<tool_calls>` pseudo-tag decoder that the non-streaming path needs is
   * covered directly in `json-utils.test.ts` (extractKieToolCallInput); it stays
   * in the code for when the flag flips back.
   */
  describe("KIE-only deployment (no ANTHROPIC_API_KEY)", () => {
    let restore: string | undefined
    beforeEach(async () => {
      const { config } = await import("../config.js")
      const c = config as unknown as Record<string, unknown>
      restore = c.ANTHROPIC_API_KEY as string | undefined
      c.ANTHROPIC_API_KEY = undefined
    })
    afterEach(async () => {
      const { config } = await import("../config.js")
      ;(config as unknown as Record<string, unknown>).ANTHROPIC_API_KEY = restore
    })

    /** SSE carrying a forced-tool call as real input_json_delta fragments. */
    function toolUseSse(inputJson: string): Response {
      const mid = Math.ceil(inputJson.length / 2)
      return streamResponse([
        `data: ${JSON.stringify({ type: "content_block_start", content_block: { type: "tool_use", name: "out" } })}\n`,
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: inputJson.slice(0, mid) } })}\n`,
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: inputJson.slice(mid) } })}\n`,
        `data: ${JSON.stringify({ type: "message_delta", usage: { input_tokens: 12, output_tokens: 9 } })}\n`,
      ])
    }

    it("serves a structured Claude call over the collapsed stream", async () => {
      const { llmCompleteStructured } = await import("../llm-client.js")
      fetchMock.mockResolvedValue(toolUseSse('{"prompt":"from-kie-stream"}'))
      const r = await llmCompleteStructured(
        { modelId: "claude-opus-4.7", system: "sys", messages: [{ role: "user", content: "x" }] },
        schema,
        { schemaName: "out" },
      )
      expect(r.output).toEqual({ prompt: "from-kie-stream" })
      expect(anthropicCreate).not.toHaveBeenCalled()
      const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
      // The forced tool must be on the wire, and it must use the wire that works.
      expect(body.tool_choice).toEqual({ type: "tool", name: "out" })
      expect(body.stream).toBe(true)
    })

    it("throws rather than inventing a result when KIE fails outright", async () => {
      const { llmCompleteStructured } = await import("../llm-client.js")
      // With no direct lane configured there is no backstop, so the error must
      // reach the caller instead of degrading into a retry loop on garbage.
      fetchMock.mockResolvedValue(streamResponse(['{"code":500,"msg":"maintenance"}']))
      await expect(
        llmCompleteStructured(
          { modelId: "claude-opus-4.7", system: "sys", messages: [{ role: "user", content: "x" }] },
          schema,
          { schemaName: "out", maxRetries: 0 },
        ),
      ).rejects.toThrow()
      expect(anthropicCreate).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it("adds text.format json_schema to the KIE responses body (GPT-5.6)", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: '{"prompt":"terra"}' }] }],
      usage: { input_tokens: 5, output_tokens: 5 },
    }))
    const r = await llmCompleteStructured(
      { modelId: "gpt-5.6-terra", system: "", messages: [{ role: "user", content: "x" }] },
      schema,
      { schemaName: "plan" },
    )
    expect(r.output).toEqual({ prompt: "terra" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.text.format.type).toBe("json_schema")
    expect(body.text.format.name).toBe("plan")
    expect(body.text.format.strict).toBe(false)
    expect(body.text.format.schema.properties.prompt).toBeDefined()
  })

  it("forces a tool on the Anthropic path and returns the tool input as output", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "out", input: { prompt: "from-tool" } }],
      usage: { input_tokens: 7, output_tokens: 3 },
    })
    const r = await llmCompleteStructured(
      { modelId: "claude-haiku-4.5", system: "sys", messages: [{ role: "user", content: "x" }] },
      schema,
      { schemaName: "out" },
    )
    expect(r.output).toEqual({ prompt: "from-tool" })
    const callArgs = anthropicCreate.mock.calls[0][0] as { tool_choice: unknown; tools: Array<{ name: string }> }
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: "out" })
    expect(callArgs.tools[0].name).toBe("out")
    expect(fetchMock).not.toHaveBeenCalled() // anthropic-direct, never touches KIE
  })
})
