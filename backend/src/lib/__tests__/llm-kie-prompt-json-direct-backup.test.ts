/**
 * KIE serves a structured Claude call as prompt-JSON (no tool — a tool 503s or
 * drops the image there, probed 2026-10-16), and nothing on that wire enforces
 * the schema. So the direct Anthropic tool backs it up ONCE, both ways round:
 *
 * - KIE's answers never validate → the direct tool is asked once before the
 *   call fails (a drained direct account fails the call, never back to KIE);
 * - KIE's call fails → the direct lane serves it (the KIE-first fallback).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "test-anthropic-key", GEMINI_API_KEY: "test-gemini-key", NODE_ENV: "test" },
  hasCredits: () => true,
}))
const createSpy = vi.fn()
const streamSpy = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: createSpy, stream: streamSpy } }),
}))

import { PLATFORM_CAPACITY_MESSAGE, __resetPlatformExhaustionAlerts } from "../llm-platform-exhaustion.js"
import { userFacingMessage } from "../user-facing-error.js"

const kieTextStream = (text: string) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const e = new TextEncoder()
      controller.enqueue(e.encode(`data: {"type":"content_block_delta","delta":{"text":${JSON.stringify(text)}}}\n`))
      controller.enqueue(e.encode('data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n'))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}
const directTool = (input: unknown) => ({
  content: [{ type: "tool_use", id: "t1", name: "out", input }],
  usage: { input_tokens: 2, output_tokens: 2 },
  stop_reason: "tool_use",
})
const drained = () => Anthropic.APIError.generate(400, {
  type: "error",
  error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
}, undefined, new Headers())

const schema = z.object({ capital: z.string() })
/** Sonnet 5.5 with no effort: a KIE-first structured call. */
const request = (extra: Record<string, unknown> = {}) => ({
  modelId: "claude-sonnet-5.5",
  system: "facts",
  messages: [{ role: "user" as const, content: "capital of France?" }],
  ...extra,
})

describe("KIE prompt-JSON, backed by the direct tool once", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    createSpy.mockReset()
    __resetPlatformExhaustionAlerts()
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("KIE's answers never validate: the direct tool is asked once, with the caller's own messages, and its answer returns", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieTextStream('{"city":"Paris"}'))
    createSpy.mockResolvedValue(directTool({ capital: "Paris" }))

    const res = await llmCompleteStructured(request(), schema, { schemaName: "out", maxRetries: 1 })

    expect(res.output).toEqual({ capital: "Paris" })
    expect(res.lane).toBe("direct-anthropic")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(createSpy).toHaveBeenCalledTimes(1)
    const body = createSpy.mock.calls[0][0] as Record<string, unknown>
    expect(body.messages).toEqual([{ role: "user", content: "capital of France?" }])
    expect((body.tools as Array<{ name: string }>)[0].name).toBe("out")
    // Usage is summed over every attempt: two KIE asks and the direct one.
    expect(res.inputTokens).toBe(4)
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("asking the direct-anthropic tool once"))).toBe(true)
  })

  it("applies under maxRetries: 0 too — one KIE ask, then one direct ask", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieTextStream("I can't answer that as JSON."))
    createSpy.mockResolvedValue(directTool({ capital: "Paris" }))
    const res = await llmCompleteStructured(request(), schema, { schemaName: "out", maxRetries: 0 })
    expect(res.output).toEqual({ capital: "Paris" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledTimes(1)
  })

  it("the direct answer does not validate either: the call fails, naming the direct lane", async () => {
    const { llmCompleteStructured, StructuredLlmError } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieTextStream('{"city":"Paris"}'))
    createSpy.mockResolvedValue(directTool({ city: "Paris" }))
    const err = await llmCompleteStructured(request(), schema, { schemaName: "out", maxRetries: 0 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StructuredLlmError)
    expect((err as InstanceType<typeof StructuredLlmError>).lane).toBe("direct-anthropic")
    expect((err as Error).message).toMatch(/after 2 attempt\(s\)/)
    expect(createSpy).toHaveBeenCalledTimes(1)
  })

  it("the direct account refuses: the call fails with the capacity sentence and never goes back to KIE", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieTextStream('{"city":"Paris"}'))
    createSpy.mockRejectedValue(drained())
    const err = await llmCompleteStructured(request(), schema, { schemaName: "out", maxRetries: 0 }).catch((e: unknown) => e)
    expect(userFacingMessage(err, "x")).toBe(PLATFORM_CAPACITY_MESSAGE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledTimes(1)
  })

  it("a call pinned to KIE gets no direct ask", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieTextStream('{"city":"Paris"}'))
    await expect(llmCompleteStructured(request({ requireLane: "kie" }), schema, { schemaName: "out", maxRetries: 0 })).rejects.toThrow(/validation failed after 1 attempt/)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it("a valid KIE answer needs no backup", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieTextStream('```json\n{"capital":"Paris"}\n```'))
    const res = await llmCompleteStructured(request(), schema, { schemaName: "out" })
    expect(res).toMatchObject({ output: { capital: "Paris" }, lane: "kie" })
    expect(createSpy).not.toHaveBeenCalled()
  })

  it("the other direction: KIE's call fails, and the direct tool serves the same attempt", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => new Response('{"type":"error","error":{"type":"api_error","message":"Internal error"}}', { status: 400 }))
    createSpy.mockResolvedValue(directTool({ capital: "Paris" }))
    // retryStreamOnError: false skips the KIE transport-retry ladder's pauses.
    const res = await llmCompleteStructured(request({ retryStreamOnError: false }), schema, { schemaName: "out", maxRetries: 0 })
    expect(res).toMatchObject({ output: { capital: "Paris" }, lane: "direct-anthropic" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledTimes(1)
  })

  it("a drained direct account already latched: KIE's bad answer fails the call without asking direct again", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    // Effort → direct first; the refusal arms the latch and KIE answers (badly).
    createSpy.mockRejectedValue(drained())
    fetchMock.mockImplementation(async () => kieTextStream('{"city":"Paris"}'))
    const err = await llmCompleteStructured(request({ reasoningEffort: "high" }), schema, { schemaName: "out", maxRetries: 0 }).catch((e: unknown) => e)
    expect((err as { lane?: string }).lane).toBe("kie")
    expect(createSpy).toHaveBeenCalledTimes(1)
  })
})

// A refusal is the model's answer about the request (stop_reason "refusal"):
// no lane fallback, no direct-tool backup, no transport retry — on either lane.
describe("content refusals never route around", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  const kieRefusalStream = () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const e = new TextEncoder()
      controller.enqueue(e.encode('data: {"type":"content_block_delta","delta":{"text":"I can\'t help with that."}}\n'))
      controller.enqueue(e.encode('data: {"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"input_tokens":3,"output_tokens":4}}\n'))
      controller.close()
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } })
  const directRefusal = () => ({
    content: [{ type: "text", text: "I can't help with that." }],
    usage: { input_tokens: 3, output_tokens: 4 },
    stop_reason: "refusal",
  })
  /** The refusal anywhere on the thrown error's cause chain. */
  async function refusalOf(err: unknown) {
    const { LlmContentRefusalError } = await import("../llm-errors.js")
    let cur: unknown = err
    for (let i = 0; i < 6 && cur; i++) {
      if (cur instanceof LlmContentRefusalError) return cur
      cur = (cur as { cause?: unknown }).cause
    }
    return undefined
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    createSpy.mockReset()
    __resetPlatformExhaustionAlerts()
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("on the direct lane: typed, the content-policy sentence, and KIE is never asked", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    createSpy.mockResolvedValue(directRefusal())
    const err = await llmCompleteStructured(request({ reasoningEffort: "high" }), schema, { schemaName: "out" }).catch((e: unknown) => e)
    expect(await refusalOf(err)).toBeDefined()
    expect(userFacingMessage(err, "x")).toBe("Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image.")
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("on KIE's stream: typed, and neither the direct lane nor the direct-tool backup is asked", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieRefusalStream())
    const err = await llmCompleteStructured(request(), schema, { schemaName: "out" }).catch((e: unknown) => e)
    expect(await refusalOf(err)).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it("while the direct account is latched: KIE's refusal is the answer, and direct is not asked again", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    createSpy.mockRejectedValue(drained())
    fetchMock.mockImplementation(async () => kieRefusalStream())
    // The first call's refusal arms the latch; the second goes straight to KIE.
    await llmCompleteStructured(request({ reasoningEffort: "high" }), schema, { schemaName: "out" }).catch(() => undefined)
    const err = await llmCompleteStructured(request({ reasoningEffort: "high" }), schema, { schemaName: "out" }).catch((e: unknown) => e)
    expect(await refusalOf(err)).toBeDefined()
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("its sentence is the media lanes' safety-block sentence", async () => {
    const { LLM_CONTENT_REFUSAL_MESSAGE } = await import("../llm-errors.js")
    const { CONTENT_POLICY_MESSAGES } = await import("../../providers/kie/client.js")
    expect(LLM_CONTENT_REFUSAL_MESSAGE).toBe(CONTENT_POLICY_MESSAGES.safety)
  })
})

describe("an empty KIE prompt-JSON answer is not a success", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    createSpy.mockReset()
    __resetPlatformExhaustionAlerts()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("the collapsed stream throws the no-payload lane error, and the direct lane serves the call", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieTextStream(""))
    createSpy.mockResolvedValue(directTool({ capital: "Paris" }))
    const res = await llmComplete({ ...request({ retryStreamOnError: false }), jsonSchema: { name: "out", schema: { type: "object" } } })
    expect(res.lane).toBe("direct-anthropic")
    expect(res.text).toBe('{"capital":"Paris"}')
  })

  it("pinned to KIE, the empty answer surfaces as that lane error", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieTextStream("  "))
    await expect(llmComplete({ ...request({ requireLane: "kie", retryStreamOnError: false }), jsonSchema: { name: "out", schema: { type: "object" } } }))
      .rejects.toThrow(/structured call returned no decodable payload/)
  })
})

// Only a STRUCTURED call fails on a refusal (failOnRefusal, set by
// llm/structured.ts). A plain call — llm-chat, ai-writer, captions — keeps the
// refusal's text as its answer on every lane, as it always has.
describe("a plain call's refusal is an ordinary answer", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const refusalText = "I can't help with that."
  const kieRefusal = () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const e = new TextEncoder()
      controller.enqueue(e.encode(`data: {"type":"content_block_delta","delta":{"text":${JSON.stringify(refusalText)}}}\n`))
      controller.enqueue(e.encode('data: {"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"input_tokens":3,"output_tokens":4}}\n'))
      controller.close()
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } })
  const plain = (extra: Record<string, unknown> = {}) => ({
    modelId: "claude-sonnet-5.5", system: "chat", messages: [{ role: "user" as const, content: "hi" }], ...extra,
  })

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    createSpy.mockReset()
    streamSpy.mockReset()
    __resetPlatformExhaustionAlerts()
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("direct SDK, one-shot", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockResolvedValue({ content: [{ type: "text", text: refusalText }], usage: { input_tokens: 3, output_tokens: 4 }, stop_reason: "refusal" })
    const res = await llmComplete(plain({ reasoningEffort: "high" }))
    expect(res).toMatchObject({ text: refusalText, lane: "direct-anthropic" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("direct SDK, streamed", async () => {
    const { llmStream } = await import("../llm-client.js")
    streamSpy.mockReturnValue({
      on: (event: string, cb: (delta: string) => void) => { if (event === "text") cb(refusalText) },
      finalMessage: async () => ({ stop_reason: "refusal", usage: { input_tokens: 3, output_tokens: 4 } }),
      abort: () => {},
    })
    const tokens: string[] = []
    const res = await llmStream(plain({ reasoningEffort: "high" }), (t) => tokens.push(t))
    expect(res.text).toBe(refusalText)
    expect(tokens.join("")).toBe(refusalText)
  })

  it("KIE's collapsed stream (one-shot)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieRefusal())
    const res = await llmComplete(plain())
    expect(res).toMatchObject({ text: refusalText, lane: "kie" })
    expect(createSpy).not.toHaveBeenCalled()
  })

  it("KIE's stream", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockImplementation(async () => kieRefusal())
    const res = await llmStream(plain(), () => {})
    expect(res).toMatchObject({ text: refusalText, lane: "kie" })
  })
})
