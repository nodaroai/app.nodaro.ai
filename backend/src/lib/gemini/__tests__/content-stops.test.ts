/**
 * The direct Google lane's no-answer stops. A RECITATION stop came back from
 * gemini-4-argon on 2026-10-17 as an empty, successful reply; so would every
 * other content stop and a prompt Google refused outright. Each is now a thrown
 * error — a content verdict as `LlmContentRefusalError` (billed or refunded by
 * `billedContentRefusal`, never re-asked on another lane), anything else that
 * ended the answer early as a usage-carrying `LlmStreamResponseError`.
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

// gemini-4-argon is directOnly, so every call here reaches generateContent and nothing else.
const REQ = { modelId: "gemini-4-argon", system: "", messages: [{ role: "user" as const, content: "list them" }] }
const USAGE = { promptTokenCount: 94, candidatesTokenCount: 0 }

/** Google's `FinishReason` content-policy members (@google/genai 2.13). */
const CONTENT_STOPS = ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "IMAGE_RECITATION"]
/** The rest of its non-STOP, non-MAX_TOKENS members: an unfinished answer, not a content verdict. */
const OTHER_STOPS = ["LANGUAGE", "OTHER", "MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL", "NO_IMAGE", "IMAGE_OTHER"]

const reply = (finishReason: string, text = "") => ({ text, candidates: [{ finishReason }], usageMetadata: USAGE })
const stream = (...chunks: Array<Record<string, unknown>>) =>
  (async function* () {
    for (const c of chunks) yield c
  })()

/** The client and its error classes from ONE module graph (resetModules runs per test). */
const load = async () => ({ ...(await import("../../llm-client.js")), ...(await import("../../llm-errors.js")) })

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

describe("a content stop with no text fails as a content refusal, never an empty success", () => {
  it.each(CONTENT_STOPS)("%s", async (finishReason) => {
    const { llmComplete, LlmContentRefusalError, LLM_CONTENT_REFUSAL_MESSAGE } = await load()
    generateContent.mockResolvedValue(reply(finishReason))

    const err = await llmComplete(REQ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmContentRefusalError)
    expect((err as InstanceType<typeof LlmContentRefusalError>).userMessage).toBe(LLM_CONTENT_REFUSAL_MESSAGE)
    // Google reported the prompt it read: the usage rides the throw for billing.
    expect((err as InstanceType<typeof LlmContentRefusalError>).usage).toMatchObject({ inputTokens: 94, outputTokens: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a prompt Google refused outright (promptFeedback, no candidate) is a content refusal too", async () => {
    const { llmComplete, LlmContentRefusalError } = await load()
    for (const blockReason of ["SAFETY", "OTHER", "MODEL_ARMOR"]) {
      generateContent.mockResolvedValueOnce({ text: undefined, candidates: [], promptFeedback: { blockReason }, usageMetadata: USAGE })
      await expect(llmComplete(REQ), blockReason).rejects.toBeInstanceOf(LlmContentRefusalError)
    }
  })

  it("a FRAGMENT cut by a content stop fails too — as a MAX_TOKENS fragment does", async () => {
    const { llmComplete, LlmContentRefusalError } = await load()
    generateContent.mockResolvedValue(reply("RECITATION", "1. one\n2. two\n3. thr"))
    await expect(llmComplete(REQ)).rejects.toBeInstanceOf(LlmContentRefusalError)
  })
})

describe("any other early stop fails as an unfinished answer, text or not", () => {
  it.each(OTHER_STOPS)("%s", async (finishReason) => {
    const { llmComplete, LlmStreamResponseError, LlmContentRefusalError } = await load()
    generateContent.mockResolvedValueOnce(reply(finishReason))
    const empty = await llmComplete(REQ).catch((e: unknown) => e)
    generateContent.mockResolvedValueOnce(reply(finishReason, "partial"))
    const partial = await llmComplete(REQ).catch((e: unknown) => e)

    for (const err of [empty, partial]) {
      expect(err).toBeInstanceOf(LlmStreamResponseError)
      expect(err).not.toBeInstanceOf(LlmContentRefusalError)
    }
  })
})

describe("a finished answer is untouched", () => {
  it("STOP with text resolves, as does an unstated / UNSPECIFIED stop", async () => {
    const { llmComplete } = await load()
    for (const finishReason of ["STOP", "FINISH_REASON_UNSPECIFIED", undefined]) {
      generateContent.mockResolvedValueOnce({ text: "fine", candidates: [{ finishReason }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } })
      await expect(llmComplete(REQ)).resolves.toMatchObject({ text: "fine", lane: "direct-gemini" })
    }
  })
})

describe("streaming", () => {
  it("a content stop on the final chunk throws after whatever text arrived", async () => {
    const { llmStream, LlmContentRefusalError } = await load()
    const tokens: string[] = []
    generateContentStream.mockResolvedValue(stream(
      { text: "1. one\n" },
      { text: "", candidates: [{ finishReason: "RECITATION" }], usageMetadata: USAGE },
    ))
    await expect(llmStream(REQ, (t) => tokens.push(t))).rejects.toBeInstanceOf(LlmContentRefusalError)
    expect(tokens).toEqual(["1. one\n"])
  })

  it("a stream with no text and a content stop throws rather than closing empty", async () => {
    const { llmStream, LlmContentRefusalError } = await load()
    for (const finishReason of CONTENT_STOPS) {
      generateContentStream.mockResolvedValueOnce(stream({ candidates: [{ finishReason }], usageMetadata: USAGE }))
      await expect(llmStream(REQ, () => {}), finishReason).rejects.toBeInstanceOf(LlmContentRefusalError)
    }
  })

  it("a blocked prompt on the stream throws", async () => {
    const { llmStream, LlmContentRefusalError } = await load()
    generateContentStream.mockResolvedValue(stream({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, usageMetadata: USAGE }))
    await expect(llmStream(REQ, () => {})).rejects.toBeInstanceOf(LlmContentRefusalError)
  })

  it("another early stop on the stream throws as an unfinished answer", async () => {
    const { llmStream, LlmStreamResponseError, LlmContentRefusalError } = await load()
    generateContentStream.mockResolvedValue(stream({ text: "half" }, { candidates: [{ finishReason: "OTHER" }], usageMetadata: USAGE }))
    const err = await llmStream(REQ, () => {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmStreamResponseError)
    expect(err).not.toBeInstanceOf(LlmContentRefusalError)
  })

  it("STOP with text resolves", async () => {
    const { llmStream } = await load()
    generateContentStream.mockResolvedValue(stream({ text: "fi" }, { text: "ne", candidates: [{ finishReason: "STOP" }], usageMetadata: USAGE }))
    await expect(llmStream(REQ, () => {})).resolves.toMatchObject({ text: "fine" })
  })
})

describe("billing follows the existing refusal rule", () => {
  it("a content stop Google reported usage for is a BILLED refusal; one with none is not", async () => {
    const { llmComplete, billedContentRefusal } = await load()
    generateContent.mockResolvedValueOnce(reply("RECITATION"))
    const billed = await llmComplete(REQ).catch((e: unknown) => e)
    generateContent.mockResolvedValueOnce({ text: "", candidates: [{ finishReason: "SAFETY" }] })
    const unbilled = await llmComplete(REQ).catch((e: unknown) => e)

    // billedContentRefusal decides commit (structured routes, LLM-product jobs) vs refund.
    expect(billedContentRefusal(billed)).toBeDefined()
    expect(billedContentRefusal(unbilled)).toBeUndefined()
  })
})
