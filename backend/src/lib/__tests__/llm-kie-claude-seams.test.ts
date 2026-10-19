/**
 * The KIE Claude-lane seams the pipelines and the Copilot need when they move
 * a call to KIE themselves: a caller's abort signal, the thinking flag, KIE's
 * own charge read off the reply, a size-based estimate when it is absent, and
 * images inlined as base64 before the request is built.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getLlmModel } from "@nodaro/shared/llm-models"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "", NODE_ENV: "test", KIE_API_BASE_URL: "https://api.kie.ai" },
  hasCredits: () => true,
}))
const prefetchMock = vi.hoisted(() => vi.fn())
vi.mock("../anthropic-image.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../anthropic-image.js")>()),
  prefetchAsBase64: prefetchMock,
}))

import { callKie } from "../llm/kie-lane.js"
import { buildMessagesBody } from "../llm/message-builders.js"
import { KIE_IMAGE_ESTIMATE_CHARS, kieCostUsd, kieCreditsUsdOf, kieFailureCostUsd, kieInputTokens, requestChars } from "../llm/kie-cost.js"
import { LlmContentRefusalError, LlmOutputTruncatedError } from "../llm-errors.js"
import { inlineImagesForClaudeKie } from "../llm/claude-kie-images.js"
import { calculateLlmCost } from "../pricing/llm-cost.js"
import type { LlmRequest } from "../llm/types.js"

const sonnet55 = getLlmModel("claude-sonnet-5.5")!

function sse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}
const kieText = (text: string, deltaExtra = "") => sse([
  `data: {"type":"content_block_delta","delta":{"text":${JSON.stringify(text)}}}\n`,
  `data: {"type":"message_delta","usage":{"input_tokens":2,"output_tokens":9}${deltaExtra}}\n`,
])
const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  modelId: "claude-sonnet-5.5",
  system: "SYSTEM",
  messages: [{ role: "user", content: "hi" }],
  ...over,
})

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  prefetchMock.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe("callKie — a caller's signal (Claude wire)", () => {
  it("reaches the request", async () => {
    fetchMock.mockResolvedValue(kieText("ok"))
    const ctrl = new AbortController()
    await callKie(sonnet55, req(), ctrl.signal)
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBe(ctrl.signal)
  })

  it("an aborted signal stops the Claude ladder after one attempt", async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init.signal?.aborted
        ? Promise.reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))
        : Promise.resolve(kieText("ok")),
    )
    const ctrl = new AbortController()
    ctrl.abort()
    const err = await callKie(sonnet55, req(), ctrl.signal).catch((e: unknown) => e)
    expect((err as Error).name).toBe("AbortError")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a cancel during a back-off pause ends the call at once, with no second attempt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error("socket hang up"))
    const ctrl = new AbortController()
    vi.useFakeTimers()
    try {
      let outcome: unknown = "pending"
      const call = callKie(sonnet55, req(), ctrl.signal).then(
        () => { outcome = "resolved" },
        (e: unknown) => { outcome = e },
      )
      // The first attempt fails and the ladder enters its first (400 ms) pause.
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      ctrl.abort()
      // Microtasks only — no fake time passes, so the pause has NOT elapsed.
      await vi.advanceTimersByTimeAsync(0)
      expect((outcome as Error).name).toBe("AbortError")

      await vi.advanceTimersByTimeAsync(60_000)
      await call
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
      warn.mockRestore()
    }
  })
})

describe("credits_consumed on the response", () => {
  it("is creditsUsd when the reply carried it", async () => {
    fetchMock.mockResolvedValue(kieText("ok", ',"credits_consumed":0.07'))
    const res = await callKie(sonnet55, req())
    expect(res.creditsUsd).toBeCloseTo(0.07 * 0.005, 12)
  })

  it("is absent when the reply carried none", async () => {
    fetchMock.mockResolvedValue(kieText("ok"))
    const res = await callKie(sonnet55, req())
    expect(res.creditsUsd).toBeUndefined()
  })
})

describe("a refusal or a cut-off answer on KIE carries KIE's own charge apart from the estimate", () => {
  const stopped = (stop: string, extra = "") => sse([
    `data: {"type":"content_block_delta","delta":{"text":"no"}}\n`,
    `data: {"type":"message_delta","delta":{"stop_reason":"${stop}"},"usage":{"input_tokens":2,"output_tokens":9}${extra}}\n`,
  ])

  it("a refusal: usage.creditsUsd is KIE's charge when the reply stated it", async () => {
    fetchMock.mockResolvedValue(stopped("refusal", ',"credits_consumed":0.07'))
    const err = await callKie(sonnet55, req({ failOnRefusal: true })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmContentRefusalError)
    expect((err as LlmContentRefusalError).usage.creditsUsd).toBeCloseTo(0.07 * 0.005, 12)
  })

  it("a refusal with no stated charge: no creditsUsd (providerCost is then only the rate-table guess)", async () => {
    fetchMock.mockResolvedValue(stopped("refusal"))
    const err = (await callKie(sonnet55, req({ failOnRefusal: true })).catch((e: unknown) => e)) as LlmContentRefusalError
    expect(err.usage.creditsUsd).toBeUndefined()
    expect(err.usage.providerCost).toBeGreaterThan(0)
  })

  it("a cut-off answer: usage.creditsUsd is KIE's charge when the reply stated it", async () => {
    fetchMock.mockResolvedValue(stopped("max_tokens", ',"credits_consumed":0.07'))
    const err = await callKie(sonnet55, req({ maxTokens: 9 })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmOutputTruncatedError)
    expect((err as LlmOutputTruncatedError).usage.creditsUsd).toBeCloseTo(0.07 * 0.005, 12)
  })
})

describe("kieFailureCostUsd / kieInputTokens", () => {
  it("a failure that stated KIE's charge costs that charge", () => {
    expect(kieFailureCostUsd("claude-sonnet-5.5", { inputTokens: 2, outputTokens: 9, providerCost: 0.000001, creditsUsd: 0.0007, complete: true }, 40_000)).toBe(0.0007)
  })

  it("one that did not costs the size estimate — the prompt's size and the reported output — never KIE's input count", () => {
    const usage = { inputTokens: 2, outputTokens: 100, providerCost: 0.000001, complete: true }
    expect(kieFailureCostUsd("claude-sonnet-5.5", usage, 4000)).toBeCloseTo(kieCostUsd("claude-sonnet-5.5", { promptChars: 4000, answerChars: 400 }), 12)
  })

  it("the input token count recorded for a KIE call is the size estimate (chars ÷ 4, rounded up)", () => {
    expect(kieInputTokens(4000)).toBe(1000)
    expect(kieInputTokens(4001)).toBe(1001)
  })
})

describe("thinkingFlag", () => {
  it("is sent when the request asks for it, and not otherwise", () => {
    expect(buildMessagesBody(sonnet55, req({ thinkingFlag: true })).thinkingFlag).toBe(true)
    expect(buildMessagesBody(sonnet55, req())).not.toHaveProperty("thinkingFlag")
  })
})

describe("kieCostUsd", () => {
  it("is KIE's own charge when there is one", () => {
    expect(kieCostUsd("claude-sonnet-5.5", { creditsUsd: 0.0007, promptChars: 40_000, answerChars: 400 })).toBe(0.0007)
  })

  it("estimates from sizes (chars ÷ 4) at the KIE rates when there is none", () => {
    const expected = calculateLlmCost("claude-sonnet-5.5", { inputTokens: 1000, outputTokens: 100 }, "kie")
    expect(kieCostUsd("claude-sonnet-5.5", { promptChars: 4000, answerChars: 400 })).toBeCloseTo(expected, 12)
    expect(expected).toBeGreaterThan(0)
  })
})

describe("requestChars", () => {
  it("counts the system prompt, the schema, text, and a fixed size per image", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } }
    const chars = requestChars(req({
      system: "abcd",
      jsonSchema: { name: "emit", schema },
      messages: [{ role: "user", content: [{ type: "text", text: "12345678" }, { type: "image", url: "https://r2.example/a.png" }] }],
    }))
    expect(chars).toBe(4 + JSON.stringify(schema).length + 8 + KIE_IMAGE_ESTIMATE_CHARS)
  })
})

describe("kieCreditsUsdOf — an /anthropic stream event", () => {
  it.each([
    ["top level", { type: "message_delta", credits_consumed: 0.1 }],
    ["inside usage", { type: "message_delta", usage: { output_tokens: 5, credits_consumed: 0.1 } }],
    ["inside delta", { type: "message_delta", delta: { stop_reason: "end_turn", credits_consumed: 0.1 } }],
  ])("reads credits at the %s", (_label, event) => {
    expect(kieCreditsUsdOf(event)).toBeCloseTo(0.0005, 12)
  })

  it("is undefined when the event carries none", () => {
    expect(kieCreditsUsdOf({ type: "message_delta", usage: { output_tokens: 5 } })).toBeUndefined()
    expect(kieCreditsUsdOf(null)).toBeUndefined()
  })
})

describe("inlineImagesForClaudeKie", () => {
  it("inlines a URL image as base64, keeps base64 and text, and passes a URL through when no inline form fits", async () => {
    prefetchMock.mockImplementation(async (url: string) =>
      url.endsWith("huge.png") ? { type: "image", url } : { type: "image_base64", mediaType: "image/png", data: "QUJD" },
    )
    const out = await inlineImagesForClaudeKie([
      { type: "image", source: { type: "url", url: "https://r2.example/a.png" } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "WFla" } },
      { type: "image", source: { type: "url", url: "https://r2.example/huge.png" } },
      { type: "text", text: "judge these" },
    ])
    expect(out).toEqual([
      { type: "image_base64", mediaType: "image/png", data: "QUJD" },
      { type: "image_base64", mediaType: "image/jpeg", data: "WFla" },
      { type: "image", url: "https://r2.example/huge.png" },
      { type: "text", text: "judge these" },
    ])
    expect(prefetchMock).toHaveBeenCalledTimes(2)
  })

  it("hands the caller's signal to every prefetch", async () => {
    prefetchMock.mockImplementation(async () => ({ type: "image_base64", mediaType: "image/png", data: "QUJD" }))
    const ctrl = new AbortController()
    await inlineImagesForClaudeKie([{ type: "image", source: { type: "url", url: "https://r2.example/a.png" } }], ctrl.signal)
    expect(prefetchMock).toHaveBeenCalledWith("https://r2.example/a.png", ctrl.signal)
  })
})
