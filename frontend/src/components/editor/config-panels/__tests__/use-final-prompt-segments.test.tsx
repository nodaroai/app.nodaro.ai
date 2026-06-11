import { describe, it, expect } from "vitest"
import { renderHook } from "@testing-library/react"
import { useFinalPromptSegments } from "../use-final-prompt-segments"

/**
 * Focused tests for the extracted assembly hook. The end-to-end provenance +
 * byte-exact copy behavior is already covered by `final-prompt-preview-segments`
 * (which renders FinalPromptPreview, now a thin hook consumer). Here we lock the
 * ONE piece of logic the extraction added on top of the moved memo:
 * `negativeRouting` ("native" | "appended" | null). Empty graph → empty ref map,
 * so these run against the real shared builder with no mocks (same convention).
 */

const EMPTY_GRAPH = { nodes: [] as never[], edges: [] as never[] }

describe("useFinalPromptSegments — negativeRouting", () => {
  it("is null when there is no negative prompt", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        provider: "gpt-image",
      }),
    )
    expect(result.current.negativeRouting).toBeNull()
    expect(result.current.negativeText).toBe("")
  })

  it("is 'native' for a provider that takes negative_prompt natively (imagen4)", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        negativePrompt: "blurry",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        provider: "imagen4",
      }),
    )
    expect(result.current.negativeRouting).toBe("native")
    // Native providers surface the negative as its own text (not folded in).
    expect(result.current.negativeText).toBe("blurry")
  })

  it("is 'appended' for a provider that folds the negative into the prompt (gpt-image)", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        negativePrompt: "blurry",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        provider: "gpt-image",
      }),
    )
    expect(result.current.negativeRouting).toBe("appended")
    // Folded into the prompt as an Avoid: suffix; no separate native text.
    expect(result.current.negativeText).toBe("")
    expect(result.current.promptText).toContain("Avoid: blurry")
  })

  it("is null on the provider-less path even when a negative is present", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        negativePrompt: "blurry",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        // no provider → flat fallback path
      }),
    )
    expect(result.current.negativeRouting).toBeNull()
    // Provider-less surfaces still expose the resolved negative text (flat).
    expect(result.current.negativeText).toBe("blurry")
    expect(result.current.promptSegments).toEqual([])
  })
})
