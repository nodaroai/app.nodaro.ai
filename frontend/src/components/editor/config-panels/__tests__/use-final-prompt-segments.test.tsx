import { describe, it, expect } from "vitest"
import { renderHook } from "@testing-library/react"
import { useFinalPromptSegments } from "../use-final-prompt-segments"
import type { SnippetPoolItem } from "@/lib/snippet-pool"

/**
 * Focused tests for the extracted assembly hook — the single source of assembly
 * truth for every prompt/negative field's final view. Empty graph → empty ref
 * map, so these run against the real shared prompt builder with no mocks.
 *
 * Two groups:
 *  - `negativeRouting`: the routing tag + the negative-display contract (the
 *    resolved negative shows in BOTH native AND appended routings, tinted).
 *  - assembly provenance + byte-exact copy: ported from the PR-3 segments suite
 *    (deleted in Task 4 when the standalone preview block was removed) — the
 *    assertions move from the rendered spans to the hook's structured output
 *    (the spans themselves are covered presentationally by the field-view test).
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
    // Spec: the negative field's final view shows the RESOLVED negative input
    // in BOTH routings (the caption explains where it goes). So even when the
    // builder folds it into the prompt as an `Avoid:` suffix, the negative
    // display text equals the resolved input and its segments are non-empty.
    expect(result.current.promptText).toContain("Avoid: blurry")
    expect(result.current.negativeText).toBe("blurry")
    expect(result.current.negativeSegments.map((s) => s.text).join("")).toBe("blurry")
  })

  it("tints {variables} in the negative display on the appended routing", () => {
    // A negative referencing an upstream node label resolves the variable AND
    // tags it, in the appended routing — proving the negative final-view carries
    // provenance tints (not just plain text) regardless of routing.
    const nodes = [
      { id: "n1", type: "generate-image", position: { x: 0, y: 0 }, data: {} },
      {
        id: "src",
        type: "text-prompt",
        position: { x: 0, y: 0 },
        data: { label: "Banned", text: "watermark" },
      },
    ] as never[]
    const edges = [{ id: "e", source: "src", target: "n1" }] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        negativePrompt: "{Banned}",
        consumerNodeId: "n1",
        nodes,
        edges,
        provider: "gpt-image",
      }),
    )
    expect(result.current.negativeRouting).toBe("appended")
    // Resolved + tinted: the {Banned} ref expands to "watermark" in a variable span.
    expect(result.current.negativeText).toBe("watermark")
    const variableSeg = result.current.negativeSegments.find((s) => s.origin === "variable")
    expect(variableSeg?.text).toBe("watermark")
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

describe("useFinalPromptSegments — assembly provenance + copy (ported from PR-3)", () => {
  it("tags the style + negative suffixes as style/negative-origin prompt spans (gpt-image)", () => {
    // gpt-image folds the negative into the prompt as an `\nAvoid:` suffix and
    // translates the style into a `\nStyle:` suffix — both are origin-tagged in
    // the prompt segments (was asserted on rendered spans in the legacy suite).
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        style: "noir",
        negativePrompt: "blurry",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        provider: "gpt-image",
      }),
    )
    const styleSeg = result.current.promptSegments.find((s) => s.origin === "style")
    expect(styleSeg?.text).toContain("Style:")
    const negSeg = result.current.promptSegments.find((s) => s.origin === "negative")
    expect(negSeg?.text).toContain("Avoid: blurry")
  })

  it("tints an inserted snippet fragment inside the user prose (amber/snippet origin)", () => {
    const snippets: SnippetPoolItem[] = [
      { id: "gh", name: "Golden Hour", text: "golden hour", target: "prompt", category: "Lighting", source: "factory" },
    ]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight in golden hour",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        provider: "gpt-image",
        snippets,
      }),
    )
    const snippetSeg = result.current.promptSegments.find((s) => s.origin === "snippet")
    expect(snippetSeg?.text).toBe("golden hour")
  })

  it("copyText is the byte-exact plain assembled string (style + Avoid folded in)", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        style: "noir",
        negativePrompt: "blurry",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        provider: "gpt-image",
      }),
    )
    // Exactly the builder's plain prompt (gpt-image folds style + Avoid in); the
    // negative is NOT re-appended as a "Negative prompt:" line because it's
    // already in the prompt. No span markup leaks into the payload.
    expect(result.current.copyText).toBe(
      "a knight\nStyle: film noir style, high-contrast black-and-white imagery, deep shadows, venetian-blind lighting and moody 1940s cinema feel\nAvoid: blurry",
    )
    expect(result.current.copyText).not.toContain("<")
    expect(result.current.copyText).not.toContain("bg-")
  })

  it("appends a native negative as a 'Negative prompt:' copyText line (imagen4)", () => {
    // For a native-negative provider the builder does NOT fold the negative into
    // the prompt, so copyText carries it on its own line (legacy copy contract).
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        negativePrompt: "blurry",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        provider: "imagen4",
      }),
    )
    expect(result.current.copyText).toContain("Negative prompt: blurry")
  })
})
