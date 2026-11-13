/**
 * A document block (`file_base64`, decided 2026-11-13) on the wire and in the
 * billing figures:
 *  - only the KIE `responses` builder carries it, as an inline `input_file`
 *    (the shape probed on GPT-6.1 Terra); every other builder throws;
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
    const input = buildResponsesInput(req("gpt-6.1-terra", [pdf(3), { type: "text", text: "summarise" }]))
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
    expect(() => buildMessagesBody(getLlmModel("claude-sonnet-5.5")!, r)).toThrow(/document \(file_base64\)/)
    expect(() => llmBlockToAnthropic(pdf(1))).toThrow(/document \(file_base64\)/)
  })
})

describe("the lanes a file call can take", () => {
  // Only the KIE responses wire carries a document; every other builder throws.
  // A model that reads files must therefore be served on that wire ALONE — no
  // direct lane, no fallback — or a fallback would fail a held call mid-run.
  it("every model that reads files is served on the KIE responses wire and nowhere else", async () => {
    const { LLM_FILE_MODELS } = await import("@nodaro/shared/llm-models")
    const { llmPossibleLanes } = await import("../pricing/llm-cost.js")
    expect(LLM_FILE_MODELS.length).toBeGreaterThan(0)
    for (const model of LLM_FILE_MODELS) {
      expect(model.kieFormat, model.id).toBe("responses")
      expect(model.directOnly, model.id).toBeFalsy()
      expect(model.directGeminiModel, model.id).toBeUndefined()
      expect(model.directFallbackModel, model.id).toBeUndefined()
      for (const effort of [undefined, ...(model.reasoningEfforts ?? [])]) {
        for (const advanced of [false, true]) expect(llmPossibleLanes(model, effort, advanced), `${model.id} ${effort} ${advanced}`).toEqual(["kie"])
      }
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
    expect(withPdf - base).toBeGreaterThanOrEqual(3)
    expect(withPdf - base).toBeLessThanOrEqual(4)
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
