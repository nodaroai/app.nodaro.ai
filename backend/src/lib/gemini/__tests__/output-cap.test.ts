/**
 * The direct Google lane is where issue #1588 happened, so it gets the end-to-
 * end replay: a Generate Text call on gemini-3.6-flash with a node cap of
 * 1,100, KIE answering its `{code: 500}` envelope, the fallback to the direct
 * lane, and Google stopping at `MAX_TOKENS` after reasoning through the budget.
 *
 * Before the fix that path returned 120 characters as a finished answer. Now
 * the call throws `LlmOutputTruncatedError` — and the cap the direct lane was
 * sent is the model's reasoning floor, not the node's 1,100.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const generateContent = vi.fn()
const generateContentStream = vi.fn()

vi.mock("../../config.js", () => ({
  config: {
    GEMINI_API_KEY: "test-gemini-key",
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    NODE_ENV: "test",
  },
}))
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream }
    files = { upload: vi.fn(), get: vi.fn() }
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}))

const REQ = { modelId: "gemini-3.6-flash", system: "s", messages: [{ role: "user" as const, content: "brief" }] }
const CUT = "# YOUTUBE RADAR\n\n## CHANNEL A\n- NEW: 2026-09-21 - \"A new video\" (https://www.youtube."

/** What Google sends back when reasoning ate the budget: a fragment, `MAX_TOKENS`, and the thoughts it billed. */
const capped = () => ({
  text: CUT,
  candidates: [{ finishReason: "MAX_TOKENS" }],
  usageMetadata: { promptTokenCount: 13_657, candidatesTokenCount: 30, thoughtsTokenCount: 1_066 },
})

/** KIE's HTTP-200 service-error envelope — the failure that sent #1588's runs to the direct lane. */
const kieDown = () => new Response(
  JSON.stringify({ code: 500, msg: "internal error, please try again later." }),
  { status: 200, headers: { "Content-Type": "application/json" } },
)

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  generateContent.mockReset()
  generateContentStream.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("#1588 replay — KIE fails, the direct lane reasons through the cap", () => {
  it("throws LlmOutputTruncatedError instead of returning the fragment, with the billed thoughts in the usage", async () => {
    const { llmComplete, LlmOutputTruncatedError } = await import("../../llm-client.js")
    fetchMock.mockResolvedValue(kieDown())
    generateContent.mockResolvedValue(capped())

    const err = await llmComplete({ ...REQ, maxTokens: 1_100 }).catch((e: unknown) => e)

    expect(fetchMock).toHaveBeenCalledTimes(1) // KIE was tried first…
    expect(generateContent).toHaveBeenCalledTimes(1) // …and the fallback served it
    expect(err).toBeInstanceOf(LlmOutputTruncatedError)
    // Thoughts are billed as output, so they are in the usage the job is charged.
    expect((err as InstanceType<typeof LlmOutputTruncatedError>).usage).toMatchObject({
      inputTokens: 13_657, outputTokens: 1_096, complete: true,
    })
  })

  it("sends the direct lane the model's reasoning floor, not the node's 1,100", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    fetchMock.mockResolvedValue(kieDown())
    generateContent.mockResolvedValue({
      text: "the whole brief",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 13_657, candidatesTokenCount: 420, thoughtsTokenCount: 1_066 },
    })

    const res = await llmComplete({ ...REQ, maxTokens: 1_100 })

    expect(res.text).toBe("the whole brief")
    const sent = generateContent.mock.calls[0]![0] as { config: { maxOutputTokens: number } }
    expect(sent.config.maxOutputTokens).toBe(8_192)
  })
})

describe("a cap stop is never re-asked on the other lane — that would bill the same cut twice", () => {
  /** KIE's OpenAI-dialect reply, stopped at the cap. */
  const kieCapped = () => new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: "# YOUTUBE RADAR" }, finish_reason: "length" }],
      usage: { prompt_tokens: 13_657, completion_tokens: 8_192 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )

  it("KIE-first: a KIE cap stop surfaces — the direct lane is never called", async () => {
    const { llmComplete, LlmOutputTruncatedError } = await import("../../llm-client.js")
    fetchMock.mockResolvedValue(kieCapped())

    await expect(llmComplete({ ...REQ, maxTokens: 1_100 })).rejects.toBeInstanceOf(LlmOutputTruncatedError)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it("pinned direct (gemini-3.1-pro, Advanced): a direct cap stop surfaces — KIE is never called", async () => {
    const { llmComplete, LlmOutputTruncatedError } = await import("../../llm-client.js")
    generateContent.mockResolvedValue(capped())

    await expect(llmComplete({ ...REQ, modelId: "gemini-3.1-pro", requireLane: "direct" })).rejects.toBeInstanceOf(LlmOutputTruncatedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("stream: a cap stop with NO visible token (all of it reasoning) still does not fall back", async () => {
    const { llmStream, LlmOutputTruncatedError } = await import("../../llm-client.js")
    fetchMock.mockResolvedValue(new Response(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }], usage: { prompt_tokens: 9, completion_tokens: 8_192 } })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ))

    await expect(llmStream({ ...REQ }, () => {})).rejects.toBeInstanceOf(LlmOutputTruncatedError)
    expect(generateContentStream).not.toHaveBeenCalled()
  })

  it("any OTHER primary failure still falls back (the #1588 path itself)", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    fetchMock.mockResolvedValue(kieDown())
    generateContent.mockResolvedValue({ text: "served by direct", candidates: [{ finishReason: "STOP" }] })

    await expect(llmComplete({ ...REQ })).resolves.toMatchObject({ text: "served by direct" })
  })
})

describe("direct Gemini lane — its own cap stop", () => {
  it("non-streaming: MAX_TOKENS throws, STOP resolves", async () => {
    const { llmComplete, LlmOutputTruncatedError } = await import("../../llm-client.js")
    generateContent.mockResolvedValueOnce(capped())
    await expect(llmComplete({ ...REQ, requireLane: "direct" })).rejects.toBeInstanceOf(LlmOutputTruncatedError)

    generateContent.mockResolvedValueOnce({ text: "ok", candidates: [{ finishReason: "STOP" }] })
    await expect(llmComplete({ ...REQ, requireLane: "direct" })).resolves.toMatchObject({ text: "ok" })
  })

  it("streaming: every piece reaches the caller, then the final chunk's MAX_TOKENS throws", async () => {
    const { llmStream, LlmOutputTruncatedError } = await import("../../llm-client.js")
    generateContentStream.mockResolvedValue((async function* () {
      yield { text: "# YOUTUBE RADAR\n" }
      yield { ...capped(), text: "- NEW: (https://www.youtube." }
    })())
    const pieces: string[] = []

    const err = await llmStream({ ...REQ, requireLane: "direct" }, (p) => pieces.push(p)).catch((e: unknown) => e)

    expect(pieces).toEqual(["# YOUTUBE RADAR\n", "- NEW: (https://www.youtube."])
    expect(err).toBeInstanceOf(LlmOutputTruncatedError)
  })
})
