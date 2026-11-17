/**
 * The `thinkingLevel` each effort reaches Google's API as.
 *
 * Google takes `XHIGH` on Gemini 4 Hydrogen (probed 2026-11-16), so a model
 * that declares `directXhighThinking` sends `xhigh` (and `max`) as XHIGH.
 * Every other model keeps the mapping it had: `none` → MINIMAL, then LOW /
 * MEDIUM / HIGH, with `xhigh` and `max` collapsed onto HIGH.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { LLM_REASONING_EFFORTS, getLlmModel, type LlmReasoningEffort } from "@nodaro/shared/llm-models"

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

const { callGeminiDirect } = await import("../client.js")

const REQ = { system: "", messages: [{ role: "user" as const, content: "think" }] }
const ok = () => ({ text: "ok", usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, thoughtsTokenCount: 5 } })

/** The thinkingLevel sent for each effort on `modelId`, called straight on the direct client. */
async function levelsFor(modelId: string): Promise<Record<LlmReasoningEffort, unknown>> {
  const model = getLlmModel(modelId)!
  const out = {} as Record<LlmReasoningEffort, unknown>
  for (const eff of LLM_REASONING_EFFORTS) {
    generateContent.mockReset()
    generateContent.mockResolvedValue(ok())
    await callGeminiDirect(model, { modelId, ...REQ }, { eff, temperature: undefined, topP: undefined, maxTokens: 32768 })
    const sent = generateContent.mock.calls[0]![0] as { config: { thinkingConfig?: { thinkingLevel?: unknown } } }
    out[eff] = sent.config.thinkingConfig?.thinkingLevel
  }
  return out
}

const UNCHANGED = { none: "MINIMAL", low: "LOW", medium: "MEDIUM", high: "HIGH", xhigh: "HIGH", max: "HIGH" }

beforeEach(() => {
  generateContent.mockReset()
  generateContentStream.mockReset()
})

describe("thinkingLevel on the direct Google lane", () => {
  it("Gemini 4 Hydrogen sends xhigh (and max) as XHIGH, the rest as before", async () => {
    expect(await levelsFor("gemini-4-hydrogen")).toEqual({ ...UNCHANGED, xhigh: "XHIGH", max: "XHIGH" })
  })

  it.each(["gemini-4-carbon", "gemini-4-argon", "gemini-3.1-pro", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash"])(
    "%s keeps its mapping byte-identical: xhigh and max collapse onto HIGH",
    async (modelId) => {
      expect(await levelsFor(modelId)).toEqual(UNCHANGED)
    },
  )

  it("no effort sends no thinkingConfig at all", async () => {
    generateContent.mockResolvedValue(ok())
    await callGeminiDirect(getLlmModel("gemini-4-hydrogen")!, { modelId: "gemini-4-hydrogen", ...REQ }, {
      eff: undefined, temperature: undefined, topP: undefined, maxTokens: 32768,
    })
    const sent = generateContent.mock.calls[0]![0] as { config: Record<string, unknown> }
    expect(sent.config).not.toHaveProperty("thinkingConfig")
  })

  it("an Advanced-mode Hydrogen call at xhigh reaches Google as XHIGH, its schema as responseJsonSchema", async () => {
    const { llmComplete } = await import("../../llm-client.js")
    generateContent.mockResolvedValue({ ...ok(), text: '{"mood":"happy"}' })
    const schema = { type: "object", properties: { mood: { type: "string", enum: ["happy", "sad"] } }, required: ["mood"] }
    await llmComplete({
      modelId: "gemini-4-hydrogen", ...REQ, requireLane: "direct", reasoningEffort: "xhigh",
      jsonSchema: { name: "r", schema },
    })
    const sent = generateContent.mock.calls[0]![0] as {
      model: string
      config: { thinkingConfig?: { thinkingLevel?: unknown }; responseJsonSchema?: unknown; maxOutputTokens?: number }
    }
    expect(sent.model).toBe("gemini-4-hydrogen")
    expect(sent.config.thinkingConfig?.thinkingLevel).toBe("XHIGH")
    expect(sent.config.maxOutputTokens).toBe(32768)
    expect(JSON.stringify(sent.config.responseJsonSchema)).toContain('"enum":["happy","sad"]')
  })
})
