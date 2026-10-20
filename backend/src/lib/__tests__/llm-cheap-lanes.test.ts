/**
 * `cheapLanesOnly` (decided 2026-10-20: a scheduled run should wait for the
 * cheap lane instead of paying the direct fallback) removes exactly the
 * KIE→direct legs: a KIE-primary call's failure fallback (complete, stream,
 * the structured stream), the Gemini KIE-first fallback, and the direct-tool
 * backup of a structured call KIE never answered well. It never changes the
 * primary lane, and a direct-primary call's own fallback TO KIE stays —
 * that leg goes toward the cheap lane. Without the flag, routing is as it was.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "test-anthropic-key", GEMINI_API_KEY: "test-gemini-key", NODE_ENV: "test" },
  hasCredits: () => true,
}))
// Hoisted with the mocks: the client import below is static, so the factories run before any plain `const`.
const { createSpy, streamSpy, callGeminiDirect, streamGeminiDirect } = vi.hoisted(() => ({
  createSpy: vi.fn(),
  streamSpy: vi.fn(),
  callGeminiDirect: vi.fn(),
  streamGeminiDirect: vi.fn(),
}))
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: createSpy, stream: streamSpy } }),
}))
vi.mock("../gemini/client.js", () => ({ callGeminiDirect, streamGeminiDirect }))

import { __resetPlatformExhaustionAlerts } from "../llm-platform-exhaustion.js"
// Imported once, after the mocks above: a cold import inside a test case is
// what pushed the first case past its 5 s budget under load.
import { llmComplete, llmCompleteStructured, llmStream, StructuredLlmError } from "../llm-client.js"

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
const kieClaudeText = (text: string) =>
  streamResponse([
    `data: {"type":"content_block_delta","delta":{"text":${JSON.stringify(text)}}}\n`,
    'data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n',
  ])
/** KIE's maintenance envelope: a failure before any token or charge. */
const kieDown = () => streamResponse(['{"code":500,"msg":"maintenance"}'])
const anthropicOk = { content: [{ type: "text", text: "direct" }], usage: { input_tokens: 1, output_tokens: 1 } }
const directTool = (input: unknown) => ({
  content: [{ type: "tool_use", id: "t1", name: "out", input }],
  usage: { input_tokens: 2, output_tokens: 2 },
  stop_reason: "tool_use",
})
function anthropicStreamStub(text: string) {
  return {
    on(event: string, cb: (delta: string) => void) {
      if (event === "text") cb(text)
      return this
    },
    abort() {},
    finalMessage: () => Promise.resolve({ usage: { input_tokens: 4, output_tokens: 4 } }),
  }
}

const claude = (extra: Record<string, unknown> = {}) => ({
  modelId: "claude-sonnet-5",
  system: "",
  messages: [{ role: "user" as const, content: "hi" }],
  ...extra,
})

describe("cheapLanesOnly — never pay the direct-vendor fallback", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    createSpy.mockReset().mockResolvedValue(anthropicOk)
    streamSpy.mockReset().mockImplementation(() => anthropicStreamStub("direct-stream"))
    callGeminiDirect.mockReset()
    streamGeminiDirect.mockReset()
    __resetPlatformExhaustionAlerts()
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Drive KIE's bounded transport-retry ladder (400 / 2 000 / 6 000 / 15 000 / 30 000 ms) without sitting it out. */
  async function throughKieLadder<T>(call: () => Promise<T>): Promise<T> {
    vi.useFakeTimers()
    try {
      const pending = call()
      const settled = pending.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }))
      await vi.advanceTimersByTimeAsync(60_000)
      const result = await settled
      if (!result.ok) throw result.e
      return result.v
    } finally {
      vi.useRealTimers()
    }
  }

  it("a KIE-primary Claude call: KIE fails → the direct lane is NOT asked, the failure surfaces, one warn line says why", async () => {
    fetchMock.mockImplementation(async () => kieDown())
    await expect(throughKieLadder(() => llmComplete(claude({ cheapLanesOnly: true })))).rejects.toThrow()
    expect(createSpy).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("cheap lanes only — not served from direct-anthropic"))).toBe(true)
  })

  it("the same call without the flag falls back to the direct lane, as before", async () => {
    fetchMock.mockImplementation(async () => kieDown())
    const res = await throughKieLadder(() => llmComplete(claude()))
    expect(res.text).toBe("direct")
    expect(createSpy).toHaveBeenCalledOnce()
  })

  it("a KIE success is served from KIE either way — the flag changes no primary lane", async () => {
    fetchMock.mockResolvedValue(kieClaudeText("kie"))
    const res = await llmComplete(claude({ cheapLanesOnly: true }))
    expect(res.text).toBe("kie")
    expect(res.lane).toBe("kie")
    expect(createSpy).not.toHaveBeenCalled()
  })

  it("a KIE-primary Claude STREAM: KIE fails before the first token → the direct stream is NOT asked", async () => {
    fetchMock.mockImplementation(async () => kieDown())
    await expect(throughKieLadder(() => llmStream(claude({ cheapLanesOnly: true }), () => {}))).rejects.toThrow()
    expect(streamSpy).not.toHaveBeenCalled()

    const res = await throughKieLadder(() => llmStream(claude(), () => {}))
    expect(res.text).toBe("direct-stream")
    expect(streamSpy).toHaveBeenCalledOnce()
  })

  it("a call that must run direct by its own settings (a reasoning effort on a Claude model) still runs direct — and its fallback TO KIE stays", async () => {
    createSpy.mockRejectedValue(new Error("anthropic 529 overloaded"))
    fetchMock.mockResolvedValue(kieClaudeText("from-kie"))
    const res = await llmComplete(claude({ cheapLanesOnly: true, reasoningEffort: "high" }))
    expect(createSpy).toHaveBeenCalledOnce()
    expect(res.text).toBe("from-kie")
  })

  it("Advanced mode (pinned direct) is untouched by the flag: the direct lane serves it", async () => {
    const res = await llmComplete(claude({ cheapLanesOnly: true, requireLane: "direct", advancedMode: true }))
    expect(res.text).toBe("direct")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a KIE-first Gemini call: KIE fails → the direct Google lane is NOT asked under the flag, and IS without it", async () => {
    const gemini = (extra: Record<string, unknown> = {}) => ({ modelId: "gemini-3.1-pro", system: "", messages: [{ role: "user" as const, content: "hi" }], ...extra })
    fetchMock.mockRejectedValue(new Error("kie 503"))
    callGeminiDirect.mockResolvedValue({ text: "from-direct", usage: { inputTokens: 1, outputTokens: 1 }, model: "gemini-3.1-pro", lane: "direct-gemini" })
    streamGeminiDirect.mockResolvedValue({ text: "from-direct", usage: { inputTokens: 1, outputTokens: 1 }, model: "gemini-3.1-pro", lane: "direct-gemini" })

    await expect(llmComplete(gemini({ cheapLanesOnly: true }))).rejects.toThrow()
    expect(callGeminiDirect).not.toHaveBeenCalled()
    await expect(llmStream(gemini({ cheapLanesOnly: true }), () => {})).rejects.toThrow()
    expect(streamGeminiDirect).not.toHaveBeenCalled()

    const res = await llmComplete(gemini())
    expect(res.text).toBe("from-direct")
    expect(callGeminiDirect).toHaveBeenCalledOnce()
    const streamed = await llmStream(gemini(), () => {})
    expect(streamed.text).toBe("from-direct")
    expect(streamGeminiDirect).toHaveBeenCalledOnce()
  })

  it("a structured call KIE never answered well: the direct-tool backup is NOT asked under the flag", async () => {
    const schema = z.object({ capital: z.string() })
    const request = (extra: Record<string, unknown> = {}) => ({
      modelId: "claude-sonnet-5.5",
      system: "facts",
      messages: [{ role: "user" as const, content: "capital of France?" }],
      ...extra,
    })
    fetchMock.mockImplementation(async () => kieClaudeText('{"city":"Paris"}'))
    createSpy.mockResolvedValue(directTool({ capital: "Paris" }))

    const err = await llmCompleteStructured(request({ cheapLanesOnly: true }), schema, { schemaName: "out", maxRetries: 0 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StructuredLlmError)
    expect(createSpy).not.toHaveBeenCalled()

    const res = await llmCompleteStructured(request(), schema, { schemaName: "out", maxRetries: 0 })
    expect(res.output).toEqual({ capital: "Paris" })
    expect(createSpy).toHaveBeenCalledOnce()
  })
})
