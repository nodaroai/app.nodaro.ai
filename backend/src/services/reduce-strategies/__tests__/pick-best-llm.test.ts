import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("../../../lib/llm-client", () => ({
  llmComplete: vi.fn(),
}))

const { llmComplete } = await import("../../../lib/llm-client")
const { execute } = await import("../pick-best-llm")

const ctx = { userId: "u1", jobId: "j1", logger: console as any }

describe("pick-best-llm strategy", () => {
  beforeEach(() => {
    vi.mocked(llmComplete).mockReset()
  })

  it("calls llmComplete with claude-sonnet-4.6 (which routes via direct Anthropic SDK fallback)", async () => {
    vi.mocked(llmComplete).mockResolvedValue({
      text: `{"chosen_index": 2, "reasoning": "sharper detail"}`,
      model: "claude-sonnet-4.6",
    } as any)

    await execute(["alpha", "beta", "gamma"], { criteria: "sharper", inputKind: "text" }, ctx)

    const callArg = vi.mocked(llmComplete).mock.calls[0][0]
    // Per @nodaro/shared llm-models.ts, "claude-sonnet-4.6" has
    // directFallbackModel: "claude-sonnet-4-6", so llmComplete() will route
    // via the direct Anthropic SDK (which supports image content blocks)
    // rather than the KIE proxy. Asserting on modelId is sufficient — the
    // routing is a property of the model registry, not the request.
    expect(callArg.modelId).toBe("claude-sonnet-4.6")
  })

  it("returns chosen item with selectedIndex (LLM 1-based → meta 0-based)", async () => {
    vi.mocked(llmComplete).mockResolvedValue({
      text: `{"chosen_index": 2, "reasoning": "sharper detail"}`,
      model: "claude-sonnet-4.6",
    } as any)

    const out = await execute(["a", "b", "c"], { criteria: "x", inputKind: "text" }, ctx)
    expect(out.result).toBe("b")
    expect(out.meta.selectedIndex).toBe(1)
    expect(out.meta.reasoning).toBe("sharper detail")
  })

  it("filters empty strings before judging (indices in LLM prompt reflect survivors)", async () => {
    vi.mocked(llmComplete).mockResolvedValue({
      text: `{"chosen_index": 1, "reasoning": "ok"}`,
      model: "claude-sonnet-4.6",
    } as any)

    const out = await execute(["", "a", "", "b"], { criteria: "x", inputKind: "text" }, ctx)
    expect(out.result).toBe("a")
    expect(out.meta.selectedIndex).toBe(1)
  })

  it("falls back to first survivor on malformed LLM JSON", async () => {
    vi.mocked(llmComplete).mockResolvedValue({
      text: "not json",
      model: "claude-sonnet-4.6",
    } as any)

    const out = await execute(["a", "b"], { criteria: "x", inputKind: "text" }, ctx)
    expect(out.result).toBe("a")
    expect(out.meta.reasoning).toMatch(/fallback/i)
  })

  it("falls back to first survivor when chosen_index is out of range", async () => {
    vi.mocked(llmComplete).mockResolvedValue({
      text: `{"chosen_index": 99, "reasoning": "out of range"}`,
      model: "claude-sonnet-4.6",
    } as any)

    const out = await execute(["a", "b"], { criteria: "x", inputKind: "text" }, ctx)
    expect(out.result).toBe("a")
    expect(out.meta.reasoning).toMatch(/fallback/i)
  })

  it("throws EmptyInputError when all items are empty", async () => {
    const { EmptyInputError } = await import("../types")
    await expect(execute(["", ""], { criteria: "x", inputKind: "text" }, ctx))
      .rejects.toBeInstanceOf(EmptyInputError)
  })

  it("sends image content blocks for inputKind: image-url", async () => {
    vi.mocked(llmComplete).mockResolvedValue({
      text: `{"chosen_index": 1, "reasoning": "ok"}`,
      model: "claude-sonnet-4.6",
    } as any)

    await execute(
      ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      { criteria: "x", inputKind: "image-url" },
      ctx,
    )

    const callArg = vi.mocked(llmComplete).mock.calls[0][0]
    const userMsg = callArg.messages.find((m: any) => m.role === "user")
    expect(userMsg).toBeDefined()
    const content = userMsg!.content
    expect(Array.isArray(content)).toBe(true)
    const imageBlocks = (content as any[]).filter((b) => b.type === "image")
    expect(imageBlocks).toHaveLength(2)
    // Per LlmContentBlock in lib/llm-client.ts, image blocks are flat
    // { type: "image", url: string } — the { source: { type: "url", url } }
    // SDK shape is built later by buildAnthropicMessages() inside llmComplete.
    expect(imageBlocks[0]).toEqual({ type: "image", url: "https://example.com/a.jpg" })
    expect(imageBlocks[1]).toEqual({ type: "image", url: "https://example.com/b.jpg" })
  })
})
