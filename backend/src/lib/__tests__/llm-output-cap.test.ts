/**
 * A reply the provider stopped at the output cap is a FAILURE on every lane —
 * never a finished answer (issue #1588).
 *
 * No dialect reports it as an error: it is a 200 carrying `finish_reason:
 * "length"`, `stop_reason: "max_tokens"` or `status: "incomplete"`. Returned
 * as it is, the fragment becomes a completed job and flows downstream. Each
 * case below feeds one lane its own dialect's cap stop and asserts the same
 * two things: the call throws `LlmOutputTruncatedError`, and the usage the
 * provider billed rides the throw. Beside it, the same lane with a normal
 * stop still resolves, so the check cannot pass by throwing everywhere.
 *
 * The direct Google lane — where #1588 actually happened — has its own file:
 * `gemini/__tests__/output-cap.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const configMock = {
  KIE_API_KEY: "test-kie-key",
  KIE_API_BASE_URL: "https://api.kie.ai",
  ANTHROPIC_API_KEY: undefined as string | undefined,
  NODE_ENV: "test",
}
vi.mock("../config.js", () => ({ config: configMock }))

const anthropicCreate = vi.fn()
const anthropicStream = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate, stream: anthropicStream } }),
}))

const USER = [{ role: "user" as const, content: "write the brief" }]

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
}

function sse(frames: unknown[], done = true): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : "")
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

/** KIE's OpenAI-dialect reply (Gemini, GPT-5.2). */
function chatReply(content: string, finishReason: string, completionTokens: number): Response {
  return json({
    choices: [{ message: { role: "assistant", content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 13_657, completion_tokens: completionTokens },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  configMock.KIE_API_KEY = "test-kie-key"
  configMock.ANTHROPIC_API_KEY = undefined
  anthropicCreate.mockReset()
  anthropicStream.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("KIE chat-completions (Gemini) — non-streaming", () => {
  it("throws on finish_reason \"length\" instead of returning the fragment, with the billed usage", async () => {
    const { llmComplete, LlmOutputTruncatedError } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(chatReply("# YOUTUBE RADAR\n\n- NEW: (https://www.youtube.", "length", 8_192))

    const err = await llmComplete({ modelId: "gemini-3.6-flash", system: "s", messages: USER, maxTokens: 1_100 })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmOutputTruncatedError)
    expect((err as InstanceType<typeof LlmOutputTruncatedError>).usage).toMatchObject({
      inputTokens: 13_657, outputTokens: 8_192, complete: true,
    })
    // The diagnostic names the cap actually SENT — the floored one, not the node's 1,100.
    expect((err as Error).message).toMatch(/^The answer was cut off/)
    expect((err as Error).message).toMatch(/at cap 8192/)
  })

  it("floors a node's small cap to the model's reasoning floor on the wire — 8192, not 1100 (#1588)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(chatReply("done", "stop", 480))

    const res = await llmComplete({ modelId: "gemini-3.6-flash", system: "s", messages: USER, maxTokens: 1_100 })

    expect(res.text).toBe("done")
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
    expect(body.max_tokens).toBe(8_192)
  })

  it("leaves a model that does not reason by default at the caller's cap", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(chatReply("done", "stop", 20))

    await llmComplete({ modelId: "gpt-5.2", system: "s", messages: USER, maxTokens: 500 })

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
    expect(body.max_tokens).toBe(500)
  })
})

describe("KIE chat-completions — streaming", () => {
  it("streams every token it got, then throws when the last chunk says \"length\"", async () => {
    const { llmStream, LlmOutputTruncatedError } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(sse([
      { choices: [{ delta: { content: "# YOUTUBE RADAR\n" } }] },
      {
        choices: [{ delta: { content: "- NEW: (https://www.youtube." }, finish_reason: "length" }],
        usage: { prompt_tokens: 13_657, completion_tokens: 8_192 },
      },
    ]))
    const tokens: string[] = []

    const err = await llmStream(
      { modelId: "gemini-3.6-flash", system: "s", messages: USER, maxTokens: 1_100 },
      (t) => tokens.push(t),
    ).catch((e: unknown) => e)

    expect(tokens.join("")).toBe("# YOUTUBE RADAR\n- NEW: (https://www.youtube.")
    expect(err).toBeInstanceOf(LlmOutputTruncatedError)
    expect((err as InstanceType<typeof LlmOutputTruncatedError>).usage.outputTokens).toBe(8_192)
  })

  it("resolves a stream whose last chunk says \"stop\"", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(sse([
      { choices: [{ delta: { content: "all of it" }, finish_reason: "stop" }] },
    ]))

    const res = await llmStream({ modelId: "gemini-3.6-flash", system: "s", messages: USER }, () => {})

    expect(res.text).toBe("all of it")
  })
})

describe("KIE Claude messages (served over the collapsed stream)", () => {
  const claudeStream = (stopReason: string) => sse([
    { type: "message_start", message: { usage: { input_tokens: 40 } } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "part of an ans" } },
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { input_tokens: 40, output_tokens: 64 } },
    { type: "message_stop" },
  ], false)

  it("throws on stop_reason \"max_tokens\" and never re-dials a billed answer", async () => {
    const { llmComplete, LlmOutputTruncatedError } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => claudeStream("max_tokens"))

    const err = await llmComplete({ modelId: "claude-sonnet-4.6", system: "s", messages: USER, maxTokens: 64 })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmOutputTruncatedError)
    // Usage-carrying, so the transport-retry ladder must not run: one call, one bill.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("resolves on stop_reason \"end_turn\"", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => claudeStream("end_turn"))

    const res = await llmComplete({ modelId: "claude-sonnet-4.6", system: "s", messages: USER, maxTokens: 64 })

    expect(res.text).toBe("part of an ans")
  })
})

describe("KIE responses (GPT)", () => {
  it("non-streaming: throws on status \"incomplete\" / max_output_tokens", async () => {
    const { llmComplete, LlmOutputTruncatedError } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(json({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "message", content: [{ type: "output_text", text: "half a" }] }],
      usage: { input_tokens: 40, output_tokens: 100 },
    }))

    const err = await llmComplete({ modelId: "gpt-5.4", system: "s", messages: USER, maxTokens: 100 })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmOutputTruncatedError)
    expect((err as Error).message).toMatch(/at cap 100/)
  })

  it("non-streaming: a completed reply still resolves", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(json({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "whole" }] }],
      usage: { input_tokens: 40, output_tokens: 10 },
    }))

    const res = await llmComplete({ modelId: "gpt-5.4", system: "s", messages: USER, maxTokens: 100 })

    expect(res.text).toBe("whole")
  })

  it("streaming: response.incomplete for max_output_tokens is the truncation error, not a bare stream failure", async () => {
    const { llmStream, LlmOutputTruncatedError } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(sse([
      { type: "response.output_text.delta", delta: "half a", sequence_number: 0 },
      {
        type: "response.incomplete",
        response: { incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 40, output_tokens: 100 } },
        sequence_number: 1,
      },
    ], false))

    const err = await llmStream({ modelId: "gpt-5.4", system: "s", messages: USER, maxTokens: 100 }, () => {})
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmOutputTruncatedError)
  })
})

describe("direct Anthropic SDK", () => {
  beforeEach(() => {
    configMock.ANTHROPIC_API_KEY = "test-ant-key"
    // No KIE key: the direct lane is the only one, so its own verdict surfaces.
    configMock.KIE_API_KEY = ""
  })

  it("non-streaming: throws on stop_reason \"max_tokens\"", async () => {
    const { llmComplete, LlmOutputTruncatedError } = await import("../llm-client.js")
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "part of" }],
      usage: { input_tokens: 40, output_tokens: 64 },
      stop_reason: "max_tokens",
    })

    const err = await llmComplete({ modelId: "claude-sonnet-4.6", system: "s", messages: USER, maxTokens: 64 })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmOutputTruncatedError)
    expect((err as InstanceType<typeof LlmOutputTruncatedError>).usage).toMatchObject({ inputTokens: 40, outputTokens: 64 })
  })

  it("non-streaming forced tool: a capped tool call is a failure too, not half a JSON object", async () => {
    const { llmComplete, LlmOutputTruncatedError } = await import("../llm-client.js")
    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "result", input: {} }],
      usage: { input_tokens: 40, output_tokens: 64 },
      stop_reason: "max_tokens",
    })

    await expect(llmComplete({
      modelId: "claude-sonnet-4.6", system: "s", messages: USER, maxTokens: 64,
      jsonSchema: { name: "result", schema: { type: "object" } },
    })).rejects.toBeInstanceOf(LlmOutputTruncatedError)
  })

  it("streaming: throws once the final message says \"max_tokens\"", async () => {
    const { llmStream, LlmOutputTruncatedError } = await import("../llm-client.js")
    let onText: ((delta: string) => void) | undefined
    anthropicStream.mockReturnValue({
      on: (event: string, cb: (delta: string) => void) => { if (event === "text") onText = cb },
      abort: () => {},
      finalMessage: async () => {
        onText?.("part of")
        return { usage: { input_tokens: 40, output_tokens: 64 }, stop_reason: "max_tokens" }
      },
    })

    await expect(
      llmStream({ modelId: "claude-sonnet-4.6", system: "s", messages: USER, maxTokens: 64 }, () => {}),
    ).rejects.toBeInstanceOf(LlmOutputTruncatedError)
  })

  it("a direct cap stop is not re-asked on the KIE fallback lane (one cut, one bill)", async () => {
    configMock.KIE_API_KEY = "test-kie-key" // the fallback lane EXISTS here
    const { llmComplete, LlmOutputTruncatedError } = await import("../llm-client.js")
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "part of" }],
      usage: { input_tokens: 40, output_tokens: 64 },
      stop_reason: "max_tokens",
    })

    // An effort makes direct the primary lane with KIE as its fallback.
    await expect(llmComplete({ modelId: "claude-sonnet-4.6", system: "s", messages: USER, maxTokens: 64, reasoningEffort: "low" }))
      .rejects.toBeInstanceOf(LlmOutputTruncatedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("an end_turn reply still resolves", async () => {
    const { llmComplete } = await import("../llm-client.js")
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "whole" }],
      usage: { input_tokens: 40, output_tokens: 5 },
      stop_reason: "end_turn",
    })

    const res = await llmComplete({ modelId: "claude-sonnet-4.6", system: "s", messages: USER, maxTokens: 64 })

    expect(res.text).toBe("whole")
  })
})

describe("llmCompleteStructured", () => {
  it("fails fast on a capped reply — no paid correction retry — and keeps the usage for billing", async () => {
    const { llmCompleteStructured, StructuredLlmError } = await import("../llm-client.js")
    const { z } = await import("zod")
    fetchMock.mockResolvedValue(chatReply("{\"items\":[\"a\",\"b", "length", 8_192))

    const err = await llmCompleteStructured(
      { modelId: "gemini-3.6-flash", system: "s", messages: USER },
      z.object({ items: z.array(z.string()) }),
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(StructuredLlmError)
    expect((err as InstanceType<typeof StructuredLlmError>).usage).toMatchObject({ inputTokens: 13_657, outputTokens: 8_192 })
    // A truncated answer is not a malformed one: re-asking would pay again for
    // the same cut, so the validation retry loop must not run.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
