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
    // Provider-less prompt segments are now tinted (variables/snippets); a plain
    // prompt with neither yields a single user span. The contract that survives
    // is the join-guard, not emptiness — assert the decomposition reconstructs
    // the text (was `[]` under the pre-tinting implementation).
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
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

describe("useFinalPromptSegments — provider-less tinting (variables + snippets)", () => {
  // The provider-less branch (most video/audio/script/llm-chat/composition/input
  // panels) must now tint resolved {variables} and inserted snippets over the
  // flat field text — mirroring how the branch composes `promptText` — while
  // always keeping the absolute join-guard: segments reconstruct the text or we
  // fall back to `[]` (the view renders plainText). These cases exercise the
  // branch with NO `provider` set.

  it("(a) tints a {Variable} + a snippet, with join === promptText", () => {
    // {Var} resolves to "a knight" (variable origin) and the literal text carries
    // an inserted snippet "golden hour" (snippet origin). No provider → flat path.
    const nodes = [
      { id: "n1", type: "speech-to-video", position: { x: 0, y: 0 }, data: {} },
      {
        id: "src",
        type: "text-prompt",
        position: { x: 0, y: 0 },
        data: { label: "Hero", text: "a knight" },
      },
    ] as never[]
    const edges = [{ id: "e", source: "src", target: "n1" }] as never[]
    const snippets: SnippetPoolItem[] = [
      { id: "gh", name: "Golden Hour", text: "golden hour", target: "prompt", category: "Lighting", source: "factory" },
    ]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "{Hero} in golden hour",
        consumerNodeId: "n1",
        nodes,
        edges,
        // no provider → flat fallback path
        snippets,
      }),
    )
    // Variable + snippet origins both present.
    const variableSeg = result.current.promptSegments.find((s) => s.origin === "variable")
    expect(variableSeg?.text).toBe("a knight")
    const snippetSeg = result.current.promptSegments.find((s) => s.origin === "snippet")
    expect(snippetSeg?.text).toBe("golden hour")
    // Absolute join-guard: the tinted decomposition reconstructs the flat text.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
    // And the assembled text is the resolved prose.
    expect(result.current.promptText).toBe("a knight in golden hour")
  })

  it("(b) appends a trailing style-origin segment when a style is set", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        style: "noir",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        // no provider → flat fallback path
      }),
    )
    const styleSeg = result.current.promptSegments.find((s) => s.origin === "style")
    expect(styleSeg?.text).toContain("Style:")
    // The style segment is the trailing one and starts with the newline-joiner.
    const last = result.current.promptSegments[result.current.promptSegments.length - 1]
    expect(last.origin).toBe("style")
    expect(last.text.startsWith("\nStyle: ")).toBe(true)
    // Join-guard holds with the style suffix folded in.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })

  it("(c) join invariant holds on every representative provider-less input", () => {
    // A constructed mismatch path is hard to trigger deliberately, so instead we
    // assert the join invariant across a spread of provider-less shapes — any
    // divergence would mean a wrong decomposition shipped (the guard would have
    // collapsed it to [] → plainText, which still satisfies the empty case).
    const nodes = [
      { id: "n1", type: "speech-to-video", position: { x: 0, y: 0 }, data: {} },
      { id: "src", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Hero", text: "a knight" } },
    ] as never[]
    const edges = [{ id: "e", source: "src", target: "n1" }] as never[]
    const snippets: SnippetPoolItem[] = [
      { id: "gh", name: "Golden Hour", text: "golden hour", target: "prompt", category: "Lighting", source: "factory" },
    ]
    const cases: Parameters<typeof useFinalPromptSegments>[0][] = [
      { userPrompt: "plain text only", consumerNodeId: "n1", nodes, edges },
      { userPrompt: "{Hero} fights", consumerNodeId: "n1", nodes, edges },
      { userPrompt: "a knight in golden hour", consumerNodeId: "n1", nodes, edges, snippets },
      { userPrompt: "{Hero} in golden hour", consumerNodeId: "n1", nodes, edges, snippets },
      { userPrompt: "{Hero}", style: "noir", consumerNodeId: "n1", nodes, edges },
      { userPrompt: "", style: "noir", consumerNodeId: "n1", nodes, edges },
      { userPrompt: "{Nope} literal", consumerNodeId: "n1", nodes, edges },
    ]
    for (const args of cases) {
      const { result } = renderHook(() => useFinalPromptSegments(args))
      const segs = result.current.promptSegments
      if (segs.length > 0) {
        expect(segs.map((s) => s.text).join(""), `prompt=${JSON.stringify(args.userPrompt)}`).toBe(
          result.current.promptText,
        )
      }
    }
  })

  it("(d) negative: variable + snippet tinting, join === negativeText", () => {
    const nodes = [
      { id: "n1", type: "speech-to-video", position: { x: 0, y: 0 }, data: {} },
      { id: "src", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Banned", text: "watermark" } },
    ] as never[]
    const edges = [{ id: "e", source: "src", target: "n1" }] as never[]
    const negativeSnippets: SnippetPoolItem[] = [
      { id: "bl", name: "Blur Scrub", text: "blurry", target: "negative", category: "Negative", source: "factory" },
    ]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        negativePrompt: "{Banned}, blurry",
        consumerNodeId: "n1",
        nodes,
        edges,
        // no provider → flat fallback path
        negativeSnippets,
      }),
    )
    // No provider → routing stays null, but the negative is still tinted.
    expect(result.current.negativeRouting).toBeNull()
    const variableSeg = result.current.negativeSegments.find((s) => s.origin === "variable")
    expect(variableSeg?.text).toBe("watermark")
    const snippetSeg = result.current.negativeSegments.find((s) => s.origin === "snippet")
    expect(snippetSeg?.text).toBe("blurry")
    // Join-guard vs negativeText (== resolvedNeg).
    expect(result.current.negativeSegments.map((s) => s.text).join("")).toBe(result.current.negativeText)
    expect(result.current.negativeText).toBe("watermark, blurry")
  })

  it("plain text with no variables/snippets/style still tints (single user span), join holds", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "just a plain prompt",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        // no provider → flat fallback path
      }),
    )
    expect(result.current.promptText).toBe("just a plain prompt")
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe("just a plain prompt")
    // No non-user origins → the view shows no legend (presentational concern),
    // but the segments still reconstruct the text.
  })
})
