/**
 * Gemini 4 Hydrogen on its KIE lane (probed 2026-11-16):
 *
 * - the wire: its own chat-completions slug, the 32768 floor on every call
 *   (it reasons with no effort sent), and the effort clamp — `none` sends
 *   nothing (Auto), `max` sends `xhigh`, `xhigh` is sent as it is;
 * - its usage: unlike Gemini 4 Carbon, KIE's `completion_tokens` INCLUDES the
 *   reasoning (`completion_tokens_details.reasoning_tokens` is a part of it,
 *   total = prompt + completion), so the reported output count is billed once,
 *   as it stands — nothing adds the reasoning on top, nothing subtracts it;
 * - structured output: no trusted mode, so its schema rides every attempt as
 *   a `response_format` hint and an off-enum answer is re-asked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", KIE_API_BASE_URL: "https://api.kie.ai", NODE_ENV: "test" },
  hasCredits: () => false,
}))

const { llmComplete, llmStream, llmCompleteStructured } = await import("../llm-client.js")
const { LlmSpend } = await import("../llm-spend.js")
const { calculateLlmCost } = await import("../pricing/llm-cost.js")

const URL = "https://api.kie.ai/gemini-4-hydrogen-openai/v1/chat/completions"

/** The usage shape the probe recorded: reasoning INSIDE completion_tokens. */
const REASONING_INSIDE_USAGE = {
  prompt_tokens: 100,
  completion_tokens: 900,
  completion_tokens_details: { reasoning_tokens: 800 },
  total_tokens: 1000,
}

function rawResponse(raw: string): Response {
  return new Response(raw, { status: 200, headers: { "Content-Type": "application/json" } })
}
function sseResponse(raw: string): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(raw))
      c.close()
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } })
}
const chatOk = (content: string, usage: Record<string, unknown> = { prompt_tokens: 10, completion_tokens: 5 }) => rawResponse(JSON.stringify({
  choices: [{ finish_reason: "stop", index: 0, message: { role: "assistant", content } }],
  usage,
}))

let fetchMock: ReturnType<typeof vi.fn>
const bodyOf = (call = 0) => JSON.parse((fetchMock.mock.calls[call]?.[1] as { body: string }).body) as Record<string, any>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("the wire Gemini 4 Hydrogen is sent", () => {
  it("posts to its own chat-completions slug, KIE first, floored at 32768 with no effort sent", async () => {
    fetchMock.mockResolvedValue(chatOk("ok"))
    await llmComplete({ modelId: "gemini-4-hydrogen", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(URL)
    const body = bodyOf()
    expect(body.model).toBe("gemini-4-hydrogen-openai")
    expect(body.max_tokens).toBe(32768)
    expect(body.reasoning_effort).toBeUndefined()
  })

  it("clamps the effort onto its ladder: `none` → nothing (Auto), `max` → xhigh, xhigh and medium as they are", async () => {
    fetchMock.mockImplementation(async () => chatOk("ok"))
    for (const reasoningEffort of ["none", "max", "xhigh", "medium"] as const) {
      await llmComplete({ modelId: "gemini-4-hydrogen", system: "", messages: [{ role: "user", content: "a" }], reasoningEffort })
    }
    expect(bodyOf(0).reasoning_effort).toBeUndefined()
    expect(bodyOf(1).reasoning_effort).toBe("xhigh")
    expect(bodyOf(2).reasoning_effort).toBe("xhigh")
    expect(bodyOf(3).reasoning_effort).toBe("medium")
  })
})

describe("Gemini 4 Hydrogen's reasoning is billed once, inside completion_tokens", () => {
  it("a reply of prompt 100 / completion 900 (reasoning 800) / total 1000 bills 900 output tokens", async () => {
    fetchMock.mockResolvedValue(chatOk("ok", REASONING_INSIDE_USAGE))
    const req = { modelId: "gemini-4-hydrogen", system: "", messages: [{ role: "user" as const, content: "think" }] }
    const res = await llmComplete(req)
    // Not 900 + 800 (reasoning added on top), not 100 (reasoning subtracted).
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 900 })
    // With no stated charge, the spend costs exactly those counts at its KIE rate.
    const spend = new LlmSpend()
    spend.add("gemini-4-hydrogen", req, { response: { ...res, creditsUsd: undefined, providerCost: undefined } })
    expect(spend.costUsd).toBeCloseTo((100 * 0.6 + 900 * 3.0) / 1_000_000, 12)
    expect(spend.costUsd).toBeCloseTo(calculateLlmCost("gemini-4-hydrogen", { inputTokens: 100, outputTokens: 900 }, "kie"), 12)
  })

  it("a stream's final usage chunk is read the same way: 900 output tokens", async () => {
    const stream =
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "Red, " } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "green, blue" } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [], usage: REASONING_INSIDE_USAGE })}\n\n` +
      "data: [DONE]\n\n"
    fetchMock.mockResolvedValue(sseResponse(stream))
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: "gemini-4-hydrogen", system: "", messages: [{ role: "user", content: "colours" }] },
      (t) => tokens.push(t),
    )
    expect(res.text).toBe("Red, green, blue")
    expect(tokens.join("")).toBe("Red, green, blue")
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 900 })
  })
})

describe("Gemini 4 Hydrogen's structured output goes through parse, validate and re-ask", () => {
  const Mood = z.object({ mood: z.enum(["happy", "sad"]) })

  it("sends its schema as a response_format hint on every attempt; an off-enum answer is re-asked", async () => {
    fetchMock
      .mockResolvedValueOnce(chatOk('{"mood":"bright and hopeful"}', { prompt_tokens: 200, completion_tokens: 40 }))
      .mockResolvedValueOnce(chatOk('{"mood":"happy"}', { prompt_tokens: 260, completion_tokens: 30 }))
    const out = await llmCompleteStructured(
      { modelId: "gemini-4-hydrogen", system: "Answer as JSON.", messages: [{ role: "user", content: "How does a sunny morning feel?" }] },
      Mood,
    )
    expect(out.output).toEqual({ mood: "happy" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of [0, 1]) {
      expect(fetchMock.mock.calls[call]?.[0]).toBe(URL)
      expect(bodyOf(call).response_format).toMatchObject({ type: "json_schema" })
      expect(JSON.stringify(bodyOf(call).response_format)).toContain('"enum":["happy","sad"]')
    }
    expect(JSON.stringify(bodyOf(1).messages)).toContain("bright and hopeful")
    expect(out.attempts.map((a) => a.lane)).toEqual(["kie", "kie"])
    expect(out.outputTokens).toBe(40 + 30)
  })
})
