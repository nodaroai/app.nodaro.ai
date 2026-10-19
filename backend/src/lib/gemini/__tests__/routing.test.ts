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

vi.mock("../../config.js", () => ({ config: configMock, hasCredits: () => false }))

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

describe("gemini-4-argon is directOnly: no KIE request is ever built for it", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    callGeminiDirect.mockReset()
    streamGeminiDirect.mockReset()
    // BOTH keys set: every KIE leg below would be live for any other Gemini.
    configMock.KIE_API_KEY = "test-kie-key"
    configMock.GEMINI_API_KEY = "test-gemini-key"
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("an unpinned call is served direct", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    callGeminiDirect.mockResolvedValue(directOk())

    const res = await llmComplete({ modelId: "gemini-4-argon", ...baseReq })

    expect(res.text).toBe("from-direct")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a direct failure surfaces — KIE is no fallback", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    callGeminiDirect.mockRejectedValue(new Error("google 503"))

    await expect(llmComplete({ modelId: "gemini-4-argon", ...baseReq })).rejects.toThrow("google 503")
    await expect(llmComplete({ modelId: "gemini-4-argon", ...baseReq, requireLane: "direct" })).rejects.toThrow("google 503")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a refused platform account is not retried on KIE, pinned or not", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    const { LlmPlatformExhaustedError } = await import("../../llm-errors.js")
    callGeminiDirect.mockRejectedValue(new LlmPlatformExhaustedError("google: billing", { lane: "direct", provider: "google", exhaustion: "billing" }))

    await expect(llmComplete({ modelId: "gemini-4-argon", ...baseReq, requireLane: "direct" })).rejects.toThrow()
    await expect(llmComplete({ modelId: "gemini-4-argon", ...baseReq })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a stream is served direct and never falls back to KIE", async () => {
    const { llmStream } = await import("../../llm-client.js")
    streamGeminiDirect.mockResolvedValueOnce(directOk())
    await llmStream({ modelId: "gemini-4-argon", ...baseReq }, () => {})
    streamGeminiDirect.mockRejectedValueOnce(new Error("google 503"))
    await expect(llmStream({ modelId: "gemini-4-argon", ...baseReq }, () => {})).rejects.toThrow("google 503")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a KIE pin is refused before any request", async () => {
    const { llmComplete, llmStream } = await import("../../llm-client.js")
    await expect(llmComplete({ modelId: "gemini-4-argon", ...baseReq, requireLane: "kie" })).rejects.toThrow(/cannot be pinned to KIE/)
    await expect(llmStream({ modelId: "gemini-4-argon", ...baseReq, requireLane: "kie" }, () => {})).rejects.toThrow(/cannot be pinned to KIE/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("the KIE entry points themselves refuse it — the backstop for any future path", async () => {
    const { callKie, streamKie } = await import("../../llm/kie-lane.js")
    const { getLlmModel } = await import("@nodaro/shared/llm-models")
    const model = getLlmModel("gemini-4-argon")!
    const req = { modelId: model.id, ...baseReq }
    expect(() => callKie(model, req)).toThrow(/directOnly/)
    expect(() => streamKie(model, req, () => {})).toThrow(/directOnly/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("with no Gemini key it fails as provider-unavailable, never reaching KIE, and names only the key that helps", async () => {
    const { llmComplete, llmStream } = await import("../../llm-client.js")
    const { isLlmProviderUnavailable } = await import("../../llm/provider-unavailable.js")
    configMock.GEMINI_API_KEY = ""

    for (const call of [
      () => llmComplete({ modelId: "gemini-4-argon", ...baseReq }),
      () => llmStream({ modelId: "gemini-4-argon", ...baseReq }, () => {}),
    ]) {
      const err = await call().then(() => undefined, (e: unknown) => e)
      expect(isLlmProviderUnavailable(err)).toBe(true)
      expect((err as Error).message).toContain("GEMINI_API_KEY")
      expect((err as Error).message).not.toContain("KIE_API_KEY")
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(callGeminiDirect).not.toHaveBeenCalled()
  })

  it("clamps efforts to the direct ladder: `none` is Auto (Google 400s MINIMAL), `max` lands on high", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    callGeminiDirect.mockResolvedValue(directOk())

    for (const reasoningEffort of ["none", "medium", "max"] as const) {
      await llmComplete({ modelId: "gemini-4-argon", ...baseReq, reasoningEffort, maxTokens: 2048 })
    }

    // It reasons by default, so a small cap is floored to the default 32768.
    expect(callGeminiDirect.mock.calls[0]![2]).toMatchObject({ eff: undefined, maxTokens: 32_768 })
    expect(callGeminiDirect.mock.calls[1]![2]).toMatchObject({ eff: "medium" })
    expect(callGeminiDirect.mock.calls[2]![2]).toMatchObject({ eff: "high" })
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

describe("gemini-3.7-flash (retired) still runs: KIE lane on 3.8's endpoint, direct lane real 3.7", () => {
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

  it("sends the KIE call to 3.8's endpoint — the model KIE answers it with", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    fetchMock.mockResolvedValue(kieOk())

    const res = await llmComplete({ modelId: "gemini-3.7-flash", ...baseReq })

    expect(res.text).toBe("from-kie")
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/gemini-3-8-flash-openai\/v1\/chat\/completions$/)
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
    expect(body.model).toBe("gemini-3-8-flash-openai")
    // The registry cap is 3.7's own, unchanged.
    expect(body.max_tokens).toBe(8192)
    expect(callGeminiDirect).not.toHaveBeenCalled()
  })

  it("serves the direct pin (Advanced mode's lane) with real gemini-3.7-flash", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    callGeminiDirect.mockResolvedValue(directOk())

    await llmComplete({ modelId: "gemini-3.7-flash", ...baseReq, requireLane: "direct" })

    expect(fetchMock).not.toHaveBeenCalled()
    const model = callGeminiDirect.mock.calls[0]![0] as { id: string; directGeminiModel: string }
    expect(model.id).toBe("gemini-3.7-flash")
    expect(model.directGeminiModel).toBe("gemini-3.7-flash")
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
