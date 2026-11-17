/**
 * The lanes a call with documents takes on Gemini 4 Hydrogen (decided
 * 2026-11-17): the aggregator first, like a text call, with Google's own API
 * as its fallback — and a file reaches each lane in that lane's own shape,
 * whichever serves it:
 *  - the aggregator's chat-completions body carries an `image_url` part (a
 *    data URL, or the stored link of a larger file);
 *  - when it fails, Google is sent the BYTES inline, even for a file that
 *    carried a stored link;
 *  - a call built for Google's API, whose larger file has no stored link, is
 *    never handed to the aggregator;
 *  - on a stream the not-read floor discards an answer given without the file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { LlmContentBlock, LlmRequest } from "../llm/types.js"

const configMock = { KIE_API_KEY: "test-kie-key", KIE_API_BASE_URL: "https://api.kie.ai", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "test-gemini-key", NODE_ENV: "test" }
vi.mock("../config.js", () => ({ config: configMock, hasCredits: () => false, llmMeteredPricing: () => false }))

const generateContent = vi.fn()
const generateContentStream = vi.fn()
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream }
    files = { upload: vi.fn(), get: vi.fn() }
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}))

const PDF = "JVBERi0xLjQK"
const pdf = (extra: Partial<Extract<LlmContentBlock, { type: "file_base64" }>> = {}): Extract<LlmContentBlock, { type: "file_base64" }> =>
  ({ type: "file_base64", mediaType: "application/pdf", data: PDF, filename: "report.pdf", pages: 5, ...extra })
const HOSTED = "https://media.example/tmp/provider-input/job-1/llm-file-1.pdf"
const req = (blocks: LlmContentBlock[], extra: Partial<LlmRequest> = {}): LlmRequest =>
  ({ modelId: "gemini-4-hydrogen", system: "", messages: [{ role: "user", content: [...blocks, { type: "text", text: "summarise" }] }], ...extra })

const kieOk = (promptTokens = 13_357) => new Response(
  JSON.stringify({ choices: [{ message: { role: "assistant", content: "from-kie" } }], usage: { prompt_tokens: promptTokens, completion_tokens: 20 } }),
  { status: 200, headers: { "Content-Type": "application/json" } },
)
const kieSse = (promptTokens: number) => new Response(
  `data: ${JSON.stringify({ choices: [{ delta: { content: "an answer" } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: 20 } })}\n\n` +
    "data: [DONE]\n\n",
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
)
const googleOk = () => ({ text: "from-google", usageMetadata: { promptTokenCount: 13_332, candidatesTokenCount: 20 } })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetModules()
  generateContent.mockReset()
  generateContentStream.mockReset()
  configMock.KIE_API_KEY = "test-kie-key"
  configMock.GEMINI_API_KEY = "test-gemini-key"
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const kieBody = () => JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as { messages: Array<{ content: unknown }> }

describe("a file-only Hydrogen call is served by the aggregator first", () => {
  it("sends the file as an image_url data URL to the chat-completions endpoint; Google is not asked", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieOk())
    const res = await llmComplete(req([pdf()], { minPromptTokens: 2251 }))
    expect(res.text).toBe("from-kie")
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.kie.ai/gemini-4-hydrogen-openai/v1/chat/completions")
    expect(kieBody().messages[0]!.content).toEqual([
      { type: "image_url", image_url: { url: `data:application/pdf;base64,${PDF}` } },
      { type: "text", text: "summarise" },
    ])
    expect(generateContent).not.toHaveBeenCalled()
  })

  it("a larger file goes by its stored link", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieOk())
    await llmComplete(req([pdf({ hostedUrl: HOSTED })]))
    expect(kieBody().messages[0]!.content).toEqual([{ type: "image_url", image_url: { url: HOSTED } }, { type: "text", text: "summarise" }])
  })

  it("when the aggregator fails, Google is sent the bytes inline — for a file with a stored link too", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockRejectedValue(new Error("kie down"))
    generateContent.mockResolvedValue(googleOk())
    const res = await llmComplete(req([pdf(), pdf({ hostedUrl: HOSTED, filename: "big.pdf" })]))
    expect(res.text).toBe("from-google")
    const sent = generateContent.mock.calls[0]![0] as { contents: unknown }
    expect(sent.contents).toEqual([
      { role: "user", parts: [
        { inlineData: { mimeType: "application/pdf", data: PDF } },
        { inlineData: { mimeType: "application/pdf", data: PDF } },
        { text: "summarise" },
      ] },
    ])
    expect(JSON.stringify(sent.contents)).not.toContain("media.example")
  })

  it("an answer the aggregator gave without reading the file is discarded: Google's own API answers in its place from the bytes", async () => {
    const { llmComplete } = await import("../llm-client.js")
    // 40 prompt tokens: the text alone. The floor for 5 pages is 2,251.
    fetchMock.mockResolvedValue(kieOk(40))
    generateContent.mockResolvedValue(googleOk())
    const res = await llmComplete(req([pdf()], { minPromptTokens: 2251 }))
    expect(res.text).toBe("from-google")
    expect((generateContent.mock.calls[0]![0] as { contents: unknown }).contents).toEqual([
      { role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: PDF } }, { text: "summarise" }] },
    ])
  })

  it.each([
    ["an install with no Gemini key", () => { configMock.GEMINI_API_KEY = "" }, {}],
    ["a run kept to the cheap lanes", () => {}, { cheapLanesOnly: true }],
  ])("…and on %s the call fails as media_not_ingested, never returning the unread answer", async (_name, arrange, extra) => {
    arrange()
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieOk(40))
    await expect(llmComplete(req([pdf()], { minPromptTokens: 2251, ...extra }))).rejects.toThrow(/^media_not_ingested:/)
    expect(generateContent).not.toHaveBeenCalled()
  })
})

describe("the not-read floor on the stream (the editor's route)", () => {
  it("discards an answer whose final usage is under the floor: media_not_ingested, and no second answer after tokens were sent", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieSse(40))
    const tokens: string[] = []
    const err = await llmStream(req([pdf()], { minPromptTokens: 2251 }), (t) => tokens.push(t)).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/^media_not_ingested:/)
    expect(tokens.join("")).toBe("an answer")
    expect(generateContentStream).not.toHaveBeenCalled()
    // The stream route maps it to its `media_not_ingested` answer.
    const { isMediaNotRead } = await import("../llm-media-lane.js")
    expect(isMediaNotRead(err)).toBe(true)
  })

  it("passes a stream that read its file, and one with no floor", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(kieSse(13_357))
    await expect(llmStream(req([pdf()], { minPromptTokens: 2251 }), () => {})).resolves.toMatchObject({ text: "an answer" })
    fetchMock.mockResolvedValue(kieSse(40))
    await expect(llmStream(req([pdf()]), () => {})).resolves.toMatchObject({ text: "an answer" })
    // A stream that reports no usage at all is never failed by the floor.
    fetchMock.mockResolvedValue(new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "an answer" } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ))
    await expect(llmStream(req([pdf()], { minPromptTokens: 2251 }), () => {})).resolves.toMatchObject({ text: "an answer" })
  })
})

describe("a call built for Google's API is handed to the aggregator only when it can carry its files", () => {
  it("kieCanCarry: a file within the inline limit or with a stored link travels; a larger one with no link does not", async () => {
    const { kieCanCarry } = await import("../llm/exhaustion-fallback.js")
    const { KIE_INLINE_DATA_URL_MAX_CHARS } = await import("../kie-inline-image.js")
    const big = "A".repeat(KIE_INLINE_DATA_URL_MAX_CHARS)
    expect(kieCanCarry(req([pdf()]))).toBe(true)
    expect(kieCanCarry(req([pdf({ data: big, hostedUrl: HOSTED })]))).toBe(true)
    expect(kieCanCarry(req([pdf({ data: big })]))).toBe(false)
    // Terra's documents ride a part of their own, at any size.
    expect(kieCanCarry({ ...req([pdf({ data: big })]), modelId: "gpt-6.1-terra" })).toBe(true)
    // A model that declares no file shape never has one carried.
    expect(kieCanCarry({ ...req([pdf()]), modelId: "gemini-4-carbon" })).toBe(false)
    // A request that names only a feature (no model id) is judged without a file shape: text travels.
    expect(kieCanCarry({ system: "", messages: [{ role: "user", content: "hi" }] } as unknown as LlmRequest)).toBe(true)
    // Text and images travel as before; video and audio do not.
    expect(kieCanCarry(req([{ type: "image", url: "https://x/y.png" }]))).toBe(true)
    expect(kieCanCarry(req([{ type: "video", url: "https://x/y.mp4" }, pdf()]))).toBe(false)
  })

  it("exhaustionKieFallback gives no aggregator leg for a larger file with no link, and none for Advanced mode", async () => {
    const { exhaustionKieFallback } = await import("../llm/exhaustion-fallback.js")
    const { getLlmModel } = await import("@nodaro/shared/llm-models")
    const { KIE_INLINE_DATA_URL_MAX_CHARS } = await import("../kie-inline-image.js")
    const model = getLlmModel("gemini-4-hydrogen")!
    const big = "A".repeat(KIE_INLINE_DATA_URL_MAX_CHARS)
    expect(exhaustionKieFallback(model, req([pdf({ data: big })], { requireLane: "direct" }))).toBeUndefined()
    expect(exhaustionKieFallback(model, req([pdf()], { requireLane: "direct", advancedMode: true }))).toBeUndefined()
    expect(exhaustionKieFallback(model, req([pdf()], { requireLane: "direct" }))).toBeTypeOf("function")
    expect(exhaustionKieFallback(model, req([pdf({ data: big, hostedUrl: HOSTED })], { requireLane: "direct" }))).toBeTypeOf("function")
  })
})
