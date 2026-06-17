import { describe, it, expect, beforeEach, vi } from "vitest"
import { resolveFacetInjections } from "../character-facet-extract.js"
import { llmCompleteStructured } from "../llm-client.js"

vi.mock("../llm-client.js", () => ({ llmCompleteStructured: vi.fn() }))

/** llmCompleteStructured returns already-validated output — mock that contract. */
function mockExtract(facetText: string) {
  vi.mocked(llmCompleteStructured).mockResolvedValueOnce({
    output: { facetText },
    inputTokens: 1,
    outputTokens: 1,
    providerCost: 0.0001,
  } as never)
}

describe("resolveFacetInjections", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns empty string for undefined / empty input (no LLM call)", async () => {
    expect(await resolveFacetInjections(undefined)).toBe("")
    expect(await resolveFacetInjections([])).toBe("")
    expect(llmCompleteStructured).not.toHaveBeenCalled()
  })

  it("injects the full source text verbatim for the 'full' facet (no LLM call)", async () => {
    const out = await resolveFacetInjections([
      { sourceText: "A tall woman with curly red hair", facet: "full" },
    ])
    expect(out).toBe("A tall woman with curly red hair")
    expect(llmCompleteStructured).not.toHaveBeenCalled()
  })

  it("injects verbatim for an unknown facet id (defensive, no LLM call)", async () => {
    const out = await resolveFacetInjections([
      { sourceText: "A tall woman with curly red hair", facet: "not-a-real-facet" },
    ])
    expect(out).toBe("A tall woman with curly red hair")
    expect(llmCompleteStructured).not.toHaveBeenCalled()
  })

  it("LLM-extracts a named facet (hair) and returns the extracted phrase", async () => {
    mockExtract("curly red hair, shoulder-length")
    const out = await resolveFacetInjections([
      { sourceText: "A tall woman with curly red hair wearing a green dress", facet: "hair" },
    ])
    expect(out).toBe("curly red hair, shoulder-length")
    expect(llmCompleteStructured).toHaveBeenCalledTimes(1)
  })

  it("falls back to the full source text when the LLM returns an empty extract", async () => {
    mockExtract("   ")
    const out = await resolveFacetInjections([
      { sourceText: "A man in a blue coat", facet: "hair" },
    ])
    expect(out).toBe("A man in a blue coat")
  })

  it("falls back to the full source text when the LLM throws (never blocks generation)", async () => {
    vi.mocked(llmCompleteStructured).mockRejectedValueOnce(new Error("llm down"))
    const out = await resolveFacetInjections([
      { sourceText: "A man in a blue coat", facet: "skin-tone" },
    ])
    expect(out).toBe("A man in a blue coat")
  })

  it("skips blank source text", async () => {
    const out = await resolveFacetInjections([
      { sourceText: "   ", facet: "hair" },
      { sourceText: "", facet: "full" },
    ])
    expect(out).toBe("")
    expect(llmCompleteStructured).not.toHaveBeenCalled()
  })

  it("comma-joins multiple injections preserving input order", async () => {
    // index 0 → hair (LLM), index 1 → full (verbatim), index 2 → skin-tone (LLM).
    // Mock keyed on the source text so the result is independent of the order in
    // which the parallel extractions resolve.
    vi.mocked(llmCompleteStructured).mockImplementation(async (req) => {
      const content = req.messages[0].content as string
      const facetText = content.includes("char one") ? "short black hair" : "warm olive skin"
      return { output: { facetText }, inputTokens: 1, outputTokens: 1, providerCost: 0.0001 } as never
    })
    const out = await resolveFacetInjections([
      { sourceText: "char one description", facet: "hair" },
      { sourceText: "a leather jacket", facet: "full" },
      { sourceText: "char two description", facet: "skin-tone" },
    ])
    expect(out).toBe("short black hair, a leather jacket, warm olive skin")
  })
})
