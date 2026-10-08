/**
 * Lane routing for Gemini models.
 *
 * The split is DATA, declared per model in the shared registry
 * (`directGeminiModel` / `preferDirect`) — these tests pin the behaviour that
 * data produces, so a future model can be flipped between lanes by editing one
 * field and trusting this suite.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"

const configMock = {
  KIE_API_KEY: "test-kie-key",
  ANTHROPIC_API_KEY: "",
  GEMINI_API_KEY: "test-gemini-key",
  NODE_ENV: "test",
}

vi.mock("../../config.js", () => ({ config: configMock }))

const callGeminiDirect = vi.fn()
const streamGeminiDirect = vi.fn()
vi.mock("../client.js", () => ({ callGeminiDirect, streamGeminiDirect }))

function kieOk(text = "from-kie") {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: text } }],
      usage: { prompt_tokens: 3, completion_tokens: 1 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}

/** KIE's streaming lane speaks SSE, not the JSON envelope `kieOk` returns. */
function kieSseOk(text = "from-kie") {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

function directOk(text = "from-direct") {
  return { text, usage: { inputTokens: 3, outputTokens: 1 }, model: "gemini-3.1-pro", providerCost: 0.1 }
}

const baseReq = { system: "", messages: [{ role: "user" as const, content: "hi" }] }

describe("gemini-3.1-pro is KIE-first since 2026-10-08 (direct is Advanced mode)", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    callGeminiDirect.mockReset()
    streamGeminiDirect.mockReset()
    configMock.KIE_API_KEY = "test-kie-key"
    configMock.GEMINI_API_KEY = "test-gemini-key"
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("goes to KIE first and never touches direct on success", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    fetchMock.mockResolvedValue(kieOk())

    const res = await llmComplete({ modelId: "gemini-3.1-pro", ...baseReq })

    expect(res.text).toBe("from-kie")
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(callGeminiDirect).not.toHaveBeenCalled()
  })

  it("falls back to direct when KIE throws (no extra charge — billed as KIE)", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error("kie 503"))
    callGeminiDirect.mockResolvedValue(directOk())

    const res = await llmComplete({ modelId: "gemini-3.1-pro", ...baseReq })

    expect(res.text).toBe("from-direct")
    expect(callGeminiDirect).toHaveBeenCalledOnce()
  })

  it("Advanced (a direct pin) goes direct and never falls back", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    callGeminiDirect.mockRejectedValue(new Error("google 503"))

    await expect(llmComplete({ modelId: "gemini-3.1-pro", ...baseReq, requireLane: "direct" })).rejects.toThrow("google 503")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("passes the derived params through to the direct lane", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    callGeminiDirect.mockResolvedValue(directOk())

    // Above the model's reasoning floor, so the caller's cap is what arrives.
    await llmComplete({ modelId: "gemini-3.1-pro", ...baseReq, temperature: 0.4, maxTokens: 20_000, requireLane: "direct" })

    const params = callGeminiDirect.mock.calls[0]![2]
    expect(params).toMatchObject({ temperature: 0.4, maxTokens: 20_000 })
  })

  it("floors a small cap to the model's reasoning floor — the model reasons by default (#1588)", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    callGeminiDirect.mockResolvedValue(directOk())

    await llmComplete({ modelId: "gemini-3.1-pro", ...baseReq, maxTokens: 1234 })

    expect(callGeminiDirect.mock.calls[0]![2]).toMatchObject({ maxTokens: 16_384 })
  })
})

describe("KIE-first Gemini models keep their existing routing", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    callGeminiDirect.mockReset()
    configMock.KIE_API_KEY = "test-kie-key"
    configMock.GEMINI_API_KEY = "test-gemini-key"
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("serves gemini-3.6-flash from KIE even though a direct lane exists", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    fetchMock.mockResolvedValue(kieOk())

    const res = await llmComplete({ modelId: "gemini-3.6-flash", ...baseReq })

    // This is the cost guard: 3.6-flash backs 5 feature defaults, and Google
    // lists it at ~3.3x KIE. It must not drift onto the direct lane silently.
    expect(res.text).toBe("from-kie")
    expect(callGeminiDirect).not.toHaveBeenCalled()
  })

  it("uses direct as the reliability backstop when KIE fails", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    fetchMock.mockRejectedValue(new Error("kie down"))
    callGeminiDirect.mockResolvedValue(directOk("recovered"))

    const res = await llmComplete({ modelId: "gemini-3.6-flash", ...baseReq })

    expect(res.text).toBe("recovered")
    expect(callGeminiDirect).toHaveBeenCalledOnce()
  })
})

describe("without GEMINI_API_KEY the direct lane does not exist", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    callGeminiDirect.mockReset()
    configMock.KIE_API_KEY = "test-kie-key"
    configMock.GEMINI_API_KEY = ""
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("routes a preferDirect model to KIE instead", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    fetchMock.mockResolvedValue(kieOk())

    const res = await llmComplete({ modelId: "gemini-3.1-pro", ...baseReq })

    expect(res.text).toBe("from-kie")
    expect(callGeminiDirect).not.toHaveBeenCalled()
  })
})

describe("requireLane pin (video-analysis is direct-ONLY)", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    callGeminiDirect.mockReset()
    streamGeminiDirect.mockReset()
    configMock.KIE_API_KEY = "test-kie-key"
    configMock.GEMINI_API_KEY = "test-gemini-key"
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("forces a KIE-first model onto the direct lane", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    callGeminiDirect.mockResolvedValue(directOk())

    // gemini-3.6-flash is KIE-first by registry default; the pin overrides it.
    const res = await llmComplete({ modelId: "gemini-3.6-flash", ...baseReq, requireLane: "direct" })

    expect(res.text).toBe("from-direct")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does NOT fall back to KIE when the pinned direct lane fails", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    callGeminiDirect.mockRejectedValue(new Error("google 503"))
    fetchMock.mockResolvedValue(kieOk())

    // The whole point: a silent KIE fallback would return differently-grounded
    // analysis rather than an error.
    await expect(
      llmComplete({ modelId: "gemini-3.6-flash", ...baseReq, requireLane: "direct" }),
    ).rejects.toThrow("google 503")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws an actionable error when GEMINI_API_KEY is missing", async () => {
    configMock.GEMINI_API_KEY = ""
    const { llmComplete } = await import("../../llm-client.js")
    fetchMock.mockResolvedValue(kieOk())

    await expect(
      llmComplete({ modelId: "gemini-3.6-flash", ...baseReq, requireLane: "direct" }),
    ).rejects.toThrow(/GEMINI_API_KEY is not set/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws when the pinned model has no direct lane at all", async () => {
    const { llmComplete } = await import("../../llm-client.js")

    await expect(
      llmComplete({ modelId: "gpt-5.2", ...baseReq, requireLane: "direct" }),
    ).rejects.toThrow(/declares no directGeminiModel/)
  })

  it("can pin the other way, to KIE, with no direct fallback", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    fetchMock.mockRejectedValue(new Error("kie down"))
    callGeminiDirect.mockResolvedValue(directOk())

    await expect(
      llmComplete({ modelId: "gemini-3.1-pro", ...baseReq, requireLane: "kie" }),
    ).rejects.toThrow("kie down")
    expect(callGeminiDirect).not.toHaveBeenCalled()
  })

  it("pins the streaming path too", async () => {
    const { llmStream } = await import("../../llm-client.js")
    streamGeminiDirect.mockRejectedValue(new Error("google down"))
    fetchMock.mockResolvedValue(kieSseOk())

    await expect(
      llmStream({ modelId: "gemini-3.6-flash", ...baseReq, requireLane: "direct" }, () => {}),
    ).rejects.toThrow("google down")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("streaming", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    streamGeminiDirect.mockReset()
    configMock.KIE_API_KEY = "test-kie-key"
    configMock.GEMINI_API_KEY = "test-gemini-key"
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("streams a preferDirect model through the direct lane", async () => {
    const { llmStream } = await import("../../llm-client.js")
    streamGeminiDirect.mockImplementation(async (_m, _r, _p, onToken) => {
      onToken("he")
      onToken("llo")
      return { text: "hello", usage: { inputTokens: 1, outputTokens: 2 }, model: "gemini-3.1-pro" }
    })

    const chunks: string[] = []
    const res = await llmStream({ modelId: "gemini-3.1-pro", ...baseReq }, (c) => chunks.push(c))

    expect(chunks).toEqual(["he", "llo"])
    expect(res.text).toBe("hello")
  })

  it("does NOT fail over once KIE tokens have already reached the caller", async () => {
    const { llmStream } = await import("../../llm-client.js")
    let pulls = 0
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      pull(c) {
        pulls += 1
        if (pulls === 1) return c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
        throw new Error("died mid-stream")
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } }))

    // Restarting on direct here would replay "partial" to the client — the
    // tainted stream must surface its error instead.
    await expect(
      llmStream({ modelId: "gemini-3.1-pro", ...baseReq }, () => {}),
    ).rejects.toThrow("died mid-stream")
    expect(streamGeminiDirect).not.toHaveBeenCalled()
  })

  it("DOES fail over to direct when KIE dies before emitting anything", async () => {
    const { llmStream } = await import("../../llm-client.js")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error("failed to connect"))
    streamGeminiDirect.mockImplementation(async (_m, _r, _p, onToken) => {
      onToken("from-direct")
      return { text: "from-direct", usage: { inputTokens: 1, outputTokens: 1 }, model: "gemini-3.1-pro" }
    })

    const chunks: string[] = []
    const res = await llmStream({ modelId: "gemini-3.1-pro", ...baseReq }, (c) => chunks.push(c))
    expect(res.text).toBe("from-direct")
    expect(chunks).toEqual(["from-direct"])
  })
})
