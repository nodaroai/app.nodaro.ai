/**
 * Gemini 4 Neon, GPT-6.2 Sol and GPT-6.2 Astra on their KIE lanes (probed
 * 2026-11-22), fed replies shaped as KIE sent them in that probe:
 *
 * - Neon: its own chat-completions slug, the 32768 floor on every call (it
 *   reasons with no effort sent), the effort clamp (`none` → nothing, `max` →
 *   xhigh), no temperature on the wire, KIE only (no direct lane to fall back
 *   to), reasoning billed once inside `completion_tokens`, and its schema as a
 *   `response_format` hint with an off-enum answer re-asked;
 * - GPT-6.2 Sol / Astra: the codex responses family path with their KIE slug,
 *   non-stream, no sampling param, the full low…max ladder, a trusted
 *   `text.format` schema, a PDF as an inline `input_file`, and their real
 *   top-level input count read and trusted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"
import { TERRA_STREAM } from "./kie-probe-2026-11-12-fixtures.js"
import type { LlmRequest } from "../llm/types.js"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", KIE_API_BASE_URL: "https://api.kie.ai", NODE_ENV: "test" },
  hasCredits: () => false,
}))

const { llmComplete, llmStream, llmCompleteStructured } = await import("../llm-client.js")
const { KIE_INPUT_IMPLAUSIBLE_FACTOR, documentInputFloorTokens, kieInputUntrusted, kieInputCheckedWhenUnstated, kieInputTokens, requestChars } = await import("../llm/kie-cost.js")
const { LlmStreamResponseError } = await import("../llm-errors.js")
const { LlmSpend } = await import("../llm-spend.js")
const { calculateLlmCost, llmLaneAddedInputTokens } = await import("../pricing/llm-cost.js")
const { llmFileSizes } = await import("../llm/file-sizes.js")

const NEON_URL = "https://api.kie.ai/gemini-4-neon-openai/v1/chat/completions"
const CODEX_URL = "https://api.kie.ai/codex/v1/responses"

function sseResponse(raw: string): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(raw))
      c.close()
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } })
}
function rawResponse(raw: string): Response {
  return new Response(raw, { status: 200, headers: { "Content-Type": "application/json" } })
}
const chatOk = (content: string, usage: Record<string, unknown> = { prompt_tokens: 10, completion_tokens: 5 }) => rawResponse(JSON.stringify({
  choices: [{ finish_reason: "stop", index: 0, message: { role: "assistant", content } }],
  usage,
}))
/** The usage a Neon puzzle call reported at Auto (2026-11-22): reasoning inside completion_tokens. */
const NEON_AUTO_USAGE = { prompt_tokens: 80, completion_tokens: 173, completion_tokens_details: { reasoning_tokens: 165 }, total_tokens: 253 }
/** A GPT-6.2 Sol reply as KIE sent it at Auto (2026-11-22): real top-level input, reasoning inside output. */
const SOL_AUTO_REPLY = JSON.stringify({
  model: "gpt-6.2-sol",
  status: "completed",
  reasoning: { effort: "medium" },
  temperature: 1,
  output: [{ type: "message", content: [{ type: "output_text", text: "2.25" }] }],
  usage: {
    input_tokens: 53,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 27,
    output_tokens_details: { reasoning_tokens: 18 },
    total_tokens: 80,
  },
  credits_consumed: 0.02,
})

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

describe("the wire Gemini 4 Neon is sent", () => {
  it("posts to its own chat-completions slug, floored at 32768 with no effort sent, and never a temperature", async () => {
    fetchMock.mockResolvedValue(chatOk("ok"))
    await llmComplete({ modelId: "gemini-4-neon", system: "", messages: [{ role: "user", content: "hi" }], temperature: 0.2 })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(NEON_URL)
    const body = bodyOf()
    expect(body.model).toBe("gemini-4-neon-openai")
    expect(body.max_tokens).toBe(32768)
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.temperature).toBeUndefined()
  })

  it("clamps the effort onto its ladder: `none` → nothing (Auto), `max` → xhigh, xhigh and low as they are", async () => {
    fetchMock.mockImplementation(async () => chatOk("ok"))
    for (const reasoningEffort of ["none", "max", "xhigh", "low"] as const) {
      await llmComplete({ modelId: "gemini-4-neon", system: "", messages: [{ role: "user", content: "a" }], reasoningEffort })
    }
    expect(bodyOf(0).reasoning_effort).toBeUndefined()
    expect(bodyOf(1).reasoning_effort).toBe("xhigh")
    expect(bodyOf(2).reasoning_effort).toBe("xhigh")
    expect(bodyOf(3).reasoning_effort).toBe("low")
  })

  it("a reply of prompt 80 / completion 173 (reasoning 165) bills 173 output tokens, at its KIE rate", async () => {
    fetchMock.mockResolvedValue(chatOk("2.25", NEON_AUTO_USAGE))
    const req = { modelId: "gemini-4-neon", system: "", messages: [{ role: "user" as const, content: "puzzle" }] }
    const res = await llmComplete(req)
    expect(res.usage).toEqual({ inputTokens: 80, outputTokens: 173 })
    const spend = new LlmSpend()
    spend.add("gemini-4-neon", req, { response: { ...res, creditsUsd: undefined, providerCost: undefined } })
    expect(spend.costUsd).toBeCloseTo((80 * 1.2 + 173 * 6.0) / 1_000_000, 12)
    expect(spend.costUsd).toBeCloseTo(calculateLlmCost("gemini-4-neon", { inputTokens: 80, outputTokens: 173 }, "kie"), 12)
  })

  it("sends a video, an audio clip and an image the way KIE reads them: `image_url` parts", async () => {
    fetchMock.mockResolvedValueOnce(chatOk("a clip and a voice", { prompt_tokens: 700, completion_tokens: 5 }))
    await llmComplete({
      modelId: "gemini-4-neon",
      system: "",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "describe both" },
          { type: "video", url: "https://media.example/cut.mp4" },
          { type: "audio", url: "https://media.example/voice.mp3" },
        ],
      }],
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(NEON_URL)
    expect(bodyOf().messages[0].content).toEqual([
      { type: "text", text: "describe both" },
      { type: "image_url", image_url: { url: "https://media.example/cut.mp4" } },
      { type: "image_url", image_url: { url: "https://media.example/voice.mp3" } },
    ])
  })

  it("has no direct lane: a failed KIE call is not retried on Google's API", async () => {
    fetchMock.mockResolvedValue(rawResponse(JSON.stringify({ code: 500, msg: "Server exception" })))
    await expect(llmComplete({ modelId: "gemini-4-neon", system: "", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow()
    for (const call of fetchMock.mock.calls) expect(String(call[0])).toBe(NEON_URL)
  })

  it("counts a PDF page at Hydrogen's measured figures (same lane, same shape)", () => {
    expect(llmFileSizes("gemini-4-neon")).toEqual(llmFileSizes("gemini-4-hydrogen"))
  })
})

describe("Gemini 4 Neon's structured output goes through parse, validate and re-ask", () => {
  const Mood = z.object({ mood: z.enum(["happy", "sad"]) })

  it("sends its schema as a response_format hint on every attempt; the probe's off-enum answer is re-asked", async () => {
    fetchMock
      .mockResolvedValueOnce(chatOk('{"mood":"delighted and thrilled"}', { prompt_tokens: 246, completion_tokens: 545 }))
      .mockResolvedValueOnce(chatOk('{"mood":"happy"}', { prompt_tokens: 300, completion_tokens: 200 }))
    const out = await llmCompleteStructured(
      { modelId: "gemini-4-neon", system: "Answer as JSON.", messages: [{ role: "user", content: "I won a free ice cream. How do I feel?" }] },
      Mood,
    )
    expect(out.output).toEqual({ mood: "happy" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of [0, 1]) {
      expect(fetchMock.mock.calls[call]?.[0]).toBe(NEON_URL)
      expect(bodyOf(call).response_format).toMatchObject({ type: "json_schema" })
    }
    expect(out.attempts.map((a) => a.lane)).toEqual(["kie", "kie"])
  })
})

describe("the wire GPT-6.2 Sol and Astra are sent", () => {
  it.each([
    ["gpt-6.2-sol", "gpt-6-2-sol"],
    ["gpt-6.2-astra", "gpt-6-2-astra"],
  ])("%s posts to codex/v1/responses with its KIE slug, non-stream, no sampling param, every level as asked", async (modelId, slug) => {
    fetchMock.mockImplementation(async () => rawResponse(SOL_AUTO_REPLY))
    await llmComplete({ modelId, system: "be terse", messages: [{ role: "user", content: "hi" }], temperature: 0.2 })
    for (const reasoningEffort of ["none", "low", "medium", "high", "xhigh", "max"] as const) {
      await llmComplete({ modelId, system: "", messages: [{ role: "user", content: "a" }], reasoningEffort })
    }
    expect(fetchMock.mock.calls[0]?.[0]).toBe(CODEX_URL)
    const body = bodyOf()
    expect(body.model).toBe(slug)
    expect(body.stream).toBe(false)
    expect(body.temperature).toBeUndefined()
    expect(body.reasoning).toBeUndefined()
    expect(bodyOf(1).reasoning).toBeUndefined()
    expect([2, 3, 4, 5, 6].map((i) => bodyOf(i).reasoning?.effort)).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  it.each(["gpt-6.2-sol", "gpt-6.2-astra"])("%s sends a PDF as an inline `input_file` part", async (modelId) => {
    fetchMock.mockResolvedValue(rawResponse(SOL_AUTO_REPLY))
    await llmComplete({
      modelId,
      system: "",
      messages: [{ role: "user", content: [{ type: "file_base64", filename: "doc.pdf", mediaType: "application/pdf", data: "JVBERi0=", pages: 2 }, { type: "text", text: "codename?" }] }],
    })
    expect(bodyOf().input[0].content[0]).toEqual({ type: "input_file", filename: "doc.pdf", file_data: "data:application/pdf;base64,JVBERi0=" })
  })

  it.each(["gpt-6.2-sol", "gpt-6.2-astra"])("%s sends its schema as an enforced `text.format` json_schema", async (modelId) => {
    fetchMock.mockResolvedValue(rawResponse(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: '{"mood":"happy"}' }] }],
      usage: { input_tokens: 85, output_tokens: 29 },
    })))
    const out = await llmCompleteStructured({ modelId, system: "", messages: [{ role: "user", content: "mood?" }] }, z.object({ mood: z.enum(["happy", "sad"]) }))
    expect(out.output).toEqual({ mood: "happy" })
    expect(bodyOf().text?.format).toMatchObject({ type: "json_schema" })
  })
})

describe("GPT-6.2 Sol and Astra report their real input count", () => {
  it("is read from top-level usage and trusted, and KIE's stated charge is kept", async () => {
    fetchMock.mockResolvedValue(rawResponse(SOL_AUTO_REPLY))
    const res = await llmComplete({ modelId: "gpt-6.2-sol", system: "", messages: [{ role: "user", content: "puzzle" }] })
    expect(res.usage).toEqual({ inputTokens: 53, outputTokens: 27 })
    expect(res.creditsUsd).toBeCloseTo(0.02 * 0.005, 12)
    for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) expect(kieInputUntrusted(id), id).toBe(false)
  })

  it("neither carries an added-input row: the hold and the estimate count the request alone", () => {
    for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
      expect(llmLaneAddedInputTokens(id, "kie"), id).toBe(0)
      expect(llmLaneAddedInputTokens(id, "kie", "high"), id).toBe(0)
    }
  })
})

describe("GPT-6.2 Astra's one padded probe reply (26,903 input tokens for a 53-token prompt)", () => {
  // The codex stream's last frame carries KIE's stated charge beside the
  // response; the one padded reply of the probe stated 0.73 credits. Built
  // from the recorded GPT-6.1 Terra stream, with the padded reply's usage and
  // charge swapped in.
  const PADDED_STREAM = TERRA_STREAM
    .replaceAll("gpt-6.1-terra", "gpt-6.2-astra")
    .replace('"input_tokens_details":{"cached_tokens":4224},"total_tokens":4409,"output_tokens":9,"input_tokens":4400', '"input_tokens_details":{"cached_tokens":0},"total_tokens":26910,"output_tokens":7,"input_tokens":26903')
    .replace('"credits_consumed":0.03', '"credits_consumed":0.73')

  it("a stream follows KIE's stated charge, never the reported tokens × the list rate", async () => {
    expect(PADDED_STREAM).toContain('"input_tokens":26903')
    fetchMock.mockResolvedValue(sseResponse(PADDED_STREAM))
    const req = { modelId: "gpt-6.2-astra", system: "", messages: [{ role: "user" as const, content: "puzzle" }], reasoningEffort: "medium" as const }
    const res = await llmStream(req, () => {})
    expect(res.usage).toEqual({ inputTokens: 26_903, outputTokens: 7 })
    expect(res.creditsUsd).toBeCloseTo(0.73 * 0.005, 12)
    const spend = new LlmSpend()
    spend.add("gpt-6.2-astra", req, { response: res })
    expect(spend.costUsd).toBeCloseTo(0.73 * 0.005, 12)
    expect(spend.costUsd).toBeLessThan(calculateLlmCost("gpt-6.2-astra", { inputTokens: 26_903, outputTokens: 7 }, "kie"))
  })
})

describe("a GPT-6.2 reply with NO stated charge: an implausible input count is billed from the request's size (decided 2026-11-22)", () => {
  const usageOf = (inputTokens: number) => ({ input_tokens: inputTokens, input_tokens_details: { cached_tokens: 0 }, output_tokens: 7, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: inputTokens + 7 })
  const replyOf = (model: string, inputTokens: number, extra: Record<string, unknown> = {}) => JSON.stringify({
    model,
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: '{"mood":"happy"}' }] }],
    usage: usageOf(inputTokens),
    ...extra,
  })
  // The probe's prompt: 150 characters, 38 tokens by the size estimate.
  const PROMPT = "A bat and a ball cost 1.10 in total. The bat costs 1.00 more than the ball. Then I buy 3 balls and 2 bats. What do I pay? Answer with the number only."
  const reqOf = (modelId: string): LlmRequest => ({ modelId, system: "", messages: [{ role: "user", content: PROMPT }], reasoningEffort: "medium" })
  const sizeOf = (req: LlmRequest) => kieInputTokens(requestChars(req))
  const costAt = (modelId: string, inputTokens: number) => calculateLlmCost(modelId, { inputTokens, outputTokens: 7 }, "kie")
  const billedUsd = (modelId: string, req: LlmRequest, outcome: Parameters<InstanceType<typeof LlmSpend>["add"]>[2]) => {
    const spend = new LlmSpend()
    spend.add(modelId, req, outcome)
    return spend.costUsd
  }

  it("is declared for exactly the two GPT-6.2 models, with a factor of 4, and neither joins the unreported-input list", () => {
    expect(KIE_INPUT_IMPLAUSIBLE_FACTOR).toBe(4)
    for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
      expect(kieInputCheckedWhenUnstated(id), id).toBe(true)
      expect(kieInputUntrusted(id), id).toBe(false)
    }
    for (const id of ["gpt-6.1-terra", "gpt-6-astra", "gemini-4-neon", "gemini-4-hydrogen"]) expect(kieInputCheckedWhenUnstated(id), id).toBe(false)
    expect(sizeOf(reqOf("gpt-6.2-astra"))).toBe(38)
  })

  it("(a) dense input — reported about 3 times the estimate, no stated charge — is billed as reported", async () => {
    const req = reqOf("gpt-6.2-astra")
    const reported = 3 * sizeOf(req)
    fetchMock.mockResolvedValue(rawResponse(replyOf("gpt-6.2-astra", reported)))
    const res = await llmComplete(req)
    expect(billedUsd("gpt-6.2-astra", req, { response: res })).toBeCloseTo(costAt("gpt-6.2-astra", reported), 12)
  })

  it("a count just over the factor is the estimate; one at it is reported", async () => {
    const req = reqOf("gpt-6.2-astra")
    const size = sizeOf(req)
    for (const [reported, billedInput] of [[4 * size, 4 * size], [4 * size + 1, size]] as const) {
      fetchMock.mockResolvedValueOnce(rawResponse(replyOf("gpt-6.2-astra", reported)))
      const res = await llmComplete(req)
      expect(billedUsd("gpt-6.2-astra", req, { response: res }), String(reported)).toBeCloseTo(costAt("gpt-6.2-astra", billedInput), 12)
    }
  })

  it.each(["gpt-6.2-sol", "gpt-6.2-astra"])("(b) %s non-stream: 26,903 reported for a 150-character prompt is billed from the estimate", async (modelId) => {
    const req = reqOf(modelId)
    fetchMock.mockResolvedValue(rawResponse(replyOf(modelId, 26_903)))
    const res = await llmComplete(req)
    expect(res.usage).toEqual({ inputTokens: 26_903, outputTokens: 7 })
    expect(res.creditsUsd).toBeUndefined()
    const spend = new LlmSpend()
    spend.add(modelId, req, { response: res })
    expect(spend.costUsd).toBeCloseTo(costAt(modelId, sizeOf(req)), 12)
    // So small a call is charged the minimum; at the reported count it would not be.
    expect(spend.record.source).toBe("floor")
  })

  it.each(["gpt-6.2-sol", "gpt-6.2-astra"])("(b) %s stream: the same padded usage with no stated charge is billed from the estimate", async (modelId) => {
    const stream = TERRA_STREAM
      .replaceAll("gpt-6.1-terra", modelId)
      .replace('"input_tokens_details":{"cached_tokens":4224},"total_tokens":4409,"output_tokens":9,"input_tokens":4400', '"input_tokens_details":{"cached_tokens":0},"total_tokens":26910,"output_tokens":7,"input_tokens":26903')
      .replace(',"credits_consumed":0.03', "")
    expect(stream).not.toContain("credits_consumed")
    fetchMock.mockResolvedValue(sseResponse(stream))
    const req = reqOf(modelId)
    const res = await llmStream(req, () => {})
    expect(res.usage).toEqual({ inputTokens: 26_903, outputTokens: 7 })
    expect(res.creditsUsd).toBeUndefined()
    expect(billedUsd(modelId, req, { response: res })).toBeCloseTo(costAt(modelId, sizeOf(req)), 12)
  })

  it("(c) a 3-page PDF reported at 26,903 input with no stated charge is billed at the documents' floor — not 26,903, not below the floor", async () => {
    const req: LlmRequest = { modelId: "gpt-6.2-astra", system: "", messages: [{ role: "user", content: [{ type: "file_base64", filename: "d.pdf", mediaType: "application/pdf", data: "JVBERi0=", pages: 3 }, { type: "text", text: "sum" }] }] }
    fetchMock.mockResolvedValue(rawResponse(replyOf("gpt-6.2-astra", 26_903)))
    const res = await llmComplete(req)
    const floor = documentInputFloorTokens(req)
    expect(floor).toBeGreaterThan(sizeOf(req))
    expect(26_903).toBeGreaterThan(4 * floor)
    expect(billedUsd("gpt-6.2-astra", req, { response: res })).toBeCloseTo(costAt("gpt-6.2-astra", floor), 12)
  })

  it("a reported 0 with a PDF keeps today's rule: the documents' floor", async () => {
    const req: LlmRequest = { modelId: "gpt-6.2-sol", system: "", messages: [{ role: "user", content: [{ type: "file_base64", filename: "d.pdf", mediaType: "application/pdf", data: "JVBERi0=", pages: 3 }, { type: "text", text: "sum" }] }] }
    fetchMock.mockResolvedValue(rawResponse(replyOf("gpt-6.2-sol", 0)))
    const res = await llmComplete(req)
    expect(billedUsd("gpt-6.2-sol", req, { response: res })).toBeCloseTo(costAt("gpt-6.2-sol", documentInputFloorTokens(req)), 12)
  })

  it("(d) a structured attempt: a padded count is billed from the estimate, a genuine one as reported", async () => {
    const Mood = z.object({ mood: z.enum(["happy", "sad"]) })
    const req = reqOf("gpt-6.2-astra")
    // A structured attempt's size counts the schema it sent too (`requestChars` of the attempt's own request).
    fetchMock.mockResolvedValueOnce(rawResponse(replyOf("gpt-6.2-astra", 26_903)))
    const padded = await llmCompleteStructured(req, Mood)
    expect(padded.attempts).toHaveLength(1)
    const size = kieInputTokens(padded.attempts[0]!.requestChars)
    expect(size).toBeLessThan(100)
    expect(billedUsd("gpt-6.2-astra", req, { output: padded })).toBeCloseTo(costAt("gpt-6.2-astra", size), 12)
    fetchMock.mockResolvedValueOnce(rawResponse(replyOf("gpt-6.2-astra", 3 * size)))
    const genuine = await llmCompleteStructured(req, Mood)
    expect(billedUsd("gpt-6.2-astra", req, { output: genuine })).toBeCloseTo(costAt("gpt-6.2-astra", 3 * size), 12)
  })

  it("(d) a failed attempt that billed usage: a padded count is billed from the estimate", async () => {
    const req = reqOf("gpt-6.2-astra")
    // A structured call whose answer was cut off at the cap: KIE billed it, and the call fails.
    fetchMock.mockResolvedValue(rawResponse(JSON.stringify({
      ...JSON.parse(replyOf("gpt-6.2-astra", 26_903)),
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    })))
    const err = await llmCompleteStructured(req, z.object({ mood: z.enum(["happy", "sad"]) })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    const attempts = (err as { usage?: { attempts?: Array<{ requestChars: number }> } }).usage?.attempts ?? []
    expect(attempts).toHaveLength(1)
    const size = kieInputTokens(attempts[0]!.requestChars)
    expect(size).toBeLessThan(100)
    expect(billedUsd("gpt-6.2-astra", req, { error: err })).toBeCloseTo(costAt("gpt-6.2-astra", size), 12)
    // The same failure arriving bare (a usage-carrying lane error) is billed the same way.
    const bare = new LlmStreamResponseError("cut off", { inputTokens: 26_903, outputTokens: 7, complete: false }, "kie")
    expect(billedUsd("gpt-6.2-astra", req, { error: bare })).toBeCloseTo(costAt("gpt-6.2-astra", sizeOf(req)), 12)
  })

  it("(e) a reply that DOES state a charge is still billed that figure", async () => {
    fetchMock.mockResolvedValue(rawResponse(replyOf("gpt-6.2-astra", 26_903, { credits_consumed: 0.73 })))
    const req = reqOf("gpt-6.2-astra")
    const res = await llmComplete(req)
    const spend = new LlmSpend()
    spend.add("gpt-6.2-astra", req, { response: res })
    expect(spend.costUsd).toBeCloseTo(0.73 * 0.005, 12)
    expect(spend.record.source).toBe("kie-stated")
  })
})

describe("a structured attempt carries its documents' floor, as a plain one does", () => {
  it("a structured GPT-6.2 call with a 3-page PDF and a padded count is billed at the floor, not below it", async () => {
    const req: LlmRequest = {
      modelId: "gpt-6.2-astra",
      system: "",
      messages: [{ role: "user", content: [{ type: "file_base64", filename: "d.pdf", mediaType: "application/pdf", data: "JVBERi0=", pages: 3 }, { type: "text", text: "mood?" }] }],
    }
    fetchMock.mockResolvedValue(rawResponse(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: '{"mood":"happy"}' }] }],
      usage: { input_tokens: 26_903, output_tokens: 7 },
    })))
    const out = await llmCompleteStructured(req, z.object({ mood: z.enum(["happy", "sad"]) }))
    const attempt = out.attempts[0]!
    // The floor of the attempt's own request: its documents' pages plus its text (the structured instruction included).
    expect(attempt.fileInputFloor).toBeGreaterThanOrEqual(documentInputFloorTokens(req))
    const sized = Math.max(kieInputTokens(attempt.requestChars), attempt.fileInputFloor!)
    const spend = new LlmSpend()
    spend.add("gpt-6.2-astra", req, { output: out })
    expect(spend.costUsd).toBeCloseTo(calculateLlmCost("gpt-6.2-astra", { inputTokens: sized, outputTokens: 7 }, "kie"), 12)
    expect(sized).toBeGreaterThanOrEqual(documentInputFloorTokens(req))
  })

  it("a plugin's structured output with no attempts, and a usage-only failure, carry the floor too", () => {
    const req: LlmRequest = {
      modelId: "gpt-6.2-sol",
      system: "",
      messages: [{ role: "user", content: [{ type: "file_base64", filename: "d.pdf", mediaType: "application/pdf", data: "JVBERi0=", pages: 3 }, { type: "text", text: "mood?" }] }],
    }
    const spend = new LlmSpend()
    spend.add("gpt-6.2-sol", req, { output: { output: {}, lane: "kie", inputTokens: 26_903, outputTokens: 7 } as never })
    spend.add("gpt-6.2-sol", req, { error: Object.assign(new Error("failed"), { usage: { inputTokens: 26_903, outputTokens: 7 } }) })
    for (const a of spend.attempts) expect(a.fileInputFloor).toBe(documentInputFloorTokens(req))
  })
})
