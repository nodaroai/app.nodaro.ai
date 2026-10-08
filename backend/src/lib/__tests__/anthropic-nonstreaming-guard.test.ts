import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

/**
 * Guards the direct-Anthropic lane against the SDK's non-streaming refusal.
 *
 * `messages.create` throws BEFORE any network call — "Streaming is required for
 * operations that may take longer than 10 minutes" — when the request is
 * non-streaming, the client declares no timeout, and
 * `60min * max_tokens / 128_000 > 10min`, i.e. `max_tokens > 21_333`.
 *
 * `deriveParams` floors `max_tokens` at 32_768 whenever reasoning shares the
 * output budget, which for a `thinkingDefaultOn` model (claude-opus-5) is EVERY
 * call. So without a client-level timeout, 100% of non-streamed Opus 5 calls
 * failed on the direct lane — and with KIE's Claude proxy 500ing on every
 * non-stream request at the same time, Opus 5 had no working lane at all.
 *
 * These tests use the REAL SDK (anthropic.js is deliberately NOT mocked) so the
 * guard actually runs; only `fetch` is stubbed.
 */

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "test-ant-key", NODE_ENV: "test" },
}))

/** The max_tokens ceiling above which the SDK refuses a non-streaming request. */
const SDK_NONSTREAMING_MAX_TOKENS = (60 * 10 * 1000 * 128_000) / (60 * 60 * 1000) // 21_333.33

function anthropicMessage(text: string): Response {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}

describe("direct-Anthropic non-streaming guard", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    // getAnthropicClient memoizes the client, and the SDK binds `fetch` at
    // construction — so without a module reset every test after the first would
    // exercise the FIRST test's stub and see zero calls on its own.
    vi.resetModules()
    // Fresh Response per call — a Response body can only be read once, and the
    // SDK retries on a failed read, which would mask what these tests assert.
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(anthropicMessage("OK")))
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("the shared client declares a timeout — the exact field the SDK's guard checks", async () => {
    const { getAnthropicClient } = await import("../anthropic.js")
    const client = getAnthropicClient() as unknown as { _options: { timeout?: number } }
    // The SDK skips the refusal only when `_options.timeout != null`.
    expect(client._options.timeout).toBeTypeOf("number")
    expect(client._options.timeout).toBeGreaterThan(0)
  })

  it("the effort/thinking max_tokens floor really does exceed the SDK ceiling", () => {
    // Documents WHY the timeout above is load-bearing rather than cosmetic: if
    // the floor ever drops below the ceiling this test says so explicitly.
    expect(32_768).toBeGreaterThan(SDK_NONSTREAMING_MAX_TOKENS)
  })

  it("claude-opus-5 completes non-streaming despite the 32_768 floor", async () => {
    const { llmComplete } = await import("../llm-client.js")
    // thinkingDefaultOn floors max_tokens to 32_768 even though 64 was asked for.
    const res = await llmComplete({
      modelId: "claude-opus-5",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 64,
      // Pinned direct (Advanced mode): with no effort and no pin, a Claude call
      // is served by KIE since 2026-10-08, and this guard is about the SDK lane.
      requireLane: "direct",
    })
    expect(res.text).toBe("OK")
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.max_tokens).toBe(32_768)
    expect(body.stream).toBeFalsy()
  })

  it("a Claude call at max effort completes non-streaming too", async () => {
    const { llmComplete } = await import("../llm-client.js")
    const res = await llmComplete({
      modelId: "claude-sonnet-5",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "max",
    })
    expect(res.text).toBe("OK")
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.max_tokens).toBe(32_768)
  })
})
