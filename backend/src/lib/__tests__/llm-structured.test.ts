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
