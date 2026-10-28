/**
 * A token count KIE reports that no provider could mean — negative, NaN, a
 * string — counts as NOT reported: it is replaced by the size estimate the KIE
 * lanes bill from (the answer's characters ÷ 4 out, the request's in), one
 * warn line names the model and the raw value, and the call is recorded in its
 * job's spend instead of being refused by `LlmSpend.add`.
 *
 * The case that found it: gemini-3.8-flash on KIE's chat-completions wire
 * answered with `usage.completion_tokens: -3977`, and Generate Text left the
 * job to the reconcile sweep ("could not record a gemini-3.8-flash call in its
 * spend").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { calculateLlmCost } from "../pricing/llm-cost.js"
import { LlmSpend } from "../llm-spend.js"
import { addCallToSpend } from "../metered-text-route.js"
import { requestChars } from "../llm/kie-cost.js"
import { kieReportedUsage, reportedTokenCount, CHAT_COMPLETIONS_USAGE_KEYS } from "../llm/kie-usage.js"
import type { LlmRequest } from "../llm/types.js"

vi.mock("../config.js", () => ({
  // No GEMINI_API_KEY: gemini-3.8-flash is served by KIE.
  config: { KIE_API_KEY: "test-kie-key", KIE_API_BASE_URL: "https://api.kie.ai", ANTHROPIC_API_KEY: undefined, NODE_ENV: "test" },
}))
vi.mock("../anthropic.js", () => ({ getAnthropicClient: () => ({}) }))
vi.mock("../supabase.js", () => ({ supabase: {} }))

const MODEL = "gemini-3.8-flash"
const KIE_URL = "https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions"
/** 400 characters: 100 tokens at 4 characters a token. */
const ANSWER = "word ".repeat(80)
const ANSWER_TOKENS = 100

function request(extra: Partial<LlmRequest> = {}): LlmRequest {
  return { modelId: MODEL, system: "be brief", messages: [{ role: "user", content: "tell me something" }], ...extra }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
}

function streamResponse(frames: unknown[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const f of frames) controller.enqueue(encoder.encode(`data: ${typeof f === "string" ? f : JSON.stringify(f)}\n\n`))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

let fetchMock: ReturnType<typeof vi.fn>
let warn: { mock: { calls: unknown[][] } }
let error: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  warn = vi.spyOn(console, "warn").mockImplementation(() => {}) as unknown as typeof warn
  error = vi.spyOn(console, "error").mockImplementation(() => {}) as unknown as typeof error
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The one `[llm-kie-usage]` warn line, which names the model and the raw value. */
function usageWarnings(): string[] {
  return warn.mock.calls.map((c) => String(c[0])).filter((line) => line.startsWith("[llm-kie-usage]"))
}

describe("reportedTokenCount", () => {
  it("keeps a finite count ≥ 0 and refuses everything else", () => {
    expect(reportedTokenCount(0)).toBe(0)
    expect(reportedTokenCount(3977)).toBe(3977)
    for (const bad of [-3977, -0.5, Number.NaN, Number.POSITIVE_INFINITY, "12", null, undefined, {}]) {
      expect(reportedTokenCount(bad)).toBeUndefined()
    }
  })
})

describe("kieReportedUsage", () => {
  it("leaves a sound usage as it was reported, silently", () => {
    expect(kieReportedUsage(MODEL, { prompt_tokens: 12, completion_tokens: 3 }, CHAT_COMPLETIONS_USAGE_KEYS, { requestChars: 999, answerChars: 999 }))
      .toEqual({ inputTokens: 12, outputTokens: 3 })
    expect(usageWarnings()).toEqual([])
  })

  it("an ABSENT count keeps its old reading (0); a reply with no usage stays without one", () => {
    expect(kieReportedUsage(MODEL, { prompt_tokens: 12 }, CHAT_COMPLETIONS_USAGE_KEYS, { requestChars: 999, answerChars: 999 }))
      .toEqual({ inputTokens: 12, outputTokens: 0 })
    expect(kieReportedUsage(MODEL, undefined, CHAT_COMPLETIONS_USAGE_KEYS, { requestChars: 999, answerChars: 999 })).toBeUndefined()
    expect(usageWarnings()).toEqual([])
  })

  it("an unusable input count is sized from the request, like an unusable output count from the answer", () => {
    expect(kieReportedUsage(MODEL, { prompt_tokens: -5, completion_tokens: "x" }, CHAT_COMPLETIONS_USAGE_KEYS, { requestChars: 401, answerChars: 9 }))
      .toEqual({ inputTokens: 101, outputTokens: 3 })
    expect(usageWarnings()).toHaveLength(1)
    expect(usageWarnings()[0]).toMatch(/gemini-3\.8-flash/)
    expect(usageWarnings()[0]).toMatch(/prompt_tokens=-5/)
    expect(usageWarnings()[0]).toMatch(/completion_tokens="x"/)
  })
})

describe("a KIE reply with completion_tokens: -3977 (gemini-3.8-flash, chat-completions)", () => {
  const sized = { inputTokens: 120, outputTokens: ANSWER_TOKENS }

  it("non-stream: priced and recorded in the spend at the answer's size, with one warn line", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({
      choices: [{ message: { role: "assistant", content: ANSWER }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: -3977, total_tokens: -3857 },
    }))
    const req = request()
    const res = await llmComplete(req)

    expect(fetchMock.mock.calls[0]?.[0]).toBe(KIE_URL)
    expect(res.lane).toBe("kie")
    expect(res.usage).toEqual(sized)
    expect(res.providerCost).toBeCloseTo(calculateLlmCost(MODEL, sized, "kie"), 12)

    const spend = new LlmSpend()
    expect(addCallToSpend(spend, MODEL, req, { response: res })).toBe(true)
    expect(error).not.toHaveBeenCalled()
    expect(spend.attempts).toEqual([expect.objectContaining({ lane: "kie", inputTokens: 120, outputTokens: ANSWER_TOKENS })])
    expect(spend.costUsd).toBeCloseTo(calculateLlmCost(MODEL, sized, "kie"), 12)
    expect(spend.costUsd).toBeGreaterThan(0)

    expect(usageWarnings()).toHaveLength(1)
    expect(usageWarnings()[0]).toMatch(/gemini-3\.8-flash/)
    expect(usageWarnings()[0]).toMatch(/completion_tokens=-3977/)
  })

  it("stream: the same, and a usage repeated on two frames warns once", async () => {
    const { llmStream } = await import("../llm-client.js")
    const bad = { prompt_tokens: 120, completion_tokens: -3977 }
    fetchMock.mockResolvedValue(streamResponse([
      { choices: [{ delta: { content: ANSWER.slice(0, 200) } }], usage: bad },
      { choices: [{ delta: { content: ANSWER.slice(200) }, finish_reason: "stop" }], usage: bad },
      "[DONE]",
    ]))
    const req = request()
    const tokens: string[] = []
    const res = await llmStream(req, (t) => tokens.push(t))

    expect(fetchMock.mock.calls[0]?.[0]).toBe(KIE_URL)
    expect(tokens.join("")).toBe(ANSWER)
    expect(res.usage).toEqual(sized)
    expect(res.providerCost).toBeCloseTo(calculateLlmCost(MODEL, sized, "kie"), 12)

    const spend = new LlmSpend()
    expect(addCallToSpend(spend, MODEL, req, { response: res })).toBe(true)
    expect(error).not.toHaveBeenCalled()
    expect(spend.costUsd).toBeCloseTo(calculateLlmCost(MODEL, sized, "kie"), 12)

    expect(usageWarnings()).toHaveLength(1)
    expect(usageWarnings()[0]).toMatch(/gemini-3\.8-flash/)
    expect(usageWarnings()[0]).toMatch(/completion_tokens=-3977/)
  })

  it("stream: an error frame after the bad usage bills the failure at the answer's size, recordable in the spend", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(streamResponse([
      { choices: [{ delta: { content: ANSWER } }], usage: { prompt_tokens: 120, completion_tokens: -3977 } },
      { type: "error", error: { type: "server_error", message: "boom" } },
    ]))
    const req = request({ retryStreamOnError: false })
    const err = await llmStream(req, () => {}).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as { usage?: unknown }).usage).toMatchObject(sized)
    const spend = new LlmSpend()
    expect(addCallToSpend(spend, MODEL, req, { error: err })).toBe(true)
    expect(error).not.toHaveBeenCalled()
    expect(spend.costUsd).toBeCloseTo(calculateLlmCost(MODEL, sized, "kie"), 12)
    expect(usageWarnings()).toHaveLength(1)
  })

  it("an unusable input count is sized from the request, and the media guard does not judge that guess", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(jsonResponse({
      choices: [{ message: { role: "assistant", content: ANSWER }, finish_reason: "stop" }],
      usage: { prompt_tokens: -1, completion_tokens: ANSWER_TOKENS },
    }))
    // A floor far above any size estimate of this request: judged on the guess, it would throw.
    const req = request({ minPromptTokens: 1_000_000 })
    const res = await llmComplete(req)

    const estimated = { inputTokens: Math.ceil(requestChars(req) / 4), outputTokens: ANSWER_TOKENS }
    expect(res.usage).toEqual(estimated)
    const spend = new LlmSpend()
    expect(addCallToSpend(spend, MODEL, req, { response: res })).toBe(true)
    expect(spend.costUsd).toBeCloseTo(calculateLlmCost(MODEL, estimated, "kie"), 12)
    expect(usageWarnings()).toHaveLength(1)
    expect(usageWarnings()[0]).toMatch(/prompt_tokens=-1/)
  })
})

describe("the responses dialect reads its counts the same way", () => {
  it("stream: a negative output_tokens on response.completed is sized from the answer", async () => {
    const { llmStream } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(streamResponse([
      { type: "response.output_text.delta", delta: ANSWER },
      { type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: ANSWER }] }], usage: { input_tokens: 50, output_tokens: -12 } } },
      "[DONE]",
    ]))
    const req: LlmRequest = { modelId: "gpt-5.4", system: "", messages: [{ role: "user", content: "hi" }] }
    const res = await llmStream(req, () => {})

    expect(res.usage).toEqual({ inputTokens: 50, outputTokens: ANSWER_TOKENS })
    const spend = new LlmSpend()
    expect(addCallToSpend(spend, "gpt-5.4", req, { response: res })).toBe(true)
    expect(error).not.toHaveBeenCalled()
    expect(usageWarnings()).toHaveLength(1)
    expect(usageWarnings()[0]).toMatch(/gpt-5\.4/)
    expect(usageWarnings()[0]).toMatch(/output_tokens=-12/)
  })
})
