/**
 * A direct lane whose PLATFORM account is drained or refused is retried ONCE
 * on KIE serving the same registry model — even on a call pinned direct —
 * and when KIE cannot take the call (inline video) or fails too, the caller
 * gets the capacity sentence, never the vendor's reply.
 *
 * Staging 2026-10-14 (job 61b2e080): the UGC writer — claude-sonnet-4.6,
 * text + screenshot URLs, pinned direct by the plugin host's multimodal
 * default — failed outright on "Your credit balance is too low" and stored
 * that reply as the job's error, while KIE served the same model fine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { LLM_MODELS } from "@nodaro/shared/llm-models"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "test-anthropic-key", GEMINI_API_KEY: "test-gemini-key", NODE_ENV: "test" },
  hasCredits: () => true,
}))
const createSpy = vi.fn()
const streamSpy = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: createSpy, stream: streamSpy } }),
}))
const geminiMock = vi.hoisted(() => ({ callGeminiDirect: vi.fn(), streamGeminiDirect: vi.fn() }))
vi.mock("../gemini/client.js", () => geminiMock)

import { LlmPlatformExhaustedError } from "../llm-errors.js"
import { PLATFORM_CAPACITY_MESSAGE, __resetPlatformExhaustionAlerts } from "../llm-platform-exhaustion.js"
import { userFacingMessage } from "../user-facing-error.js"
import { providerDetailOf } from "../provider-error-detail.js"

const drained = () => Anthropic.APIError.generate(400, {
  type: "error",
  error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." },
  request_id: "req_011Cg1vRqC6zwPq2Yvfy6NS6",
}, undefined, new Headers())

const geminiDepleted = () => Object.assign(
  new Error('{"error":{"code":429,"message":"Your prepayment credits are depleted.","status":"RESOURCE_EXHAUSTED"}}'),
  { status: 429 },
)

function sse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}
const kieToolStream = (json: string) => sse([
  'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"ugc_script"}}\n',
  `data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":${JSON.stringify(json)}}}\n`,
  'data: {"type":"message_delta","usage":{"input_tokens":3,"output_tokens":3}}\n',
])
const kieTextStream = (text: string) => sse([
  `data: {"type":"content_block_delta","delta":{"text":${JSON.stringify(text)}}}\n`,
  'data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n',
])
const kieChatOk = (text: string) => new Response(
  JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
  { status: 200, headers: { "Content-Type": "application/json" } },
)

/** The UGC writer's call, as the plugin host makes it (text + screenshot URLs, pinned direct). */
const writerRequest = () => ({
  modelId: "claude-sonnet-4.6",
  system: "write",
  messages: [{
    role: "user" as const,
    content: [
      { type: "text" as const, text: "script this site" },
      { type: "image" as const, url: "https://r2.example/shot-1.png" },
    ],
  }],
  maxTokens: 4096,
  temperature: 0.4,
  requireLane: "direct" as const,
})

describe("platform-account exhaustion → one KIE retry", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    createSpy.mockReset()
    streamSpy.mockReset()
    geminiMock.callGeminiDirect.mockReset()
    geminiMock.streamGeminiDirect.mockReset()
    __resetPlatformExhaustionAlerts()
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("the UGC writer's pinned-direct structured call is served by KIE on the same model, and the operator is alerted", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    createSpy.mockRejectedValue(drained())
    fetchMock.mockResolvedValue(kieToolStream('{"ok":true}'))

    const res = await llmCompleteStructured(writerRequest(), z.object({ ok: z.boolean() }), { schemaName: "ugc_script", maxRetries: 1 })

    expect(res.output).toEqual({ ok: true })
    expect(res.lane).toBe("kie")
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.model).toBe(LLM_MODELS.find((m) => m.id === "claude-sonnet-4.6")!.kieSlugOrModel)
    const alerts = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.startsWith("[ALERT]"))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toContain("anthropic")
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("[llm-lane-fallback] claude-sonnet-4.6"))).toBe(true)
  })

  it("KIE drained too: the caller reads the capacity sentence; both raw replies stay operator-side", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    createSpy.mockRejectedValue(drained())
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 402, msg: "Credits insufficient" }), { status: 402 }))

    const err = await llmCompleteStructured(writerRequest(), z.object({ ok: z.boolean() }), { maxRetries: 1 }).catch((e: unknown) => e)

    expect(userFacingMessage(err, "x")).toBe(PLATFORM_CAPACITY_MESSAGE)
    // A drained account is never transport-retried: one KIE request, not the ladder.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(providerDetailOf(err)).toMatch(/Credits insufficient|credit balance is too low/)
  })

  it("KIE fails for another reason: still the capacity sentence (the primary's account is why KIE was asked)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockRejectedValue(drained())
    fetchMock.mockResolvedValue(new Response("upstream down", { status: 503 }))

    const err = await llmComplete({ ...writerRequest(), retryStreamOnError: false }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmPlatformExhaustedError)
    expect(userFacingMessage(err, "x")).toBe(PLATFORM_CAPACITY_MESSAGE)
    // The message itself is user-safe; both diagnostics are operator-side.
    expect((err as Error).message).toBe(PLATFORM_CAPACITY_MESSAGE)
    expect((err as LlmPlatformExhaustedError).internalDetails).toContain("credit balance is too low")
    expect((err as LlmPlatformExhaustedError).internalDetails).toContain("upstream down")
  })

  it("a pinned direct call failing for any OTHER reason still never falls back", async () => {
    const { llmComplete } = await import("../llm-client.js")
    const badRequest = Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "max_tokens too large" } }, undefined, new Headers())
    createSpy.mockRejectedValue(badRequest)

    await expect(llmComplete(writerRequest())).rejects.toBe(badRequest)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("inline video cannot travel to KIE: no fallback, and the person still reads the capacity sentence", async () => {
    const { llmComplete } = await import("../llm-client.js")
    geminiMock.callGeminiDirect.mockRejectedValue(geminiDepleted())

    const err = await llmComplete({
      modelId: "gemini-3.8-flash",
      system: "",
      messages: [{ role: "user", content: [{ type: "video_base64", mediaType: "video/mp4", data: "AAAA" }, { type: "text", text: "what happens?" }] }],
      requireLane: "direct",
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmPlatformExhaustedError)
    expect(userFacingMessage(err, "x")).toBe(PLATFORM_CAPACITY_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a pinned direct Gemini text call is served by KIE's chat lane on a depleted prepayment", async () => {
    const { llmComplete } = await import("../llm-client.js")
    geminiMock.callGeminiDirect.mockRejectedValue(geminiDepleted())
    fetchMock.mockResolvedValue(kieChatOk("kie-served"))

    const res = await llmComplete({ modelId: "gemini-3.8-flash", system: "", messages: [{ role: "user", content: "hi" }], requireLane: "direct" })

    expect(geminiMock.callGeminiDirect).toHaveBeenCalledTimes(1)
    expect(res.text).toBe("kie-served")
    expect(res.lane).toBe("kie")
  })

  it("a KIE pin never reaches the direct lane, drained or not", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 402, msg: "Credits insufficient" }), { status: 402 }))

    const err = await llmComplete({ modelId: "claude-sonnet-4.6", system: "", messages: [{ role: "user", content: "hi" }], requireLane: "kie" }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmPlatformExhaustedError)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it("the Claude direct-only stream (an effort-bearing call) falls back to KIE's stream before any token", async () => {
    const { llmStream } = await import("../llm-client.js")
    streamSpy.mockReturnValue({
      on() { return this },
      abort() {},
      finalMessage: () => Promise.reject(drained()),
    })
    fetchMock.mockResolvedValue(kieTextStream("from kie"))
    const tokens: string[] = []

    const res = await llmStream(
      { modelId: "claude-sonnet-4.6", system: "", messages: [{ role: "user", content: "hi" }], reasoningEffort: "high" },
      (t) => tokens.push(t),
    )

    expect(streamSpy).toHaveBeenCalledTimes(1)
    expect(res.text).toBe("from kie")
    expect(tokens.join("")).toBe("from kie")
    expect(res.lane).toBe("kie")
  })
})

describe("a drained direct account is latched: the next calls go straight to KIE, for a few minutes only", () => {
  // Staging 2026-10-14: every call pinned direct paid the failed round-trip to a drained Anthropic account before
  // KIE served it. After one refusal the direct lane is skipped for DIRECT_LANE_LATCH_MS, then asked again.
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    createSpy.mockReset()
    streamSpy.mockReset()
    geminiMock.callGeminiDirect.mockReset()
    __resetPlatformExhaustionAlerts()
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  const schema = z.object({ ok: z.boolean() })

  it("the second pinned call never asks the drained direct lane; KIE serves it and the skip is logged", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    createSpy.mockRejectedValue(drained())
    fetchMock.mockImplementation(async () => kieToolStream('{"ok":true}'))

    await llmCompleteStructured(writerRequest(), schema, { maxRetries: 1 })
    const res = await llmCompleteStructured(writerRequest(), schema, { maxRetries: 1 })

    expect(res.output).toEqual({ ok: true })
    expect(res.lane).toBe("kie")
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const warns = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(warns.some((l: string) => l.startsWith("[llm-lane-fallback] claude-sonnet-4.6:") && l.includes("latched"))).toBe(true)
  })

  it("the latch expires on its own: after the window the direct lane is asked again (a topped-up account serves)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    const { DIRECT_LANE_LATCH_MS } = await import("../llm-platform-exhaustion.js")
    const t0 = Date.now()
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0)
    createSpy.mockRejectedValueOnce(drained())
    fetchMock.mockImplementation(async () => kieTextStream("kie"))
    await llmComplete(writerRequest())
    expect(createSpy).toHaveBeenCalledTimes(1)

    clock.mockReturnValue(t0 + DIRECT_LANE_LATCH_MS + 1)
    createSpy.mockResolvedValueOnce({ content: [{ type: "text", text: "direct again" }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" })
    const res = await llmComplete(writerRequest())

    expect(createSpy).toHaveBeenCalledTimes(2)
    expect(res.text).toBe("direct again")
  })

  it("latched and KIE fails too: the person still reads the capacity sentence, and direct is not asked", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockRejectedValue(drained())
    fetchMock.mockResolvedValueOnce(kieTextStream("first"))
    await llmComplete(writerRequest())
    fetchMock.mockImplementation(async () => new Response("upstream down", { status: 503 }))

    const err = await llmComplete({ ...writerRequest(), retryStreamOnError: false }).catch((e: unknown) => e)

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(err).toBeInstanceOf(LlmPlatformExhaustedError)
    expect(userFacingMessage(err, "x")).toBe(PLATFORM_CAPACITY_MESSAGE)
  })

  it("a call KIE cannot carry (inline video) still goes direct while latched — the latch only ever moves a call to a lane that can serve it", async () => {
    const { llmComplete } = await import("../llm-client.js")
    geminiMock.callGeminiDirect.mockRejectedValueOnce(geminiDepleted())
    fetchMock.mockResolvedValue(kieChatOk("kie-served"))
    await llmComplete({ modelId: "gemini-3.8-flash", system: "", messages: [{ role: "user", content: "hi" }], requireLane: "direct" })
    geminiMock.callGeminiDirect.mockResolvedValueOnce({ text: "saw the video", lane: "direct" })

    const res = await llmComplete({
      modelId: "gemini-3.8-flash",
      system: "",
      messages: [{ role: "user", content: [{ type: "video_base64", mediaType: "video/mp4", data: "AAAA" }, { type: "text", text: "what happens?" }] }],
      requireLane: "direct",
    })

    expect(geminiMock.callGeminiDirect).toHaveBeenCalledTimes(2)
    expect(res.text).toBe("saw the video")
  })

  it("an unpinned Claude call served direct (effort-bearing) skips the latched lane too, streamed or not", async () => {
    const { llmComplete, llmStream } = await import("../llm-client.js")
    createSpy.mockRejectedValue(drained())
    fetchMock.mockImplementation(async () => kieTextStream("from kie"))
    const effortCall = { modelId: "claude-sonnet-4.6", system: "", messages: [{ role: "user" as const, content: "hi" }], reasoningEffort: "high" as const }
    await llmComplete(effortCall)
    expect(createSpy).toHaveBeenCalledTimes(1)

    const res = await llmComplete(effortCall)
    const streamed = await llmStream(effortCall, () => {})

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(streamSpy).not.toHaveBeenCalled()
    expect(res.lane).toBe("kie")
    expect(streamed.text).toBe("from kie")
  })

  it("a pinned structured STREAM (llmStreamStructured) skips the latched lane too", async () => {
    const { llmComplete, llmStreamStructured } = await import("../llm-client.js")
    createSpy.mockRejectedValue(drained())
    fetchMock.mockImplementation(async () => kieToolStream('{"ok":true}'))
    await llmComplete(writerRequest())

    const res = await llmStreamStructured(writerRequest(), schema, { maxRetries: 1, onToolJson: () => {} })

    expect(streamSpy).not.toHaveBeenCalled()
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(res.output).toEqual({ ok: true })
  })
  it("a pinned direct STREAM skips the latched lane", async () => {
    const { llmComplete, llmStream } = await import("../llm-client.js")
    createSpy.mockRejectedValue(drained())
    fetchMock.mockImplementation(async () => kieTextStream("from kie"))
    await llmComplete(writerRequest())

    const tokens: string[] = []
    const res = await llmStream({ modelId: "claude-sonnet-4.6", system: "", messages: [{ role: "user", content: "hi" }], requireLane: "direct" }, (t) => tokens.push(t))

    expect(streamSpy).not.toHaveBeenCalled()
    expect(res.text).toBe("from kie")
    expect(tokens.join("")).toBe("from kie")
  })
})

describe("the KIE equivalence is the registry", () => {
  // Every model that can be served direct names the model KIE serves it as, so
  // a drained direct account always has a KIE twin to retry on. This table is
  // the equivalence — a change to it is a change to where a drained account's
  // calls land, and must be made here on purpose.
  it("every direct-capable model maps to its KIE twin", async () => {
    const { kieEquivalentOf } = await import("../llm-client.js")
    const table = Object.fromEntries(
      LLM_MODELS.filter((m) => m.directFallbackModel || m.directGeminiModel).map((m) => [m.id, kieEquivalentOf(m.id)]),
    )
    for (const [id, kie] of Object.entries(table)) {
      expect(kie, id).toBeTruthy()
    }
    expect(table).toMatchInlineSnapshot(`
      {
        "claude-fable-5": "claude-fable-5",
        "claude-haiku-4.5": "claude-haiku-4-5",
        "claude-haiku-5.5": "claude-haiku-5-5",
        "claude-opus-4.7": "claude-opus-4-7",
        "claude-opus-4.8": "claude-opus-4-8",
        "claude-opus-5": "claude-opus-5",
        "claude-opus-5.5": "claude-opus-5-5",
        "claude-sonnet-4.6": "claude-sonnet-4-6",
        "claude-sonnet-5": "claude-sonnet-5",
        "claude-sonnet-5.5": "claude-sonnet-5-5",
        "gemini-3-flash": "gemini-3-flash",
        "gemini-3.1-pro": "gemini-3.1-pro",
        "gemini-3.6-flash": "gemini-3-6-flash-openai",
        "gemini-3.7-flash": "gemini-3-7-flash-openai",
        "gemini-3.8-flash": "gemini-3-8-flash-openai",
      }
    `)
  })
})
