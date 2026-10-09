/**
 * `llmStreamStructured` — structured output whose first attempt streams its
 * tool input, so a caller can act on each finished value before the answer
 * completes. Everything else must be exactly `llmCompleteStructured`: the same
 * request body on the wire, the same validation + correction retries, the same
 * usage accounting, the same cap-stop rule, the same two serving lanes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"
import { fakeAnthropicStream } from "./fake-anthropic-stream.js"

const configMock = {
  KIE_API_KEY: "test-kie-key" as string | undefined,
  KIE_API_BASE_URL: "https://api.kie.ai",
  ANTHROPIC_API_KEY: "test-ant-key" as string | undefined,
  GEMINI_API_KEY: undefined as string | undefined,
  NODE_ENV: "test",
}
vi.mock("../config.js", () => ({ config: configMock }))

const anthropicCreate = vi.fn()
const anthropicStream = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate, stream: anthropicStream } }),
}))

const SCHEMA = z.object({ person: z.object({ age: z.string() }), n: z.number() })
const ANSWER = { person: { age: "age-30s" }, n: 7 }
const FRAGMENTS = ['{"person":{"a', 'ge":"age-3', '0s"},"n":', "7}"]
const USER = [{ role: "user" as const, content: "analyze" }]
// Both carry an effort: a Claude call with one is served on the DIRECT lane
// (KIE ignores Claude effort, decided 2026-10-08), which is the lane this suite
// is about. The KIE structured stream is pinned in its own case below.
const OPUS = { modelId: "claude-opus-4.7", system: "sys", messages: USER, reasoningEffort: "low" as const }
const SONNET = { modelId: "claude-sonnet-4.6", system: "sys", messages: USER, reasoningEffort: "low" as const }

let fetchMock: ReturnType<typeof vi.fn>

function toolReply(input: unknown) {
  return { content: [{ type: "tool_use", id: "tu_2", name: "result", input }], usage: { input_tokens: 900, output_tokens: 80 }, stop_reason: "tool_use" }
}

beforeEach(() => {
  vi.resetModules()
  configMock.KIE_API_KEY = "test-kie-key"
  configMock.ANTHROPIC_API_KEY = "test-ant-key"
  configMock.GEMINI_API_KEY = undefined
  anthropicCreate.mockReset()
  anthropicStream.mockReset()
  fetchMock = vi.fn().mockRejectedValue(new Error("KIE unavailable"))
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("llmStreamStructured", () => {
  it("streams the first attempt's tool input on the direct lane, even for a KIE-preferred model", async () => {
    const { llmStreamStructured } = await import("../llm-client.js")
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: FRAGMENTS }))
    const seen: string[] = []

    const res = await llmStreamStructured(OPUS, SCHEMA, { schemaName: "emit_pickers", onToolJson: (p) => seen.push(p) })

    expect(seen).toEqual(FRAGMENTS)
    expect(res.output).toEqual(ANSWER)
    expect(res.inputTokens).toBe(1_000)
    expect(res.outputTokens).toBe(120)
    expect(res.providerCost).toBeGreaterThan(0)
    expect(anthropicStream).toHaveBeenCalledTimes(1)
    expect(anthropicCreate).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    const [body] = anthropicStream.mock.calls[0] as [Record<string, unknown>]
    // The request carries an effort, so the tool rides the auto shape (a forced
    // choice would suppress the thinking the effort asked for) — the stream
    // still reads the tool input exactly as before.
    expect(body.tool_choice).toEqual({ type: "auto" })
    expect(body.system).toMatch(/Respond by calling the `emit_pickers` tool exactly once/)
    expect((body.tools as Array<{ name: string }>)[0].name).toBe("emit_pickers")
    expect(body).not.toHaveProperty("temperature")
  })

  it("sends exactly the body the one-shot direct call sends (one builder, no drift)", async () => {
    const { llmStreamStructured, llmCompleteStructured } = await import("../llm-client.js")
    const req = { ...SONNET, temperature: 0.3, maxTokens: 900 }
    anthropicCreate.mockResolvedValue(toolReply(ANSWER))
    await llmCompleteStructured(req, SCHEMA, { schemaName: "emit_pickers" })
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: FRAGMENTS }))
    await llmStreamStructured(req, SCHEMA, { schemaName: "emit_pickers", onToolJson: () => {} })

    const [oneShotBody, oneShotOpts] = anthropicCreate.mock.calls[0]
    const [streamBody, streamOpts] = anthropicStream.mock.calls[0]
    expect(streamBody).toEqual(oneShotBody)
    expect(streamOpts).toEqual(oneShotOpts)
  })

  it("answers from the streamed bytes, not the SDK's lossy partial parse", async () => {
    const { llmStreamStructured } = await import("../llm-client.js")
    // The SDK's partial-JSON parser reads `1e-3` as 13 in finalMessage's tool input.
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: ['{"person":{"age":"age-30s"},"n":1e-3}'], input: { person: { age: "age-30s" }, n: 13 } }))

    const res = await llmStreamStructured(OPUS, SCHEMA, { schemaName: "emit_pickers", onToolJson: () => {} })

    expect(res.output.n).toBe(0.001)
  })

  it("reads an empty forced-tool input from the final message, as the one-shot call does", async () => {
    const { llmStreamStructured } = await import("../llm-client.js")
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: [], input: {} }))

    const res = await llmStreamStructured(OPUS, z.object({ a: z.string().optional() }), { onToolJson: () => {} })

    expect(res.output).toEqual({})
    expect(anthropicCreate).not.toHaveBeenCalled()
  })

  it("retries a streamed answer that fails validation one-shot, with the correction turn, and sums the usage", async () => {
    const { llmStreamStructured } = await import("../llm-client.js")
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: ['{"person":{}}'] }))
    anthropicCreate.mockResolvedValue(toolReply(ANSWER))
    const onToolJson = vi.fn()

    const res = await llmStreamStructured(SONNET, SCHEMA, { schemaName: "emit_pickers", onToolJson })

    expect(res.output).toEqual(ANSWER)
    expect(res.inputTokens).toBe(1_000 + 900)
    expect(res.outputTokens).toBe(120 + 80)
    expect(anthropicStream).toHaveBeenCalledTimes(1)
    expect(anthropicCreate).toHaveBeenCalledTimes(1)
    const [retryBody] = anthropicCreate.mock.calls[0] as [{ messages: Array<{ role: string }> }]
    expect(retryBody.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"])
    expect(onToolJson).toHaveBeenCalledTimes(1)
  })

  it("treats a cap stop as a failure and never re-asks (one cut, one bill)", async () => {
    const { llmStreamStructured, StructuredLlmError, LlmOutputTruncatedError } = await import("../llm-client.js")
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: FRAGMENTS.slice(0, 2), stopReason: "max_tokens", input: {} }))

    const err = await llmStreamStructured(OPUS, SCHEMA, { schemaName: "emit_pickers", onToolJson: () => {} }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(StructuredLlmError)
    expect((err as Error).cause).toBeInstanceOf(LlmOutputTruncatedError)
    expect((err as InstanceType<typeof StructuredLlmError>).usage.outputTokens).toBe(120)
    expect(anthropicCreate).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("falls back to KIE (the one-shot path's second lane) when the stream fails before it starts", async () => {
    const { llmStreamStructured } = await import("../llm-client.js")
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: FRAGMENTS, failBeforeStart: new Error("overloaded") }))

    await llmStreamStructured({ ...SONNET, retryStreamOnError: false }, SCHEMA, { onToolJson: () => {} }).catch(() => undefined)

    expect(fetchMock).toHaveBeenCalled()
    expect(fetchMock.mock.calls[0][0] as string).toContain("/claude/v1/messages")
    expect(anthropicCreate).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[llm-lane-fallback]"))
  })

  it("has no fallback lane when KIE is not configured", async () => {
    const { llmStreamStructured, StructuredLlmError } = await import("../llm-client.js")
    configMock.KIE_API_KEY = undefined
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: FRAGMENTS, failBeforeStart: new Error("overloaded") }))

    await expect(llmStreamStructured(SONNET, SCHEMA, { onToolJson: () => {} })).rejects.toBeInstanceOf(StructuredLlmError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(anthropicCreate).not.toHaveBeenCalled()
  })

  it("never re-asks once the stream started — even before any fragment — and the billed usage rides the error", async () => {
    const { llmStreamStructured, StructuredLlmError } = await import("../llm-client.js")
    for (const failAfter of [0, 2]) {
      anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: FRAGMENTS, failAfter, failWith: new Error("overloaded mid-stream") }))

      const err = await llmStreamStructured(SONNET, SCHEMA, { onToolJson: () => {} }).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(StructuredLlmError)
      expect((err as InstanceType<typeof StructuredLlmError>).usage.inputTokens).toBe(1_000)
    }
    expect(anthropicCreate).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("bounds the streamed attempt by the request's timeout, as the one-shot call is bounded", async () => {
    vi.useFakeTimers()
    const { llmStreamStructured, StructuredLlmError } = await import("../llm-client.js")
    const stream = fakeAnthropicStream({ fragments: FRAGMENTS.slice(0, 1), hang: true })
    anthropicStream.mockReturnValue(stream)

    const settled = llmStreamStructured({ ...OPUS, timeoutMs: 5_000 }, SCHEMA, { onToolJson: () => {} }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    const err = await settled

    expect(err).toBeInstanceOf(StructuredLlmError)
    expect((err as Error).message).toMatch(/5000 ms/)
    expect(stream.abort).toHaveBeenCalled()
    expect(anthropicCreate).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("stops on a caller's abort mid-stream without reaching another lane", async () => {
    const { llmStreamStructured, StructuredLlmError } = await import("../llm-client.js")
    const stream = fakeAnthropicStream({ fragments: FRAGMENTS })
    anthropicStream.mockReturnValue(stream)
    const controller = new AbortController()

    await expect(
      llmStreamStructured(OPUS, SCHEMA, { onToolJson: () => controller.abort(), signal: controller.signal }),
    ).rejects.toBeInstanceOf(StructuredLlmError)
    expect(stream.abort).toHaveBeenCalled()
    expect(anthropicCreate).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never reaches a second lane for a signal that was already aborted", async () => {
    const { llmStreamStructured, StructuredLlmError } = await import("../llm-client.js")
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: FRAGMENTS }))
    const controller = new AbortController()
    controller.abort()

    await expect(
      llmStreamStructured(SONNET, SCHEMA, { onToolJson: () => {}, signal: controller.signal }),
    ).rejects.toBeInstanceOf(StructuredLlmError)
    expect(anthropicCreate).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps the call alive when the caller's onToolJson throws, and stops forwarding", async () => {
    const { llmStreamStructured } = await import("../llm-client.js")
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments: FRAGMENTS }))
    const onToolJson = vi.fn(() => {
      throw new Error("ui bug")
    })

    const res = await llmStreamStructured(OPUS, SCHEMA, { schemaName: "emit_pickers", onToolJson })

    expect(res.output).toEqual(ANSWER)
    expect(onToolJson).toHaveBeenCalledTimes(1)
  })

  it("answers one-shot, never calling onToolJson, for a model that cannot stream forced-tool output", async () => {
    const { llmStreamStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: JSON.stringify(ANSWER) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 500, completion_tokens: 40 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )
    const onToolJson = vi.fn()

    const res = await llmStreamStructured({ ...OPUS, modelId: "gemini-3.6-flash" }, SCHEMA, { schemaName: "emit_pickers", onToolJson })

    expect(res.output).toEqual(ANSWER)
    expect(onToolJson).not.toHaveBeenCalled()
    expect(anthropicStream).not.toHaveBeenCalled()
  })

  it("never streams on the direct SDK without a direct Anthropic key, on a KIE pin, or with no onToolJson", async () => {
    const { llmStreamStructured } = await import("../llm-client.js")
    const cases: Array<{ ant?: string; req: Record<string, unknown>; onToolJson?: () => void }> = [
      { ant: undefined, req: {}, onToolJson: () => {} },
      { ant: "test-ant-key", req: { requireLane: "kie" }, onToolJson: () => {} },
      { ant: "test-ant-key", req: {}, onToolJson: undefined },
    ]
    for (const c of cases) {
      configMock.ANTHROPIC_API_KEY = c.ant
      anthropicCreate.mockResolvedValue(toolReply(ANSWER))
      await llmStreamStructured({ ...SONNET, retryStreamOnError: false, ...c.req }, SCHEMA, { onToolJson: c.onToolJson }).catch(
        () => undefined,
      )
    }
    expect(anthropicStream).not.toHaveBeenCalled()
  })

  it("streams the tool input off KIE for a call that runs there (no effort), forwarding each fragment", async () => {
    const { llmStreamStructured } = await import("../llm-client.js")
    const sse = [
      'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"emit_pickers"}}\n',
      ...JSON.stringify(ANSWER).match(/.{1,12}/g)!.map(
        (chunk) => `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: chunk } })}\n`,
      ),
      'data: {"type":"message_delta","usage":{"input_tokens":5,"output_tokens":7}}\n',
    ]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(c) { const e = new TextEncoder(); for (const l of sse) c.enqueue(e.encode(l)); c.close() },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } })))
    const fragments: string[] = []
    const res = await llmStreamStructured(
      { modelId: "claude-sonnet-4.6", system: "sys", messages: USER },
      SCHEMA,
      { schemaName: "emit_pickers", onToolJson: (p) => fragments.push(p) },
    )
    expect(anthropicStream).not.toHaveBeenCalled()
    expect(fragments.join("")).toBe(JSON.stringify(ANSWER))
    expect(res.output).toEqual(ANSWER)
    vi.unstubAllGlobals()
  })
})
