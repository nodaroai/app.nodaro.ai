/**
 * Kimi K3.1 Pro, GPT-6.1 Terra and Gemini 4 Carbon on their KIE lanes, fed the
 * replies KIE really sent in the 2026-11-12 probe (kie-probe-2026-11-12-fixtures.ts):
 *
 * - the wire each model is sent (family path, slug, effort, no sampling param);
 * - GPT-6.1 Terra's input count is read from its reply and trusted, so the
 *   tokens KIE adds of its own are charged as reported — unlike luna / sol /
 *   6.1 sol on the same endpoint, which report 0;
 * - Kimi's stream: its `response.reasoning_text.delta` frames never reach the
 *   answer;
 * - Gemini 4 Carbon has no trusted structured mode: its schema is sent as a
 *   hint on every attempt, and its off-enum answer is still caught by
 *   validation and re-asked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"
import { LLM_MODELS } from "@nodaro/shared/llm-models"
import {
  CARBON_OFF_ENUM_SCHEMA_REPLY,
  KIMI_STREAM,
  TERRA_AUTO_NON_STREAM,
  TERRA_EFFORT_HIGH_NON_STREAM,
  TERRA_STREAM,
} from "./kie-probe-2026-11-12-fixtures.js"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", KIE_API_BASE_URL: "https://api.kie.ai", NODE_ENV: "test" },
  hasCredits: () => false,
}))

const { llmComplete, llmStream, llmCompleteStructured } = await import("../llm-client.js")
const { kieInputUntrusted, requestChars } = await import("../llm/kie-cost.js")
const { LlmSpend } = await import("../llm-spend.js")

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
const responsesOk = () => rawResponse(JSON.stringify({
  output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
  usage: { input_tokens: 5, output_tokens: 1 },
}))
const chatOk = (content: string, usage = { prompt_tokens: 10, completion_tokens: 5 }) => rawResponse(JSON.stringify({
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

describe("the wire each 2026-11 model is sent", () => {
  it.each([
    ["kimi-k3.1-pro", "https://api.kie.ai/openai/v1/responses", "kimi-k3-1-pro"],
    ["gpt-6.1-terra", "https://api.kie.ai/codex/v1/responses", "gpt-6-1-terra"],
  ])("%s posts to its family path with its KIE slug, non-stream, and no sampling param", async (modelId, url, slug) => {
    fetchMock.mockResolvedValue(responsesOk())
    await llmComplete({ modelId, system: "be terse", messages: [{ role: "user", content: "hi" }], temperature: 0.2 })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url)
    const body = bodyOf()
    expect(body.model).toBe(slug)
    expect(body.stream).toBe(false)
    expect(body.temperature).toBeUndefined()
  })

  it("gemini-4-carbon posts to its own chat-completions slug, KIE first", async () => {
    fetchMock.mockResolvedValue(chatOk("ok"))
    await llmComplete({ modelId: "gemini-4-carbon", system: "", messages: [{ role: "user", content: "hi" }] })
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.kie.ai/gemini-4-carbon-openai/v1/chat/completions")
    const body = bodyOf()
    expect(body.model).toBe("gemini-4-carbon-openai")
    // Reasons by default: floored at 32768 even with no effort sent.
    expect(body.max_tokens).toBe(32768)
    expect(body.reasoning_effort).toBeUndefined()
  })

  it("gemini-4-carbon sends `max` as its top level, `high`, and `none` as nothing", async () => {
    fetchMock.mockImplementation(async () => chatOk("ok"))
    await llmComplete({ modelId: "gemini-4-carbon", system: "", messages: [{ role: "user", content: "a" }], reasoningEffort: "max" })
    await llmComplete({ modelId: "gemini-4-carbon", system: "", messages: [{ role: "user", content: "b" }], reasoningEffort: "none" })
    expect(bodyOf(0).reasoning_effort).toBe("high")
    expect(bodyOf(1).reasoning_effort).toBeUndefined()
  })

  it("gpt-6.1-terra: a `none` request sends no reasoning param (Auto); `high` sends high", async () => {
    fetchMock.mockImplementation(async () => responsesOk())
    await llmComplete({ modelId: "gpt-6.1-terra", system: "", messages: [{ role: "user", content: "a" }], reasoningEffort: "none" })
    await llmComplete({ modelId: "gpt-6.1-terra", system: "", messages: [{ role: "user", content: "b" }], reasoningEffort: "high" })
    expect(bodyOf(0)).not.toHaveProperty("reasoning")
    expect(bodyOf(1).reasoning).toEqual({ effort: "high" })
    // Not a reasoning-by-default model: an Auto call is sent no output cap.
    expect(bodyOf(0)).not.toHaveProperty("max_output_tokens")
  })

  it("kimi-k3.1-pro: `medium` (not one of its levels) clamps down to `low`; `max` is sent with the floor", async () => {
    fetchMock.mockImplementation(async () => responsesOk())
    await llmComplete({ modelId: "kimi-k3.1-pro", system: "", messages: [{ role: "user", content: "a" }], reasoningEffort: "medium" })
    await llmComplete({ modelId: "kimi-k3.1-pro", system: "", messages: [{ role: "user", content: "b" }], reasoningEffort: "max" })
    expect(bodyOf(0).reasoning).toEqual({ effort: "low" })
    expect(bodyOf(1).reasoning).toEqual({ effort: "max" })
    expect(bodyOf(1).max_output_tokens).toBe(32768)
  })

  // Decided 2026-11-12: with no effort sent KIE runs Kimi at its highest
  // level, so a request below `low` sends `low`; Auto still sends nothing.
  it.each(["kimi-k3", "kimi-k3.1-pro"])("%s: a `none` request sends `low`; Auto sends no reasoning param", async (modelId) => {
    fetchMock.mockImplementation(async () => responsesOk())
    await llmComplete({ modelId, system: "", messages: [{ role: "user", content: "a" }], reasoningEffort: "none" })
    await llmComplete({ modelId, system: "", messages: [{ role: "user", content: "b" }] })
    expect(bodyOf(0).reasoning).toEqual({ effort: "low" })
    expect(bodyOf(1)).not.toHaveProperty("reasoning")
  })

  it("structured calls: Terra and Kimi send their schema as text.format; Carbon sends it as a response_format hint", async () => {
    const schema = { type: "object", properties: { mood: { type: "string", enum: ["happy", "sad"] } }, required: ["mood"] }
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("chat/completions") ? chatOk('{"mood":"happy"}') : rawResponse(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: '{"mood":"happy"}' }] }],
        usage: { input_tokens: 5, output_tokens: 1 },
      })))
    for (const modelId of ["gpt-6.1-terra", "kimi-k3.1-pro", "gemini-4-carbon"]) {
      await llmComplete({ modelId, system: "", messages: [{ role: "user", content: "x" }], jsonSchema: { name: "r", schema } })
    }
    expect(bodyOf(0).text?.format?.type).toBe("json_schema")
    expect(bodyOf(1).text?.format?.type).toBe("json_schema")
    expect(bodyOf(2).response_format).toMatchObject({ type: "json_schema", json_schema: { name: "r", strict: false } })
    expect(JSON.stringify(bodyOf(2).response_format)).toContain('"enum":["happy","sad"]')
  })

  it("a model that sends no schema (gpt-5.2) is unchanged: no response_format, and its size leaves the schema out", async () => {
    fetchMock.mockImplementation(async () => chatOk('{"mood":"happy"}'))
    const schema = { type: "object", properties: { mood: { type: "string" } } }
    await llmComplete({ modelId: "gpt-5.2", system: "", messages: [{ role: "user", content: "x" }], jsonSchema: { name: "r", schema } })
    expect(bodyOf(0)).not.toHaveProperty("response_format")
    const req = (modelId: string) => ({ modelId, system: "", messages: [{ role: "user" as const, content: "x" }], jsonSchema: { name: "r", schema } })
    // Carbon sends its schema, so a request's size counts it; gpt-5.2 sends none.
    expect(requestChars(req("gemini-4-carbon"))).toBe(1 + JSON.stringify(schema).length)
    expect(requestChars(req("gpt-5.2"))).toBe(1)
    expect(requestChars(req("gpt-6.1-terra"))).toBe(1 + JSON.stringify(schema).length)
  })
})

describe("GPT-6.1 Terra's reported input is read and trusted (the tokens KIE adds are charged as reported)", () => {
  it("is not an untrusted-input model, unlike the GPT-6 models that report 0 on the same endpoint", () => {
    expect(kieInputUntrusted("gpt-6.1-terra")).toBe(false)
    for (const id of ["gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"]) expect(kieInputUntrusted(id), id).toBe(true)
    for (const id of ["kimi-k3.1-pro", "gemini-4-carbon", "gpt-5.6-terra"]) expect(kieInputUntrusted(id), id).toBe(false)
  })

  // The trust check names the GPT-6 models one by one now, so a new GPT-6 id
  // would be trusted by default. This makes adding one a decision: it fails
  // until the id is classified here — measured to report 0 input (and listed
  // in kie-cost.ts's KIE_INPUT_UNREPORTED) or measured to report real counts.
  it("every GPT-6 model in the registry is classified, so a new one cannot slip in as trusted", () => {
    const REPORTS_REAL_INPUT = new Set(["gpt-6.1-terra"])
    const REPORTS_NO_INPUT = new Set(["gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"])
    const gpt6 = LLM_MODELS.filter((m) => m.id.startsWith("gpt-6")).map((m) => m.id).sort()
    expect(gpt6).toEqual([...REPORTS_REAL_INPUT, ...REPORTS_NO_INPUT].sort())
    for (const id of gpt6) expect(kieInputUntrusted(id), id).toBe(REPORTS_NO_INPUT.has(id))
  })

  it("an effort call's real reply: 25,477 input tokens read from top-level usage, KIE's stated charge kept", async () => {
    fetchMock.mockResolvedValue(rawResponse(TERRA_EFFORT_HIGH_NON_STREAM))
    const req = { modelId: "gpt-6.1-terra", system: "", messages: [{ role: "user" as const, content: "A bat and a ball cost $1.10…" }], reasoningEffort: "high" as const }
    const res = await llmComplete(req)
    expect(res.text).toBe("$0.05")
    expect(res.usage).toEqual({ inputTokens: 25_477, outputTokens: 8 })
    // credits_consumed 1.53 KIE credits × $0.005.
    expect(res.creditsUsd).toBeCloseTo(0.00765, 10)
    const spend = new LlmSpend()
    spend.add("gpt-6.1-terra", req, { response: res })
    expect(spend.record.source).toBe("kie-stated")
    expect(spend.costUsd).toBeCloseTo(0.00765, 10)
  })

  it("an Auto call's real reply: 4,400 input tokens", async () => {
    fetchMock.mockResolvedValue(rawResponse(TERRA_AUTO_NON_STREAM))
    const res = await llmComplete({ modelId: "gpt-6.1-terra", system: "", messages: [{ role: "user", content: "Name the three primary colours…" }] })
    expect(res.text).toBe("Red, green, blue")
    expect(res.usage).toEqual({ inputTokens: 4_400, outputTokens: 9 })
  })

  it("its real stream (a `relay_ready` frame first): the answer, 4,400 input tokens and KIE's stated charge", async () => {
    fetchMock.mockResolvedValue(sseResponse(TERRA_STREAM))
    const tokens: string[] = []
    const req = { modelId: "gpt-6.1-terra", system: "", messages: [{ role: "user" as const, content: "Name the three primary colours…" }] }
    const res = await llmStream(req, (t) => tokens.push(t))
    expect(res.text).toBe("Red, green, blue")
    expect(tokens.join("")).toBe("Red, green, blue")
    expect(res.usage).toEqual({ inputTokens: 4_400, outputTokens: 9 })
    expect(res.creditsUsd).toBeCloseTo(0.03 * 0.005, 12)
    // Were KIE's stated charge missing, the settle would cost the REPORTED
    // tokens at Terra's rate — never the request's few characters.
    const spend = new LlmSpend()
    spend.add("gpt-6.1-terra", req, { response: { ...res, creditsUsd: undefined, providerCost: undefined } })
    expect(spend.costUsd).toBeCloseTo((4_400 * 0.3 + 9 * 1.5) / 1_000_000, 12)
  })
})

describe("Kimi K3.1 Pro's real stream", () => {
  it("returns the answer only: its reasoning_text deltas never reach the text or the caller", async () => {
    fetchMock.mockResolvedValue(sseResponse(KIMI_STREAM))
    const tokens: string[] = []
    const res = await llmStream(
      { modelId: "kimi-k3.1-pro", system: "", messages: [{ role: "user", content: "Name the three primary colours…" }] },
      (t) => tokens.push(t),
    )
    expect(KIMI_STREAM).toContain("response.reasoning_text.delta")
    expect(res.text).toBe("Red, Green, Blue")
    expect(tokens.join("")).toBe("Red, Green, Blue")
    expect(res.usage).toEqual({ inputTokens: 102, outputTokens: 89 })
    expect(res.creditsUsd).toBeCloseTo(0.09 * 0.005, 12)
  })
})

describe("Gemini 4 Carbon's off-enum structured answer is caught and re-asked", () => {
  const Mood = z.object({ mood: z.enum(["happy", "sad"]), reason: z.string() })

  it("the probe's real reply fails validation; the correction turn's valid answer is returned, both calls billed", async () => {
    fetchMock
      .mockResolvedValueOnce(rawResponse(CARBON_OFF_ENUM_SCHEMA_REPLY))
      .mockResolvedValueOnce(chatOk('{"mood":"happy","reason":"Warm light."}', { prompt_tokens: 300, completion_tokens: 12 }))
    const out = await llmCompleteStructured(
      { modelId: "gemini-4-carbon", system: "Answer as JSON.", messages: [{ role: "user", content: "How does a sunny morning feel?" }] },
      Mood,
    )
    expect(out.output).toEqual({ mood: "happy", reason: "Warm light." })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The schema rides EVERY attempt as a hint, the re-ask included.
    for (const call of [0, 1]) {
      expect(fetchMock.mock.calls[call]?.[0]).toBe("https://api.kie.ai/gemini-4-carbon-openai/v1/chat/completions")
      expect(JSON.stringify(bodyOf(call).response_format)).toContain('"enum":["happy","sad"]')
    }
    // The second ask carries the bad answer and a correction turn.
    const second = bodyOf(1).messages as Array<{ role: string; content: unknown }>
    expect(JSON.stringify(second)).toContain("cheerful and energized")
    expect(second.at(-1)?.role).toBe("user")
    // Both attempts are billed, each on the KIE lane: the first at KIE's stated charge.
    expect(out.attempts).toHaveLength(2)
    expect(out.attempts.map((a) => a.lane)).toEqual(["kie", "kie"])
    expect(out.attempts[0]).toMatchObject({ inputTokens: 223, outputTokens: 43, creditsUsd: 0.07 * 0.005 })
    expect(out.inputTokens).toBe(223 + 300)
    expect(out.outputTokens).toBe(43 + 12)
  })
})
