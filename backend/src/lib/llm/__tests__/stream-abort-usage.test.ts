/**
 * A stopped stream is charged its estimated usage (D2).
 *
 * When `llmStream`'s caller aborts AFTER the request was dispatched, the
 * provider has already read the prompt and written part of an answer, and it
 * bills for both — but it never reports the usage, because the stream ended
 * before the frame that carries it. Every lane therefore throws
 * `LlmStreamAbortedError` carrying an ESTIMATE: `ceil(requestChars ÷ 4)` in,
 * `ceil(streamedChars ÷ 4)` out, priced at the serving lane's rate. The direct
 * Gemini lane reports usage on every chunk, so it uses that when it has it.
 *
 * An abort before dispatch spent nothing and stays a plain error (refunded);
 * a timeout is not an abort; a stopped stream is never retried and never
 * re-asked on another lane.
 *
 * The transports are faked the way they really fail: the KIE fetch rejects at
 * once on an already-aborted signal and errors the body stream with the
 * signal's reason when it fires (undici's behaviour), the Anthropic SDK stream
 * rejects `finalMessage` once `abort()` is called, and the Gemini stream
 * rejects on its `abortSignal`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const configMock: Record<string, unknown> = {
  KIE_API_KEY: "test-kie-key",
  KIE_API_BASE_URL: "https://api.kie.ai",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  GEMINI_API_KEY: "test-gemini-key",
  NODE_ENV: "test",
}
vi.mock("../../config.js", () => ({ config: configMock, hasCredits: () => false }))

const anthropicStream = vi.fn()
vi.mock("../../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: vi.fn(), stream: anthropicStream } }),
}))

const generateContentStream = vi.fn()
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: vi.fn(), generateContentStream }
    files = { upload: vi.fn(), get: vi.fn() }
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}))

const { llmStream } = await import("../../llm-client.js")
const { LlmStreamAbortedError, billedProviderCost } = await import("../../llm-errors.js")
const { laneFallbackAllowed } = await import("../lane-fallback.js")

/** A request of exactly `chars` characters (no system prompt, one text turn). */
function requestOf(modelId: string, chars: number, extra: Record<string, unknown> = {}) {
  return { modelId, system: "", messages: [{ role: "user" as const, content: "x".repeat(chars) }], ...extra }
}

/** One KIE Claude (`messages` dialect) text delta frame. */
const messagesDelta = (text: string) =>
  `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`

/**
 * fetch as undici behaves on an AbortSignal: rejects at once when it has
 * already fired; otherwise answers 200 with an SSE body that delivers `frames`
 * and then stays open until the signal fires, which errors the body with the
 * signal's reason (so `reader.read()` rejects).
 */
function kieFetch(frames: string[]) {
  return vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
    const signal = init.signal
    if (signal?.aborted) throw signal.reason
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(f))
        signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true })
      },
    })
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
  })
}

/**
 * The Anthropic SDK's `MessageStream`, as far as `streamAnthropicDirect` uses
 * it: `on("text")`, `abort()`, and a `finalMessage()` that emits `deltas` and
 * then waits — rejecting the way the SDK does once `abort()` is called.
 */
function anthropicHangingStream(deltas: string[]) {
  const textListeners: Array<(d: string) => void> = []
  let aborted = false
  let wake: (() => void) | undefined
  const stream = {
    abort: vi.fn(() => {
      aborted = true
      wake?.()
    }),
    on(event: string, cb: (d: string) => void) {
      if (event === "text") textListeners.push(cb)
      return stream
    },
    async finalMessage() {
      await Promise.resolve()
      for (const d of deltas) {
        if (aborted) break
        for (const cb of textListeners) cb(d)
      }
      if (!aborted) await new Promise<void>((resolve) => { wake = resolve })
      throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })
    },
  }
  return stream
}

/** `generateContentStream` as the SDK does it: yields `chunks`, then rejects when `abortSignal` fires. */
function geminiHangingStream(chunks: Array<Record<string, unknown>>) {
  return async ({ config }: { config: { abortSignal?: AbortSignal } }) => {
    const signal = config.abortSignal
    if (signal?.aborted) throw signal.reason
    return (async function* () {
      for (const c of chunks) yield c
      await new Promise<void>((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason)
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    })()
  }
}

/** An `onToken` that aborts `controller` once `afterChars` characters have arrived. */
function abortAfter(controller: AbortController, afterChars: number) {
  let seen = 0
  return (chunk: string) => {
    seen += chunk.length
    if (seen >= afterChars) controller.abort()
  }
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (err) {
    return err
  }
  throw new Error("expected the stream to throw")
}

let fetchMock: ReturnType<typeof kieFetch>

beforeEach(() => {
  anthropicStream.mockReset()
  generateContentStream.mockReset()
  configMock.ANTHROPIC_API_KEY = "test-anthropic-key"
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("a stopped stream throws LlmStreamAbortedError carrying its estimated usage", () => {
  it("aborted KIE SSE stream throws LlmStreamAbortedError with estimated usage", async () => {
    // Opus 5.5 on KIE (preferKie): requestChars 4000, 1200 chars streamed, then abort.
    fetchMock = kieFetch(Array.from({ length: 12 }, () => messagesDelta("y".repeat(100))))
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()

    const p = llmStream(requestOf("claude-opus-5.5", 4000), abortAfter(controller, 1200), controller.signal)

    // in 1000, out 300: 1000×1.6e-6 + 300×8e-6 = 0.004 USD
    await expect(p).rejects.toMatchObject({
      name: "LlmStreamAbortedError",
      code: "stream_aborted",
      lane: "kie",
      usage: { inputTokens: 1000, outputTokens: 300, complete: false, estimated: true },
    })
    const err = await caught(p)
    expect(err).toBeInstanceOf(LlmStreamAbortedError)
    expect(billedProviderCost(err)).toBeCloseTo(0.004, 9)
  })

  it("rounds both estimates UP (ceil ÷ 4)", async () => {
    fetchMock = kieFetch([messagesDelta("y".repeat(101))])
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()

    const err = await caught(llmStream(requestOf("claude-opus-5.5", 4001), abortAfter(controller, 101), controller.signal))

    expect(err).toMatchObject({ usage: { inputTokens: 1001, outputTokens: 26, estimated: true } })
    expect(billedProviderCost(err)).toBeCloseTo((1001 * 1.6 + 26 * 8) / 1_000_000, 12)
  })

  it("aborted Anthropic direct stream estimates at the direct rate", async () => {
    vi.stubGlobal("fetch", vi.fn())
    anthropicStream.mockImplementation(() => anthropicHangingStream(Array.from({ length: 12 }, () => "z".repeat(100))))
    const controller = new AbortController()

    const err = await caught(llmStream(
      requestOf("claude-opus-5.5", 4000, { requireLane: "direct" }),
      abortAfter(controller, 1200),
      controller.signal,
    ))

    expect(err).toBeInstanceOf(LlmStreamAbortedError)
    expect(err).toMatchObject({
      lane: "direct-anthropic",
      usage: { inputTokens: 1000, outputTokens: 300, complete: false, estimated: true },
    })
    // Opus direct: 1000×4e-6 + 300×20e-6 = 0.01
    expect(billedProviderCost(err)).toBeCloseTo(0.01, 9)
  })

  it("aborted direct Gemini stream uses its reported per-chunk usage", async () => {
    vi.stubGlobal("fetch", vi.fn())
    // gemini-4-argon is directOnly: the stream is the direct Google lane.
    generateContentStream.mockImplementation(geminiHangingStream([
      { text: "a".repeat(100), usageMetadata: { promptTokenCount: 480, candidatesTokenCount: 10, thoughtsTokenCount: 50 } },
      { text: "b".repeat(100), usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 40, thoughtsTokenCount: 60 } },
    ]))
    const controller = new AbortController()

    const err = await caught(llmStream(requestOf("gemini-4-argon", 4000), abortAfter(controller, 200), controller.signal))

    expect(err).toBeInstanceOf(LlmStreamAbortedError)
    // The LAST chunk's cumulative usage, thoughts folded into output — not the 1000/50 size estimate.
    expect(err).toMatchObject({ lane: "direct-gemini", usage: { inputTokens: 500, outputTokens: 100, complete: false } })
    // argon direct: 500×4e-6 + 100×20e-6 = 0.004
    expect(billedProviderCost(err)).toBeCloseTo(0.004, 9)
  })

  it("aborted direct Gemini stream with no reported usage falls back to the estimate", async () => {
    vi.stubGlobal("fetch", vi.fn())
    generateContentStream.mockImplementation(geminiHangingStream([{ text: "a".repeat(400) }]))
    const controller = new AbortController()

    const err = await caught(llmStream(requestOf("gemini-4-argon", 4000), abortAfter(controller, 400), controller.signal))

    expect(err).toMatchObject({ lane: "direct-gemini", usage: { inputTokens: 1000, outputTokens: 100, estimated: true } })
    expect(billedProviderCost(err)).toBeCloseTo(1000 * 4e-6 + 100 * 20e-6, 9)
  })

  it("a stop before the first token still charges the prompt (input only)", async () => {
    configMock.ANTHROPIC_API_KEY = ""
    fetchMock = kieFetch([])
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()

    const p = llmStream(requestOf("claude-opus-5.5", 4000), () => {}, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort()

    const err = await caught(p)
    expect(err).toMatchObject({ name: "LlmStreamAbortedError", usage: { inputTokens: 1000, outputTokens: 0, estimated: true } })
    expect(billedProviderCost(err)).toBeCloseTo(1000 * 1.6e-6, 12)
  })
})

describe("what is NOT a stopped stream", () => {
  it("abort before dispatch carries no usage", async () => {
    fetchMock = kieFetch([messagesDelta("never")])
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    controller.abort()

    const err = await caught(llmStream(requestOf("claude-opus-5.5", 4000), () => {}, controller.signal))

    expect(err).not.toBeInstanceOf(LlmStreamAbortedError)
    expect(billedProviderCost(err)).toBeNull()
  })

  it("abort before dispatch on the direct Anthropic lane sends nothing and carries no usage", async () => {
    vi.stubGlobal("fetch", vi.fn())
    anthropicStream.mockImplementation(() => anthropicHangingStream(["never"]))
    const controller = new AbortController()
    controller.abort()

    const err = await caught(llmStream(requestOf("claude-opus-5.5", 4000, { requireLane: "direct" }), () => {}, controller.signal))

    expect(err).not.toBeInstanceOf(LlmStreamAbortedError)
    expect(billedProviderCost(err)).toBeNull()
    expect(anthropicStream).not.toHaveBeenCalled()
  })

  it("abort before dispatch on the direct Gemini lane sends nothing and carries no usage", async () => {
    vi.stubGlobal("fetch", vi.fn())
    generateContentStream.mockImplementation(geminiHangingStream([{ text: "never" }]))
    const controller = new AbortController()
    controller.abort()

    const err = await caught(llmStream(requestOf("gemini-4-argon", 4000), () => {}, controller.signal))

    expect(err).not.toBeInstanceOf(LlmStreamAbortedError)
    expect(billedProviderCost(err)).toBeNull()
    expect(generateContentStream).not.toHaveBeenCalled()
  })

  it("a timeout is not an abort: the stream's plain error, no usage", async () => {
    fetchMock = kieFetch([messagesDelta("y".repeat(100))])
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    const onToken = () => controller.abort(new DOMException("The operation timed out.", "TimeoutError"))

    const err = await caught(llmStream(requestOf("claude-opus-5.5", 4000), onToken, controller.signal))

    expect(err).not.toBeInstanceOf(LlmStreamAbortedError)
    expect(err).toMatchObject({ name: "TimeoutError" })
    expect(billedProviderCost(err)).toBeNull()
  })

  it("an aborted stream is not retried and does not fall back", async () => {
    // Both keys set: Opus 5.5 is KIE-first with a direct fallback. Stopped while
    // it is still thinking — no token has reached the caller, so the
    // tainted-stream rule alone would NOT stop the fallback.
    fetchMock = kieFetch([`data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 3, output_tokens: 1 } } })}\n\n`])
    vi.stubGlobal("fetch", fetchMock)
    anthropicStream.mockImplementation(() => anthropicHangingStream(["should never run"]))
    const controller = new AbortController()

    const p = llmStream(requestOf("claude-opus-5.5", 4000), () => {}, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort()

    const err = await caught(p)
    expect(err).toBeInstanceOf(LlmStreamAbortedError)
    expect(err).toMatchObject({ lane: "kie", usage: { inputTokens: 1000, outputTokens: 0 } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(anthropicStream).not.toHaveBeenCalled()
  })

  it("laneFallbackAllowed refuses a stopped stream", () => {
    const err = new LlmStreamAbortedError("stopped", { inputTokens: 1, outputTokens: 0, providerCost: 0.1, complete: false, estimated: true }, "kie")
    expect(laneFallbackAllowed(err)).toBe(false)
  })
})
