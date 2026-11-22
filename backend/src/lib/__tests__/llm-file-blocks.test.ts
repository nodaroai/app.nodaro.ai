/**
 * A document block (`file_base64`, decided 2026-11-13) on the wire and in the
 * billing figures:
 *  - a builder carries it only in the shape its model declares for that lane
 *    (`fileWire`): an inline `input_file` on KIE's `responses` dialect (probed
 *    on GPT-6.1 Terra), an `image_url` part on its chat-completions dialect
 *    (probed on Gemini 4 Hydrogen, 2026-11-17: the `file` and `input_file`
 *    shapes are dropped there); every other builder and model throws;
 *  - the hold counts it by its pages (`LLM_FILE_PAGE_TOKENS` a page, plus
 *    `LLM_FILE_TOKENS` a file), never as a media block's 60 s default;
 *  - the size estimate (a stopped stream) counts it by its pages too;
 *  - its characters come off the inline budget the call's images share.
 */
import { describe, it, expect, vi } from "vitest"
import type { LlmContentBlock, LlmRequest } from "../llm/types.js"

vi.mock("../config.js", () => ({ config: { KIE_API_KEY: "k", NODE_ENV: "test" }, hasCredits: () => false }))

const { buildResponsesInput, buildChatCompletionsMessages, buildMessagesBody, llmBlockToAnthropic } = await import("../llm/message-builders.js")
const { requestChars, KIE_FILE_PAGE_ESTIMATE_CHARS } = await import("../llm/kie-cost.js")
const { llmRequestInputBound, llmHoldBaseCredits, LLM_FILE_PAGE_TOKENS, LLM_FILE_TOKENS, LLM_CEILING_CHARS_PER_TOKEN } = await import("../../ee/billing/llm-metered.js")
const { getLlmModel } = await import("@nodaro/shared/llm-models")

const pdf = (pages: number, data = "JVBERi0xLjQK"): Extract<LlmContentBlock, { type: "file_base64" }> =>
  ({ type: "file_base64", mediaType: "application/pdf", data, filename: "report.pdf", pages })

const req = (modelId: string, blocks: LlmContentBlock[], extra: Partial<LlmRequest> = {}): LlmRequest => ({
  modelId, system: "", messages: [{ role: "user", content: blocks }], ...extra,
})

describe("the wire", () => {
  it("the responses builder sends a document as an inline input_file with its name", () => {
    const input = buildResponsesInput(req("gpt-6.1-terra", [pdf(3), { type: "text", text: "summarise" }]), getLlmModel("gpt-6.1-terra")!)
    expect(input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_file", filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQK" },
          { type: "input_text", text: "summarise" },
        ],
      },
    ])
  })

  it("every other builder refuses a document rather than drop it", () => {
    const r = req("gemini-3.6-flash", [pdf(1), { type: "text", text: "x" }])
    expect(() => buildChatCompletionsMessages(r)).toThrow(/document \(file_base64\)/)
    // The responses dialect carries a document only for a model that declares it (`input-file`).
    expect(() => buildResponsesInput(r)).toThrow(/document \(file_base64\)/)
    for (const id of ["gpt-6.1-sol", "gpt-5.6-terra", "grok-4.6", "gemini-4-hydrogen"]) {
      expect(() => buildResponsesInput(req(id, [pdf(1)]), getLlmModel(id)!), id).toThrow(/document \(file_base64\)/)
    }
    expect(() => buildMessagesBody(getLlmModel("claude-sonnet-5.5")!, r)).toThrow(/document \(file_base64\)/)
    expect(() => llmBlockToAnthropic(pdf(1))).toThrow(/document \(file_base64\)/)
  })
})

describe("a document on the chat-completions dialect (Gemini 4 Hydrogen, probed 2026-11-17)", () => {
  const hydrogen = getLlmModel("gemini-4-hydrogen")!

  it("goes as an image_url part holding a data:application/pdf URL — never a file or input_file part", () => {
    const msgs = buildChatCompletionsMessages(req("gemini-4-hydrogen", [pdf(5), { type: "text", text: "summarise" }]), hydrogen)
    expect(msgs).toEqual([
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:application/pdf;base64,JVBERi0xLjQK" } },
          { type: "text", text: "summarise" },
        ],
      },
    ])
    expect(JSON.stringify(msgs)).not.toMatch(/"type":"(file|input_file)"|file_data|file_url|filename/)
  })

  it("a file past the inline limit goes by its stored .pdf link, and never inline", async () => {
    const { KIE_INLINE_DATA_URL_MAX_CHARS } = await import("../kie-inline-image.js")
    const big = "A".repeat(KIE_INLINE_DATA_URL_MAX_CHARS)
    const hosted = { ...pdf(15, big), hostedUrl: "https://media.example/tmp/provider-input/llm-file-1.pdf" }
    const msgs = buildChatCompletionsMessages(req("gemini-4-hydrogen", [hosted]), hydrogen)
    expect(msgs[0]!.content).toEqual([{ type: "image_url", image_url: { url: "https://media.example/tmp/provider-input/llm-file-1.pdf" } }])
    // Past the limit with no stored link: a call path skipped the step. Refused, not sent.
    expect(() => buildChatCompletionsMessages(req("gemini-4-hydrogen", [pdf(15, big)]), hydrogen)).toThrow(/inline limit/)
    // A stored link the aggregator would not read as a PDF (no .pdf ending, a query, plain http) is refused.
    for (const hostedUrl of ["https://media.example/a", "https://media.example/a.pdf?x=1", "http://media.example/a.pdf"]) {
      expect(() => buildChatCompletionsMessages(req("gemini-4-hydrogen", [{ ...pdf(1), hostedUrl }]), hydrogen), hostedUrl).toThrow(/\.pdf/)
    }
  })

  it("a mixed message — image, video and PDF — keeps its order, each in the part this dialect reads", () => {
    const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    const msgs = buildChatCompletionsMessages(req("gemini-4-hydrogen", [
      { type: "image_base64", mediaType: "image/png", data: TINY_PNG },
      { type: "video", url: "https://media.example/cut.mp4" },
      pdf(2),
      { type: "text", text: "compare them" },
    ]), hydrogen)
    expect(msgs[0]!.content).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
      { type: "image_url", image_url: { url: "https://media.example/cut.mp4" } },
      { type: "image_url", image_url: { url: "data:application/pdf;base64,JVBERi0xLjQK" } },
      { type: "text", text: "compare them" },
    ])
  })

  it("a model on this dialect that declares no file shape still throws, with or without its model passed", () => {
    for (const id of ["gemini-4-carbon", "gemini-4-argon", "gemini-3.6-flash"]) {
      const r = req(id, [pdf(1), { type: "text", text: "x" }])
      expect(() => buildChatCompletionsMessages(r, getLlmModel(id)!), id).toThrow(/document \(file_base64\)/)
      expect(() => buildChatCompletionsMessages(r), id).toThrow(/document \(file_base64\)/)
    }
    // Terra's shape belongs to the responses dialect: it is not a licence for this one.
    expect(() => buildChatCompletionsMessages(req("gpt-6.1-terra", [pdf(1)]), getLlmModel("gpt-6.1-terra")!)).toThrow(/document \(file_base64\)/)
  })

  it("Terra's body is unchanged: an inline input_file, a stored link ignored", () => {
    const expected = [{ role: "user", content: [{ type: "input_file", filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQK" }] }]
    const terra = getLlmModel("gpt-6.1-terra")!
    expect(buildResponsesInput(req("gpt-6.1-terra", [pdf(3)]), terra)).toEqual(expected)
    expect(buildResponsesInput(req("gpt-6.1-terra", [{ ...pdf(3), hostedUrl: "https://media.example/a.pdf" }]), terra)).toEqual(expected)
  })
})

describe("the lanes a file call can take", () => {
  // A builder sends a document only in the shape its model declares for that
  // lane (`fileWire`), and throws otherwise. So every lane a file model can be
  // served on — its primary, its fallback, Advanced mode's pin — must have a
  // declared shape, or a fallback would fail a held call mid-run (or worse,
  // drop the file).
  it("every model that reads files declares a shape for every lane it can be served on", async () => {
    const { LLM_FILE_MODELS } = await import("@nodaro/shared/llm-models")
    const { llmPossibleLanes } = await import("../pricing/llm-cost.js")
    expect(LLM_FILE_MODELS.map((m) => m.id)).toEqual(["gemini-4-neon", "gemini-4-hydrogen", "gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.1-terra"])
    for (const model of LLM_FILE_MODELS) {
      expect(model.directFallbackModel, model.id).toBeUndefined()
      for (const effort of [undefined, ...(model.reasoningEfforts ?? [])]) {
        for (const advanced of [false, true]) {
          for (const lane of llmPossibleLanes(model, effort, advanced)) {
            expect(model.fileWire?.[lane], `${model.id} ${effort} ${advanced} ${lane}`).toBeDefined()
          }
        }
      }
      // The aggregator's shape is the one its dialect reads.
      expect(model.fileWire!.kie, model.id).toBe(model.kieFormat === "responses" ? "input-file" : "image-url")
    }
  })

  it.each(["gemini-4-neon", "gpt-6.2-sol", "gpt-6.2-astra"])("%s is served on its KIE wire and nowhere else (no direct lane)", async (id) => {
    const { llmPossibleLanes } = await import("../pricing/llm-cost.js")
    const model = getLlmModel(id)!
    expect(model.directGeminiModel).toBeUndefined()
    for (const effort of [undefined, ...(model.reasoningEfforts ?? [])]) {
      for (const advanced of [false, true]) expect(llmPossibleLanes(model, effort, advanced), `${effort} ${advanced}`).toEqual(["kie"])
    }
  })

  it("Terra is served on the KIE responses wire and nowhere else, as before", async () => {
    const { llmPossibleLanes } = await import("../pricing/llm-cost.js")
    const model = getLlmModel("gpt-6.1-terra")!
    expect(model.kieFormat).toBe("responses")
    expect(model.directOnly).toBeFalsy()
    expect(model.directGeminiModel).toBeUndefined()
    for (const effort of [undefined, ...(model.reasoningEfforts ?? [])]) {
      for (const advanced of [false, true]) expect(llmPossibleLanes(model, effort, advanced), `${effort} ${advanced}`).toEqual(["kie"])
    }
  })
})

describe("billing figures", () => {
  it("the hold's input bound counts a document by its pages, plus one file's share", () => {
    const text = "x".repeat(30) // 10 tokens
    const withFiles = llmRequestInputBound(req("gpt-6.1-terra", [pdf(10), pdf(2), { type: "text", text }]))
    expect(withFiles).toBe(10 + 2 * LLM_FILE_TOKENS + 12 * LLM_FILE_PAGE_TOKENS)
    // Never the 60 s media default a block of unknown kind fell to before.
    expect(llmRequestInputBound(req("gpt-6.1-terra", [pdf(1), { type: "text", text }]))).toBe(10 + LLM_FILE_TOKENS + LLM_FILE_PAGE_TOKENS)
    expect(LLM_CEILING_CHARS_PER_TOKEN).toBe(3)
  })

  it("a Terra hold with a 10-page document is above the same call without it by exactly those tokens", () => {
    const base = llmHoldBaseCredits("gpt-6.1-terra", { request: req("gpt-6.1-terra", [{ type: "text", text: "hi" }], { maxTokens: 1000 }) })
    const withPdf = llmHoldBaseCredits("gpt-6.1-terra", { request: req("gpt-6.1-terra", [pdf(10), { type: "text", text: "hi" }], { maxTokens: 1000 }) })
    expect(withPdf).toBeGreaterThan(base)
    // 10 × 3,500 + 1,000 = 36,000 input tokens more; each hold is rounded up on its own.
    expect(withPdf - base).toBeGreaterThanOrEqual(5)
    expect(withPdf - base).toBeLessThanOrEqual(6)
  })

  it("a page is held at least at what a scanned page measured (2026-11-14: about 3,400 input tokens on Terra)", () => {
    expect(LLM_FILE_PAGE_TOKENS).toBe(3_500)
    expect(LLM_FILE_PAGE_TOKENS).toBeGreaterThanOrEqual(Math.ceil(13_592 / 4))
  })

  // Gemini 4 Hydrogen, measured 2026-11-17: 1,280 to 2,670 prompt tokens a
  // page; a 5-page file reported 13,357 prompt tokens and a 14-page one 28,068.
  it("a Hydrogen hold covers what its pages measured, on the aggregator's lane and on Google's own", () => {
    const text = { type: "text" as const, text: "summarise" }
    expect(LLM_FILE_PAGE_TOKENS).toBeGreaterThanOrEqual(2_700)
    expect(llmRequestInputBound(req("gemini-4-hydrogen", [pdf(5), text]))).toBeGreaterThanOrEqual(13_357)
    expect(llmRequestInputBound(req("gemini-4-hydrogen", [pdf(14), text]))).toBeGreaterThanOrEqual(28_068)
    expect(llmRequestInputBound(req("gemini-4-hydrogen", [pdf(15), text]))).toBeGreaterThanOrEqual(15 * 2_700)
    for (const requireLane of [undefined, "direct"] as const) {
      const base = llmHoldBaseCredits("gemini-4-hydrogen", { request: req("gemini-4-hydrogen", [text], { maxTokens: 1000, requireLane }) })
      const five = llmHoldBaseCredits("gemini-4-hydrogen", { request: req("gemini-4-hydrogen", [pdf(5), text], { maxTokens: 1000, requireLane }) })
      const fifteen = llmHoldBaseCredits("gemini-4-hydrogen", { request: req("gemini-4-hydrogen", [pdf(15), text], { maxTokens: 1000, requireLane }) })
      expect(five, String(requireLane)).toBeGreaterThan(base)
      expect(fifteen, String(requireLane)).toBeGreaterThan(five)
    }
  })

  it("the hold counts a document's larger hold count; the floor and the size estimate its reader's pages", async () => {
    const block = { ...pdf(80), holdPages: 150 }
    const text = "x".repeat(30)
    expect(llmRequestInputBound(req("gpt-6.1-terra", [block, { type: "text", text }]))).toBe(10 + LLM_FILE_TOKENS + 150 * LLM_FILE_PAGE_TOKENS)
    const { documentInputFloorTokens, LLM_FILE_CHARGE_PAGE_TOKENS, LLM_FILE_CHARGE_FILE_TOKENS } = await import("../llm/kie-cost.js")
    expect(documentInputFloorTokens(req("gpt-6.1-terra", [block, { type: "text", text }]))).toBe(LLM_FILE_CHARGE_FILE_TOKENS + 80 * LLM_FILE_CHARGE_PAGE_TOKENS + 8)
    expect(requestChars(req("gpt-6.1-terra", [block]))).toBe(80 * KIE_FILE_PAGE_ESTIMATE_CHARS)
  })

  it("the size estimate counts a document by its pages", () => {
    expect(requestChars(req("gpt-6.1-terra", [pdf(4), { type: "text", text: "abc" }]))).toBe(3 + 4 * KIE_FILE_PAGE_ESTIMATE_CHARS)
  })
})

describe("a document's size after the hold is the model's own (lib/llm/file-sizes.ts)", () => {
  it("Terra keeps its figures: 600 tokens a page and 100 a file counted, 2,000 characters a page estimated", async () => {
    const { llmFileSizes, DEFAULT_FILE_SIZES } = await import("../llm/file-sizes.js")
    const { documentInputFloorTokens } = await import("../llm/kie-cost.js")
    expect(llmFileSizes("gpt-6.1-terra")).toBe(DEFAULT_FILE_SIZES)
    expect(DEFAULT_FILE_SIZES).toEqual({ chargePageTokens: 600, chargeFileTokens: 100, estimatePageChars: 2_000 })
    expect(documentInputFloorTokens(req("gpt-6.1-terra", [pdf(5)]))).toBe(100 + 5 * 600)
    expect(requestChars(req("gpt-6.1-terra", [pdf(5)]))).toBe(5 * 2_000)
    expect(llmFileSizes(undefined)).toBe(DEFAULT_FILE_SIZES)
    expect(llmFileSizes("constructor")).toBe(DEFAULT_FILE_SIZES)
  })

  it("Hydrogen is counted and estimated at the least a read page reports, its 520 image tokens (2026-11-17, both lanes)", async () => {
    const { llmFileSizes } = await import("../llm/file-sizes.js")
    const { documentInputFloorTokens } = await import("../llm/kie-cost.js")
    expect(llmFileSizes("gemini-4-hydrogen")).toEqual({ chargePageTokens: 520, chargeFileTokens: 0, estimatePageChars: 2_080, notReadPageTokens: 450 })
    expect(documentInputFloorTokens(req("gemini-4-hydrogen", [pdf(5)]))).toBe(5 * 520)
    expect(requestChars(req("gemini-4-hydrogen", [pdf(5), { type: "text", text: "abc" }]))).toBe(3 + 5 * 2_080)
    // Never above what the documents really reported (13,357 for 5 pages, 28,068 for 14, 19,220 for 15).
    expect(documentInputFloorTokens(req("gemini-4-hydrogen", [pdf(5)]))).toBeLessThanOrEqual(13_357)
    expect(documentInputFloorTokens(req("gemini-4-hydrogen", [pdf(14)]))).toBeLessThanOrEqual(28_068)
    expect(documentInputFloorTokens(req("gemini-4-hydrogen", [pdf(15)]))).toBeLessThanOrEqual(19_220)
    // …and under the hold.
    expect(llmFileSizes("gemini-4-hydrogen").chargePageTokens).toBeLessThan(LLM_FILE_PAGE_TOKENS)
  })

  it("the documents' count applies on the aggregator's lane only: the vendor's own API is counted as it reports", async () => {
    const { llmAttemptCostUsd } = await import("../llm-spend.js") as unknown as { llmAttemptCostUsd: (a: Record<string, unknown>) => number }
    const { calculateLlmCost } = await import("../pricing/llm-cost.js")
    const attempt = (lane: "kie" | "direct") => ({ modelId: "gemini-4-hydrogen", lane, inputTokens: 200, outputTokens: 50, requestChars: 100, fileInputFloor: 6_500 })
    expect(llmAttemptCostUsd(attempt("kie"))).toBeCloseTo(calculateLlmCost("gemini-4-hydrogen", { inputTokens: 6_500, outputTokens: 50 }, "kie"), 12)
    expect(llmAttemptCostUsd(attempt("direct"))).toBeCloseTo(calculateLlmCost("gemini-4-hydrogen", { inputTokens: 200, outputTokens: 50 }, "direct"), 12)
  })
})

describe("the inline budget", () => {
  // A 1×1 PNG: about 118 characters as a data URL.
  const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  const image = { type: "image_base64" as const, mediaType: "image/png", data: TINY_PNG }

  it("a document's characters come off the budget the call's images share", async () => {
    const { inlineImagesForKie } = await import("../kie-inline-image.js")
    const budgetChars = 4_000_100
    // Alone, the image fits its allowance with room to spare.
    await expect(inlineImagesForKie(req("gpt-6.1-terra", [image]), { budgetChars })).resolves.toBeDefined()
    // Beside a 4,000,000-character document only 100 characters are left: the image cannot fit.
    await expect(inlineImagesForKie(req("gpt-6.1-terra", [pdf(1, "A".repeat(4_000_000)), image]), { budgetChars })).rejects.toThrow(/allowance/)
  })

  it("a document sent by its stored link takes nothing off that budget", async () => {
    const { inlineImagesForKie } = await import("../kie-inline-image.js")
    const hosted = { ...pdf(1, "A".repeat(4_000_000)), hostedUrl: "https://media.example/a.pdf" }
    await expect(inlineImagesForKie(req("gemini-4-hydrogen", [hosted, image]), { budgetChars: 4_000_100 })).resolves.toBeDefined()
  })
})

describe("the charge floor of a call that sent documents", () => {
  it("is the documents at the measured rate plus the text, and 0 without a document", async () => {
    const { documentInputFloorTokens, LLM_FILE_CHARGE_PAGE_TOKENS, LLM_FILE_CHARGE_FILE_TOKENS } = await import("../llm/kie-cost.js")
    // The measured rate, well under the hold's ceiling a page.
    expect(LLM_FILE_CHARGE_PAGE_TOKENS).toBeLessThan(LLM_FILE_PAGE_TOKENS)
    expect(documentInputFloorTokens(req("gpt-6.1-terra", [pdf(3), pdf(2), { type: "text", text: "x".repeat(400) }], { system: "y".repeat(40) } as never)))
      .toBe(2 * LLM_FILE_CHARGE_FILE_TOKENS + 5 * LLM_FILE_CHARGE_PAGE_TOKENS + 110)
    expect(documentInputFloorTokens(req("gpt-6.1-terra", [{ type: "text", text: "x".repeat(400) }]))).toBe(0)
  })

  it("applies only when no charge is stated, the reported input is below it, and the usage is not a stopped stream's estimate", async () => {
    const { LlmSpend } = await import("../llm-spend.js")
    const { documentInputFloorTokens } = await import("../llm/kie-cost.js")
    const { calculateLlmCost } = await import("../pricing/llm-cost.js")
    const { LlmStreamAbortedError } = await import("../llm-errors.js")
    const r = req("gpt-6.1-terra", [pdf(3), { type: "text", text: "summarise" }])
    const floor = documentInputFloorTokens(r)
    const cost = (outcome: Parameters<InstanceType<typeof LlmSpend>["add"]>[2]) => {
      const s = new LlmSpend()
      s.add("gpt-6.1-terra", r, outcome)
      return s.costUsd
    }
    const reply = (inputTokens: number, extra: Record<string, unknown> = {}) => ({ response: { text: "ok", model: "gpt-6.1-terra", lane: "kie", usage: { inputTokens, outputTokens: 50 }, ...extra } as never })
    expect(cost(reply(0))).toBeCloseTo(calculateLlmCost("gpt-6.1-terra", { inputTokens: floor, outputTokens: 50 }, "kie"), 12)
    // An adapter's cost figure from the reported tokens does not undercut it either.
    expect(cost(reply(0, { providerCost: 0.0000001 }))).toBeCloseTo(calculateLlmCost("gpt-6.1-terra", { inputTokens: floor, outputTokens: 50 }, "kie"), 12)
    expect(cost(reply(floor + 1))).toBeCloseTo(calculateLlmCost("gpt-6.1-terra", { inputTokens: floor + 1, outputTokens: 50 }, "kie"), 12)
    expect(cost(reply(0, { creditsUsd: 0.00005 }))).toBe(0.00005)
    // A stopped stream is costed from its own estimate (which counts the pages), never floored.
    const stopped = new LlmStreamAbortedError("stopped", { inputTokens: 10, outputTokens: 5, providerCost: 0.000004, complete: false, estimated: true }, "kie")
    expect(cost({ error: stopped })).toBe(0.000004)
    // The ledger says the floor applied (`document-floor`), unless even the floored cost is under one base credit (`floor`).
    const recordOf = (pages: number, outcome: Parameters<InstanceType<typeof LlmSpend>["add"]>[2]) => {
      const s = new LlmSpend()
      s.add("gpt-6.1-terra", req("gpt-6.1-terra", [pdf(pages), { type: "text", text: "summarise" }]), outcome)
      return s.record.source
    }
    expect(recordOf(100, reply(0))).toBe("document-floor")
    expect(recordOf(3, reply(0))).toBe("floor")
    expect(recordOf(100, reply(100_000))).toBe("provider-usage")
    // A call with no document is never floored.
    const plain = new LlmSpend()
    plain.add("gpt-6.1-terra", req("gpt-6.1-terra", [{ type: "text", text: "hi" }]), reply(0))
    expect(plain.attempts[0]).not.toHaveProperty("fileInputFloor")
  })
})
