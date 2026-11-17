/**
 * A document (`file_base64`) on Google's own API (decided 2026-11-17): its
 * bytes inline as an `application/pdf` part, for a model that declares that
 * shape on this lane (`fileWire.direct`, Gemini 4 Hydrogen). Every other model
 * served here throws: a document is refused, never dropped.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { getLlmModel } from "@nodaro/shared/llm-models"
import type { LlmContentBlock } from "../../llm/types.js"

const generateContent = vi.fn()
const generateContentStream = vi.fn()
const upload = vi.fn()

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
    files = { upload, get: vi.fn() }
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}))
const safeFetch = vi.fn()
vi.mock("../../safe-fetch.js", () => ({ safeFetch }))

const { callGeminiDirect, streamGeminiDirect } = await import("../client.js")
const { blockToGeminiPart } = await import("../media.js")

const PDF = "JVBERi0xLjQK"
const pdf = (extra: Partial<Extract<LlmContentBlock, { type: "file_base64" }>> = {}): Extract<LlmContentBlock, { type: "file_base64" }> =>
  ({ type: "file_base64", mediaType: "application/pdf", data: PDF, filename: "report.pdf", pages: 5, ...extra })
const PARAMS = { eff: undefined, temperature: undefined, topP: undefined, maxTokens: 32768 }
const ok = () => ({ text: "ok", usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } })

beforeEach(() => {
  generateContent.mockReset()
  generateContentStream.mockReset()
  upload.mockReset()
  safeFetch.mockReset()
})

describe("a document on the direct Google lane", () => {
  it("Gemini 4 Hydrogen: an inline application/pdf part, in place, nothing fetched or uploaded", async () => {
    generateContent.mockResolvedValue(ok())
    await callGeminiDirect(
      getLlmModel("gemini-4-hydrogen")!,
      { modelId: "gemini-4-hydrogen", system: "", messages: [{ role: "user", content: [pdf(), { type: "text", text: "summarise" }] }] },
      PARAMS,
    )
    const sent = generateContent.mock.calls[0]![0] as { model: string; contents: unknown }
    expect(sent.model).toBe("gemini-4-hydrogen")
    expect(sent.contents).toEqual([
      { role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: PDF } }, { text: "summarise" }] },
    ])
    expect(safeFetch).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it("sends the bytes, never the aggregator's stored link", async () => {
    generateContent.mockResolvedValue(ok())
    await callGeminiDirect(
      getLlmModel("gemini-4-hydrogen")!,
      { modelId: "gemini-4-hydrogen", system: "", messages: [{ role: "user", content: [pdf({ hostedUrl: "https://media.example/tmp/provider-input/llm-file-1.pdf" })] }] },
      PARAMS,
    )
    const sent = generateContent.mock.calls[0]![0] as { contents: unknown }
    expect(sent.contents).toEqual([{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: PDF } }] }])
    expect(JSON.stringify(sent.contents)).not.toContain("media.example")
  })

  it("the stream sends the same part", async () => {
    generateContentStream.mockResolvedValue((async function* () {
      yield { text: "ok", usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } }
    })())
    await streamGeminiDirect(
      getLlmModel("gemini-4-hydrogen")!,
      { modelId: "gemini-4-hydrogen", system: "", messages: [{ role: "user", content: [pdf()] }] },
      PARAMS,
      () => {},
    )
    const sent = generateContentStream.mock.calls[0]![0] as { contents: unknown }
    expect(sent.contents).toEqual([{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: PDF } }] }])
  })

  it.each(["gemini-4-carbon", "gemini-4-argon", "gemini-3.8-flash", "gemini-3.1-pro"])("%s declares no file shape: a document throws before any request", async (modelId) => {
    await expect(
      callGeminiDirect(getLlmModel(modelId)!, { modelId, system: "", messages: [{ role: "user", content: [pdf()] }] }, PARAMS),
    ).rejects.toThrow(/document \(file_base64\)/)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it("a request that would pass its inline budget uploads the document through the Files API instead of dropping it", async () => {
    upload.mockResolvedValue({ name: "files/abc", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", state: "ACTIVE" })
    const { blocksToGeminiParts, INLINE_REQUEST_MAX_BYTES } = await import("../media.js")
    expect(INLINE_REQUEST_MAX_BYTES).toBe(12 * 1024 * 1024)
    const ai = { files: { upload, get: vi.fn(async () => ({ state: "ACTIVE" })) } } as never
    // 9 bytes of PDF against 4 bytes left: over the budget.
    const budget = { left: 4 }
    const parts = await blocksToGeminiParts(ai, [pdf(), { type: "text", text: "x" }], { inlineFiles: true, inlineBudget: budget })
    expect(parts).toEqual([{ fileData: { fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "application/pdf" } }, { text: "x" }])
    expect(upload).toHaveBeenCalledOnce()
    expect((upload.mock.calls[0]![0] as { config: { mimeType: string } }).config.mimeType).toBe("application/pdf")
    expect(budget.left).toBe(4)
  })

  it("inline parts count down one budget for the whole request", async () => {
    const { blocksToGeminiParts } = await import("../media.js")
    const budget = { left: 100 }
    const parts = await blocksToGeminiParts({} as never, [{ type: "image_base64", mediaType: "image/png", data: "QUJDREVG" }, pdf()], { inlineFiles: true, inlineBudget: budget })
    expect(parts).toEqual([{ inlineData: { mimeType: "image/png", data: "QUJDREVG" } }, { inlineData: { mimeType: "application/pdf", data: PDF } }])
    // 6 bytes of image, 9 of PDF.
    expect(budget.left).toBe(85)
  })

  it("the part builder throws unless it is told the model reads documents here", async () => {
    const ai = {} as never
    await expect(blockToGeminiPart(ai, pdf())).rejects.toThrow(/document \(file_base64\)/)
    await expect(blockToGeminiPart(ai, pdf(), { inlineFiles: false })).rejects.toThrow(/document \(file_base64\)/)
    await expect(blockToGeminiPart(ai, pdf(), { inlineFiles: true })).resolves.toEqual({ inlineData: { mimeType: "application/pdf", data: PDF } })
  })
})
