/**
 * Gemini 3.8 Flash on KIE (and 3.7 Flash, served by the same endpoint) is
 * asked for its JSON in the prompt (`kieSchemaInPrompt`: the endpoint fails
 * any request carrying `response_format`), and nothing on that wire enforces
 * the schema. Google's own lane does (`responseJsonSchema`), so a structured
 * call whose KIE answers never validate asks it ONCE before failing — as the
 * direct tool backs up Claude's prompt-JSON (llm-kie-prompt-json-direct-backup.test.ts).
 * The `@google/genai` SDK is mocked, so the real direct-lane request is built.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"

const generateContent = vi.fn()
vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", GEMINI_API_KEY: "test-gemini-key", ANTHROPIC_API_KEY: "", NODE_ENV: "test" },
  hasCredits: () => true,
}))
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream: vi.fn() }
    files = { upload: vi.fn(), get: vi.fn() }
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}))

import { config } from "../config.js"
import { PLATFORM_CAPACITY_MESSAGE, __resetPlatformExhaustionAlerts, latchDirectLaneExhausted } from "../llm-platform-exhaustion.js"
import { userFacingMessage } from "../user-facing-error.js"
import { calculateLlmCost } from "../pricing/llm-cost.js"
import { llmCompleteStructured, StructuredLlmError } from "../llm-client.js"

const schema = z.object({ capital: z.string() }).strict()
const request = (modelId = "gemini-3.8-flash", extra: Record<string, unknown> = {}) => ({
  modelId,
  system: "facts",
  messages: [{ role: "user" as const, content: "capital of France?" }],
  ...extra,
})
const kieAnswer = (content: string) => new Response(JSON.stringify({
  choices: [{ finish_reason: "stop", index: 0, message: { role: "assistant", content } }],
  usage: { prompt_tokens: 30, completion_tokens: 4 },
}), { status: 200, headers: { "Content-Type": "application/json" } })
const googleAnswer = (text: string) => ({
  text,
  candidates: [{ finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 5 },
})
type SentToGoogle = {
  model: string
  contents: Array<{ role: string; parts: unknown }>
  config: { systemInstruction?: string; responseMimeType?: string; responseJsonSchema?: unknown }
}
const sentToGoogle = (call = 0) => generateContent.mock.calls[call]![0] as SentToGoogle

describe("3.8 / 3.7 Flash's KIE prompt-JSON, backed by Google's own lane once", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    generateContent.mockReset()
    __resetPlatformExhaustionAlerts()
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each(["gemini-3.8-flash", "gemini-3.7-flash"])(
    "%s: KIE's answers never validate → the direct lane is asked once, with its enforced schema, the caller's own system prompt and messages; its answer returns, costed on the direct lane",
    async (modelId) => {
      fetchMock.mockImplementation(async () => kieAnswer('{"city":"Paris"}'))
      generateContent.mockResolvedValue(googleAnswer('{"capital":"Paris"}'))

      const res = await llmCompleteStructured(request(modelId), schema, { schemaName: "out" })

      expect(res.output).toEqual({ capital: "Paris" })
      expect(res.lane).toBe("direct-gemini")
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(generateContent).toHaveBeenCalledTimes(1)
      const sent = sentToGoogle()
      expect(sent.config.responseMimeType).toBe("application/json")
      expect(JSON.stringify(sent.config.responseJsonSchema)).toContain('"capital"')
      // The caller's system prompt, without the prompt-JSON rule; the caller's
      // one message, without the correction turns.
      expect(sent.config.systemInstruction).toBe("facts")
      expect(sent.contents).toHaveLength(1)
      expect(JSON.stringify(sent.contents)).toContain("capital of France?")
      // Every attempt is recorded on the lane that served it; the direct one at the direct rate.
      expect(res.attempts.map((a) => a.lane)).toEqual(["kie", "kie", "kie", "direct-gemini"])
      expect(res.attempts[3]!.providerCost).toBeCloseTo(calculateLlmCost(modelId, { inputTokens: 40, outputTokens: 5 }, "direct"), 12)
      expect(res.inputTokens).toBe(3 * 30 + 40)
      expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("asking the direct-gemini lane's enforced schema once"))).toBe(true)
    },
  )

  it("applies under maxRetries: 0 too — one KIE ask, then one direct ask", async () => {
    fetchMock.mockImplementation(async () => kieAnswer("Paris is the capital."))
    generateContent.mockResolvedValue(googleAnswer('{"capital":"Paris"}'))
    const res = await llmCompleteStructured(request(), schema, { schemaName: "out", maxRetries: 0 })
    expect(res).toMatchObject({ output: { capital: "Paris" }, lane: "direct-gemini" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it("the direct answer does not validate either: the call fails, naming the direct lane", async () => {
    fetchMock.mockImplementation(async () => kieAnswer('{"city":"Paris"}'))
    generateContent.mockResolvedValue(googleAnswer('{"city":"Paris"}'))
    const err = await llmCompleteStructured(request(), schema, { schemaName: "out", maxRetries: 0 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StructuredLlmError)
    expect((err as InstanceType<typeof StructuredLlmError>).lane).toBe("direct-gemini")
    expect((err as Error).message).toMatch(/after 2 attempt\(s\)/)
    // The spend of both asks is kept, each on its own lane.
    expect((err as InstanceType<typeof StructuredLlmError>).usage.attempts.map((a) => a.lane)).toEqual(["kie", "direct-gemini"])
  })

  it("Google refuses the platform's account: the call fails with the capacity sentence and never goes back to KIE", async () => {
    fetchMock.mockImplementation(async () => kieAnswer('{"city":"Paris"}'))
    generateContent.mockRejectedValue(Object.assign(new Error('{"error":{"code":429,"message":"Your prepayment credits are depleted."}}'), { status: 429 }))
    const err = await llmCompleteStructured(request(), schema, { schemaName: "out", maxRetries: 0 }).catch((e: unknown) => e)
    expect(userFacingMessage(err, "x")).toBe(PLATFORM_CAPACITY_MESSAGE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it("a call pinned to KIE gets no direct ask", async () => {
    fetchMock.mockImplementation(async () => kieAnswer('{"city":"Paris"}'))
    const err = await llmCompleteStructured(request("gemini-3.8-flash", { requireLane: "kie" }), schema, { schemaName: "out", maxRetries: 0 }).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/validation failed after 1 attempt/)
    expect((err as InstanceType<typeof StructuredLlmError>).lane).toBe("kie")
    expect(generateContent).not.toHaveBeenCalled()
  })

  it("with no Gemini key there is no direct lane to ask", async () => {
    const key = config.GEMINI_API_KEY
    ;(config as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = " "
    try {
      fetchMock.mockImplementation(async () => kieAnswer('{"city":"Paris"}'))
      const err = await llmCompleteStructured(request(), schema, { schemaName: "out", maxRetries: 0 }).catch((e: unknown) => e)
      expect((err as InstanceType<typeof StructuredLlmError>).lane).toBe("kie")
      expect(generateContent).not.toHaveBeenCalled()
    } finally {
      ;(config as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = key
    }
  })

  it("while Google's account is latched out it is not asked", async () => {
    latchDirectLaneExhausted({ provider: "google", kind: "billing", detail: "prepayment credits are depleted" })
    fetchMock.mockImplementation(async () => kieAnswer('{"city":"Paris"}'))
    const err = await llmCompleteStructured(request(), schema, { schemaName: "out", maxRetries: 0 }).catch((e: unknown) => e)
    expect((err as InstanceType<typeof StructuredLlmError>).lane).toBe("kie")
    expect(generateContent).not.toHaveBeenCalled()
  })

  it("a valid KIE answer needs no backup", async () => {
    fetchMock.mockImplementation(async () => kieAnswer('```json\n{"capital":"Paris"}\n```'))
    const res = await llmCompleteStructured(request(), schema, { schemaName: "out" })
    expect(res).toMatchObject({ output: { capital: "Paris" }, lane: "kie" })
    expect(generateContent).not.toHaveBeenCalled()
  })

  // Gemini 3.6 Flash's KIE lane still enforces the schema (`response_format`):
  // its answers are re-asked there, as before, and never escalated.
  it("a model whose KIE lane sends response_format gets no direct ask", async () => {
    fetchMock.mockImplementation(async () => kieAnswer('{"city":"Paris"}'))
    const err = await llmCompleteStructured(request("gemini-3.6-flash"), schema, { schemaName: "out", maxRetries: 0 }).catch((e: unknown) => e)
    expect((err as InstanceType<typeof StructuredLlmError>).lane).toBe("kie")
    expect(generateContent).not.toHaveBeenCalled()
  })
})
