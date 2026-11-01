/**
 * The KIE lane's own default timeout (`KIE_LLM_TIMEOUT_MS`, 300 s): a request
 * with no `timeoutMs` waits that long on KIE, the direct lanes keep 120 s, and
 * an explicit `timeoutMs` still wins everywhere. On the collapsed Claude wire
 * every transport retry shares ONE deadline, so a retry never buys a second
 * full budget.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { effectiveTimeout, kieEffectiveTimeout, KIE_LLM_TIMEOUT_MS } from "../llm/params.js"
import { LLM_ROUTE_REQUEST_TIMEOUT_MS } from "../llm-route-timeout.js"

vi.mock("../config.js", () => ({
  config: {
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    GEMINI_API_KEY: undefined,
    NODE_ENV: "test",
  },
}))

vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({}),
}))

const hi = { system: "s", messages: [{ role: "user" as const, content: "hi" }] }

function geminiAnswer(): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

describe("the lanes' default timeouts", () => {
  it("KIE waits 5 minutes by default; the direct lanes keep 120 s", () => {
    expect(KIE_LLM_TIMEOUT_MS).toBe(300_000)
    expect(kieEffectiveTimeout({ modelId: "gemini-3.8-flash", ...hi })).toBe(300_000)
    expect(effectiveTimeout({ modelId: "gemini-3.8-flash", ...hi })).toBe(120_000)
  })

  it("an explicit timeoutMs wins on both", () => {
    expect(kieEffectiveTimeout({ modelId: "gemini-3.8-flash", ...hi, timeoutMs: 45_000 })).toBe(45_000)
    expect(kieEffectiveTimeout({ modelId: "gemini-3.8-flash", ...hi, timeoutMs: 600_000 })).toBe(600_000)
    expect(effectiveTimeout({ modelId: "gemini-3.8-flash", ...hi, timeoutMs: 45_000 })).toBe(45_000)
  })

  // A full KIE attempt, then the direct fallback at its default, still answers
  // before the sync LLM routes' socket closes (llm-route-timeout.ts).
  it("a full KIE attempt plus a default direct fallback fits the sync routes' socket timeout", () => {
    expect(kieEffectiveTimeout({ modelId: "gemini-3.8-flash", ...hi }) + effectiveTimeout({ modelId: "gemini-3.8-flash", ...hi })).toBeLessThan(LLM_ROUTE_REQUEST_TIMEOUT_MS)
  })
})

describe("the KIE lane arms its own default", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let timeoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    timeoutSpy = vi.spyOn(AbortSignal, "timeout")
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("a gemini-3.8-flash call with no timeoutMs is given 300 s on KIE", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(geminiAnswer())
    await llmComplete({ modelId: "gemini-3.8-flash", ...hi })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions")
    expect(timeoutSpy).toHaveBeenCalledWith(300_000)
    expect(timeoutSpy).not.toHaveBeenCalledWith(120_000)
  })

  it("an explicit timeoutMs still wins on KIE", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(geminiAnswer())
    await llmComplete({ modelId: "gemini-3.8-flash", ...hi, timeoutMs: 45_000 })
    expect(timeoutSpy).toHaveBeenCalledWith(45_000)
    expect(timeoutSpy).not.toHaveBeenCalledWith(300_000)
  })

  // The collapsed Claude wire retries a failure that cost nothing. Every attempt
  // rides the SAME deadline, armed once — not a fresh 300 s per attempt.
  it("the collapsed Claude wire arms one deadline for every transport attempt", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockRejectedValue(new Error("socket hang up"))
    vi.spyOn(console, "warn").mockImplementation(() => {})

    vi.useFakeTimers()
    try {
      const call = llmComplete({ modelId: "claude-sonnet-4.6", ...hi })
      const settled = expect(call).rejects.toThrow(/socket hang up/)
      await vi.advanceTimersByTimeAsync(60_000)
      await settled
    } finally {
      vi.useRealTimers()
    }

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    const signals = new Set(fetchMock.mock.calls.map((c) => (c[1] as RequestInit).signal))
    expect(signals.size).toBe(1)
    expect(timeoutSpy.mock.calls.filter(([ms]: unknown[]) => ms === 300_000)).toHaveLength(1)
  })

  // What the shared deadline changes: an attempt started late in the budget is
  // cut when the CALL's budget ends, not after a full timeout of its own.
  it("a retry started late is cut at the call's deadline, not a full timeout later", async () => {
    timeoutSpy.mockRestore()
    const { llmComplete } = await import("../llm-client.js")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockImplementation((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
        }),
      )

    const started = Date.now()
    // 400 ms pause after the first failure, so the second attempt starts at
    // ~400 ms; with its own timeout it would end at ~1 400 ms.
    await expect(llmComplete({ modelId: "claude-sonnet-4.6", ...hi, timeoutMs: 1_000 })).rejects.toThrow()
    const elapsed = Date.now() - started

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(elapsed).toBeLessThan(1_300)
  })
})
