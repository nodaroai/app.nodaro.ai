/**
 * Describe-first: each image is described by the turn's model on KIE with no
 * tools — inlined, in parallel, capped, the turn's cancel and its own
 * deadline on each call, a failure left undescribed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ callKie: vi.fn(), prefetch: vi.fn() }))
vi.mock("@/lib/llm/kie-lane.js", () => ({ callKie: h.callKie }))
vi.mock("@/lib/anthropic-image.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/anthropic-image.js")>()),
  prefetchAsBase64: h.prefetch,
}))

const { describeImageUrls, DESCRIBE_IMAGE_SYSTEM } = await import("../kie-vision.js")
const { kieCostUsd, requestChars } = await import("../../../lib/llm/kie-cost.js")
const { LLM_CONTENT_REFUSAL_MESSAGE, LlmContentRefusalError } = await import("../../../lib/llm-errors.js")

const answer = (text: string, creditsUsd?: number) => ({
  text, usage: { inputTokens: 2, outputTokens: 30 }, model: "claude-sonnet-5", lane: "kie", ...(creditsUsd !== undefined ? { creditsUsd } : {}),
})

beforeEach(() => {
  h.callKie.mockReset()
  h.prefetch.mockReset()
  h.prefetch.mockImplementation(async (url: string) => ({ type: "image_base64", mediaType: "image/png", data: `b64:${url}` }))
})

describe("describeImageUrls", () => {
  it("asks KIE with no tools and no schema, the image inlined, on the tier's model", async () => {
    h.callKie.mockResolvedValue(answer("A red square.", 0.001))
    const out = await describeImageUrls("claude-sonnet-5", ["https://r2.example/a.png"])
    const [model, req, signal] = h.callKie.mock.calls[0]! as [{ id: string }, Record<string, unknown> & { messages: Array<{ content: unknown[] }> }, AbortSignal]
    expect(model.id).toBe("claude-sonnet-5")
    expect(req.system).toBe(DESCRIBE_IMAGE_SYSTEM)
    expect(req).not.toHaveProperty("jsonSchema")
    expect(req.messages[0]!.content[0]).toEqual({ type: "image_base64", mediaType: "image/png", data: "b64:https://r2.example/a.png" })
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(out.descriptions.get("https://r2.example/a.png")).toBe("A red square.")
    expect(out).toMatchObject({ attempted: 1, costUsd: 0.001 })
  })

  it("the turn's cancel reaches each call", async () => {
    h.callKie.mockResolvedValue(answer("x"))
    const ctrl = new AbortController()
    await describeImageUrls("claude-sonnet-5", ["https://r2.example/a.png"], { signal: ctrl.signal })
    const signal = h.callKie.mock.calls[0]![2] as AbortSignal
    expect(signal.aborted).toBe(false)
    ctrl.abort()
    expect(signal.aborted).toBe(true)
  })

  it("the turn's cancel reaches the image prefetch too", async () => {
    h.callKie.mockResolvedValue(answer("x"))
    const ctrl = new AbortController()
    await describeImageUrls("claude-sonnet-5", ["https://r2.example/a.png"], { signal: ctrl.signal })
    expect(h.prefetch).toHaveBeenCalledWith("https://r2.example/a.png", ctrl.signal)
  })

  it("runs the descriptions in parallel", async () => {
    const resolvers: Array<(v: unknown) => void> = []
    h.callKie.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)))
    const pending = describeImageUrls("claude-sonnet-5", ["https://r2.example/a.png", "https://r2.example/b.png"])
    await vi.waitFor(() => expect(h.callKie).toHaveBeenCalledTimes(2))
    for (const resolve of resolvers) resolve(answer("x"))
    await pending
  })

  it("describes each URL once and at most `limit` of them", async () => {
    h.callKie.mockResolvedValue(answer("x"))
    const urls = ["https://r2.example/1.png", "https://r2.example/1.png", ...[2, 3, 4, 5].map((i) => `https://r2.example/${i}.png`)]
    const out = await describeImageUrls("claude-sonnet-5", urls, { limit: 4 })
    expect(h.callKie).toHaveBeenCalledTimes(4)
    expect(out.attempted).toBe(4)
    expect(out.descriptions.has("https://r2.example/5.png")).toBe(false)
  })

  it("leaves a failed image undescribed, and the rest go on", async () => {
    h.callKie.mockRejectedValueOnce(new Error("KIE 503")).mockResolvedValueOnce(answer("A cat."))
    const out = await describeImageUrls("claude-sonnet-5", ["https://r2.example/a.png", "https://r2.example/b.png"])
    expect(out.descriptions.has("https://r2.example/a.png")).toBe(false)
    expect(out.descriptions.get("https://r2.example/b.png")).toBe("A cat.")
  })

  it("an image that could not be inlined is not described — KIE is not asked, and it stays could-not-be-read", async () => {
    // prefetchAsBase64's fallback: a URL block (fetch failed, blocked, undecodable or still too large).
    h.prefetch.mockImplementation(async (url: string) =>
      url.endsWith("a.png") ? { type: "image", url } : { type: "image_base64", mediaType: "image/png", data: `b64:${url}` },
    )
    h.callKie.mockResolvedValue(answer("I don't see an image attached."))
    const out = await describeImageUrls("claude-sonnet-5", ["https://r2.example/a.png", "https://r2.example/b.png"])
    expect(h.callKie).toHaveBeenCalledTimes(1)
    expect((h.callKie.mock.calls[0]![1] as { messages: Array<{ content: Array<{ type: string }> }> }).messages[0]!.content[0]!.type).toBe("image_base64")
    expect(out.descriptions.has("https://r2.example/a.png")).toBe(false)
    expect(out.descriptions.has("https://r2.example/b.png")).toBe(true)
    expect(out.attempted).toBe(2)
  })

  it("a refusal is a failure, not a description", async () => {
    h.callKie.mockRejectedValueOnce(
      new LlmContentRefusalError(`${LLM_CONTENT_REFUSAL_MESSAGE} (kie)`, { inputTokens: 2, outputTokens: 8, providerCost: 0.0002, complete: true }),
    )
    const out = await describeImageUrls("claude-sonnet-5", ["https://r2.example/a.png"])
    // The flag is what makes KIE's refusal a throw instead of an answer.
    expect((h.callKie.mock.calls[0]![1] as { failOnRefusal?: boolean }).failOnRefusal).toBe(true)
    expect(out.descriptions.size).toBe(0)
    // No stated charge: the size estimate, never the rate-table figure from KIE's input count.
    const req = h.callKie.mock.calls[0]![1]
    expect(out.costUsd).toBeCloseTo(kieCostUsd("claude-sonnet-5", { promptChars: requestChars(req), answerChars: 8 * 4 }), 12)
  })

  it("a billed failure that stated KIE's charge costs that charge", async () => {
    h.callKie.mockRejectedValueOnce(
      new LlmContentRefusalError(`${LLM_CONTENT_REFUSAL_MESSAGE} (kie)`, { inputTokens: 2, outputTokens: 8, providerCost: 0.0000001, creditsUsd: 0.0002, complete: true }),
    )
    const out = await describeImageUrls("claude-sonnet-5", ["https://r2.example/a.png"])
    expect(out.costUsd).toBe(0.0002)
  })

  it("costs a description with no stated charge by its size at KIE rates", async () => {
    h.callKie.mockResolvedValue(answer("A red square."))
    const out = await describeImageUrls("claude-sonnet-5", ["https://r2.example/a.png"])
    const req = h.callKie.mock.calls[0]![1]
    expect(out.costUsd).toBeCloseTo(kieCostUsd("claude-sonnet-5", { promptChars: requestChars(req), answerChars: "A red square.".length }), 12)
  })
})
