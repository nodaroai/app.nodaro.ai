/**
 * Every response says which lane actually served it — the primary or, after a
 * failure, the fallback — so a job can record where its answer came from.
 * Without it a chronic primary-lane failure is invisible in the job rows:
 * every call quietly succeeds on the other lane.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"
import sharp from "sharp"
import { randomBytes } from "node:crypto"

const generateContent = vi.fn()
const anthropicCreate = vi.fn()

vi.mock("../config.js", () => ({
  config: {
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    GEMINI_API_KEY: "test-gemini-key",
    NODE_ENV: "test",
  },
}))
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream: vi.fn() }
    files = { upload: vi.fn(), get: vi.fn() }
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}))
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate, stream: vi.fn() } }),
}))

const kieChatOk = (content = "from kie") =>
  new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )

/** The envelope KIE answered image URLs with on 2026-10-09. */
const kieNetworkError = () =>
  new Response(JSON.stringify({ code: 500, msg: "Network error, please try again later." }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

const kieMessagesStreamOk = () =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"from kie"}}\n'))
        controller.enqueue(encoder.encode('data: {"type":"message_delta","usage":{"input_tokens":3,"output_tokens":1}}\n'))
        controller.close()
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )

const GEMINI_REQ = { modelId: "gemini-3.8-flash", system: "", messages: [{ role: "user" as const, content: "hi" }] }
// An effort makes the direct Anthropic lane the primary for Claude.
const CLAUDE_REQ = { modelId: "claude-opus-5", system: "", messages: [{ role: "user" as const, content: "hi" }], reasoningEffort: "high" as const }

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  generateContent.mockReset()
  anthropicCreate.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("llmComplete reports the lane that served it", () => {
  it("kie, when KIE answers", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieChatOk())

    const res = await llmComplete(GEMINI_REQ)

    expect(res.text).toBe("from kie")
    expect(res.lane).toBe("kie")
    expect(generateContent).not.toHaveBeenCalled()
  })

  it("direct-gemini, when KIE fails and the direct Gemini lane serves the fallback", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieNetworkError())
    generateContent.mockResolvedValue({ text: "from google", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } })

    const res = await llmComplete(GEMINI_REQ)

    expect(res.text).toBe("from google")
    expect(res.lane).toBe("direct-gemini")
  })

  it("direct-gemini gets the ORIGINAL image blocks, not KIE's resized copy, when it serves the fallback", async () => {
    const { llmComplete } = await import("../llm-client.js")
    // About 2 MB: KIE's leg would send a resized JPEG; the direct lane must get the PNG as given.
    const png = await sharp(randomBytes(820 * 820 * 3), { raw: { width: 820, height: 820, channels: 3 } }).png().toBuffer()
    fetchMock.mockResolvedValue(kieNetworkError())
    generateContent.mockResolvedValue({ text: "from google", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } })

    const res = await llmComplete({
      ...GEMINI_REQ,
      messages: [{ role: "user", content: [{ type: "image_base64", mediaType: "image/png", data: png.toString("base64") }, { type: "text", text: "describe" }] }],
    })

    expect(res.lane).toBe("direct-gemini")
    // The KIE leg really did go inline and resized.
    const kieBody = (fetchMock.mock.calls[0]?.[1] as { body: string }).body
    expect(kieBody).toContain("data:image/jpeg;base64,")
    // The direct lane got the original bytes.
    const sent = JSON.stringify(generateContent.mock.calls[0]?.[0])
    expect(sent).toContain(png.toString("base64"))
    expect(sent).toContain("image/png")
  })

  it("direct-anthropic, when Anthropic's own API answers", async () => {
    const { llmComplete } = await import("../llm-client.js")
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "from anthropic" }], usage: { input_tokens: 3, output_tokens: 1 }, stop_reason: "end_turn" })

    const res = await llmComplete(CLAUDE_REQ)

    expect(res.text).toBe("from anthropic")
    expect(res.lane).toBe("direct-anthropic")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("kie, when Anthropic's API fails and KIE serves the fallback", async () => {
    const { llmComplete } = await import("../llm-client.js")
    anthropicCreate.mockRejectedValue(new Error("anthropic 529 overloaded"))
    fetchMock.mockResolvedValue(kieMessagesStreamOk())

    const res = await llmComplete(CLAUDE_REQ)

    expect(res.text).toBe("from kie")
    expect(res.lane).toBe("kie")
  })
})

describe("llmCompleteStructured carries the lane of the answer it returns", () => {
  const schema = z.object({ ok: z.boolean() })

  it("kie on a primary success", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieChatOk(JSON.stringify({ ok: true })))

    const out = await llmCompleteStructured(GEMINI_REQ, schema)

    expect(out.output).toEqual({ ok: true })
    expect(out.lane).toBe("kie")
  })

  it("direct-gemini after a KIE failure", async () => {
    const { llmCompleteStructured } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieNetworkError())
    generateContent.mockResolvedValue({ text: JSON.stringify({ ok: true }), candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } })

    const out = await llmCompleteStructured(GEMINI_REQ, schema)

    expect(out.output).toEqual({ ok: true })
    expect(out.lane).toBe("direct-gemini")
  })
})
