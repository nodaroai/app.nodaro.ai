import { describe, it, expect, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useFinalPromptSegments } from "../use-final-prompt-segments"
import { buildImageAssembleInput } from "../build-image-assemble-input"
import { assembleImageInput } from "@nodaro/prompts"
import type { SnippetPoolItem } from "@/lib/snippet-pool"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

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

// A graph containing ONLY the consumer image node (id "n1"). The Phase-2 image
// path routes through `buildImageAssembleInput`, which reads `node.data` and
// builds connected references from the graph — so the consumer node must exist
// in `nodes` (production always satisfies this). Tests that previously used the
// node-less `EMPTY_GRAPH` on the IMAGE path now use this so the image branch
// runs (a truly absent consumer node intentionally falls through to the
// provider-less path — see the hook's `if (consumerNode)` guard).
const IMAGE_ONLY_GRAPH = {
  nodes: [{ id: "n1", type: "generate-image", position: { x: 0, y: 0 }, data: {} }] as never[],
  edges: [] as never[],
}

describe("useFinalPromptSegments — negativeRouting", () => {
  it("is null when there is no negative prompt", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        consumerNodeId: "n1",
        ...IMAGE_ONLY_GRAPH,
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
        ...IMAGE_ONLY_GRAPH,
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
        ...IMAGE_ONLY_GRAPH,
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
        ...IMAGE_ONLY_GRAPH,
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
        ...IMAGE_ONLY_GRAPH,
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
        ...IMAGE_ONLY_GRAPH,
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
        ...IMAGE_ONLY_GRAPH,
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

describe("useFinalPromptSegments — video-aware negative routing (videoProvider)", () => {
  // The provider-less path now serves video panels: pass `videoProvider` and the
  // hook PREDICTS the backend's video negative routing via the SAME shared helper
  // the pipeline uses (`applyVideoNegativePrompt`). These run against the real
  // helper (no mocks) — kling = native (Wan/Kling families), veo3 = appended.

  it("native video provider (kling): routing 'native', NO Avoid tail, copy keeps the negative line", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight riding",
        negativePrompt: "blurry, low quality",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        videoProvider: "kling",
      }),
    )
    expect(result.current.negativeRouting).toBe("native")
    // Kling takes negative_prompt natively → the prompt is NOT modified.
    expect(result.current.promptText).toBe("a knight riding")
    expect(result.current.promptText).not.toContain("Avoid:")
    // Resolved negative is shown in both routings.
    expect(result.current.negativeText).toBe("blurry, low quality")
    // No `negative`-origin segment is appended to the prompt on the native path.
    expect(result.current.promptSegments.find((s) => s.origin === "negative")).toBeUndefined()
    // copyText keeps the "Negative prompt: …" line convention (native routing).
    expect(result.current.copyText).toContain("Negative prompt: blurry, low quality")
    // Join-guard holds.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })

  it("non-native video provider (veo3): routing 'appended', promptText ends with the Avoid tail + trailing negative segment", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight riding",
        negativePrompt: "blurry, low quality",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        videoProvider: "veo3",
      }),
    )
    expect(result.current.negativeRouting).toBe("appended")
    // veo3 has no native negative field → folded into the prompt as `\nAvoid: …`.
    expect(result.current.promptText).toBe("a knight riding\nAvoid: blurry, low quality")
    expect(result.current.promptText.endsWith("\nAvoid: blurry, low quality")).toBe(true)
    // The resolved negative is still shown in the negative field's view.
    expect(result.current.negativeText).toBe("blurry, low quality")
    // The trailing segment carries ONLY the appended tail, tagged `negative`.
    const last = result.current.promptSegments[result.current.promptSegments.length - 1]
    expect(last.origin).toBe("negative")
    expect(last.text).toBe("\nAvoid: blurry, low quality")
    // Absolute join invariant on the video path: segments reconstruct promptText.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
    // copyText carries the prompt (Avoid folded in) and does NOT re-append the
    // negative as a separate line (it already rides along in promptText).
    expect(result.current.copyText).toBe("a knight riding\nAvoid: blurry, low quality")
  })

  it("no negative → routing null even with a videoProvider set", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight riding",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        videoProvider: "veo3",
      }),
    )
    expect(result.current.negativeRouting).toBeNull()
    expect(result.current.promptText).toBe("a knight riding")
    expect(result.current.promptText).not.toContain("Avoid:")
  })

  it("join invariant holds on the appended video path with {variables} + snippets in the prompt", () => {
    // {Hero} resolves to "a knight" (variable) and an inserted "golden hour"
    // snippet (snippet); veo3 then folds the negative into the prompt as an
    // Avoid tail (negative). All three origins coexist and the decomposition
    // MUST still reconstruct the final promptText (Avoid tail included).
    const nodes = [
      // The Phase-3 video path composes via `assembleVideoPrompt`, which reads
      // `node.data.prompt` (production always passes `userPrompt: data.prompt`,
      // so they're the same value) — keep the fixture faithful to that.
      { id: "n1", type: "text-to-video", position: { x: 0, y: 0 }, data: { prompt: "{Hero} in golden hour" } },
      { id: "src", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Hero", text: "a knight" } },
    ] as never[]
    const edges = [{ id: "e", source: "src", target: "n1" }] as never[]
    const snippets: SnippetPoolItem[] = [
      { id: "gh", name: "Golden Hour", text: "golden hour", target: "prompt", category: "Lighting", source: "factory" },
    ]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "{Hero} in golden hour",
        negativePrompt: "blurry",
        consumerNodeId: "n1",
        nodes,
        edges,
        videoProvider: "veo3",
        snippets,
      }),
    )
    expect(result.current.negativeRouting).toBe("appended")
    // Body resolves + tints; Avoid tail appended.
    expect(result.current.promptText).toBe("a knight in golden hour\nAvoid: blurry")
    const variableSeg = result.current.promptSegments.find((s) => s.origin === "variable")
    expect(variableSeg?.text).toBe("a knight")
    const snippetSeg = result.current.promptSegments.find((s) => s.origin === "snippet")
    expect(snippetSeg?.text).toBe("golden hour")
    const negSeg = result.current.promptSegments.find((s) => s.origin === "negative")
    expect(negSeg?.text).toBe("\nAvoid: blurry")
    // Absolute join invariant: variable + snippet + negative spans reconstruct it.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })

  it("(Phase 3) i2v with {Var} + a Person cinematography node: promptText folds BOTH; segments carry picker + variable spans", () => {
    // The Phase-3 video branch composes via the run's shared `assembleVideoPrompt`,
    // so the preview matches the payload: the {Subject} variable resolves AND the
    // wired Person (cinematography) hint folds in with the run's ". " join. The
    // colour then locates both fragments in the FINAL string.
    const nodes = [
      // i2v consumer — prompt lives on node.data (production passes userPrompt: data.prompt).
      { id: "n1", type: "image-to-video", position: { x: 0, y: 0 }, data: { prompt: "a {Subject} walking" } },
      // Variable source wired into the consumer (resolves {Subject} → "samurai").
      { id: "var", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Subject", text: "samurai" } },
      // Person cinematography node on the `look` handle. `buildPersonHints` emits
      // `preText` verbatim → a deterministic hint decoupled from catalog drift.
      { id: "look", type: "person", position: { x: 0, y: 0 }, data: { label: "Person", preText: "shot on 85mm, shallow depth of field" } },
    ] as never[]
    const edges = [
      { id: "ev", source: "var", target: "n1" },
      { id: "el", source: "look", target: "n1", targetHandle: "look" },
    ] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a {Subject} walking",
        consumerNodeId: "n1",
        nodes,
        edges,
        videoProvider: "seedance-2-fast",
      }),
    )
    // Both the resolved variable AND the cinematography hint are in the prompt,
    // joined exactly as the run does (body ". " hint-list).
    expect(result.current.promptText).toBe("a samurai walking. shot on 85mm, shallow depth of field")
    // The cinematography hint is exposed for the per-hint bullet list.
    expect(result.current.cineHints).toEqual(["shot on 85mm, shallow depth of field"])
    // promptSegments carries a `picker` span (the hint) AND a `variable` span.
    const pickerSeg = result.current.promptSegments.find((s) => s.origin === "picker")
    expect(pickerSeg?.text).toBe("shot on 85mm, shallow depth of field")
    const variableSeg = result.current.promptSegments.find((s) => s.origin === "variable")
    expect(variableSeg?.text).toBe("samurai")
    // Absolute join invariant: tinted spans reconstruct the displayed prompt.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })

  it("ignores videoProvider when the image `provider` is set (image assembly wins)", () => {
    // gpt-image is an image provider that folds the negative into the prompt via
    // buildImagePromptSegments. Passing a native VIDEO provider (kling) alongside
    // must NOT change the routing — the image path owns it.
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        negativePrompt: "blurry",
        consumerNodeId: "n1",
        ...IMAGE_ONLY_GRAPH,
        provider: "gpt-image",
        videoProvider: "kling",
      }),
    )
    // Image path: gpt-image has no native negative → appended (NOT kling's native).
    expect(result.current.negativeRouting).toBe("appended")
    expect(result.current.promptText).toContain("Avoid: blurry")
  })
})

describe("useFinalPromptSegments — Phase 4: audio preview fidelity + colour", () => {
  // Audio config panels pass NEITHER provider NOR videoProvider. The Phase-4
  // audio branch composes the prompt-field via the run's shared
  // `assembleAudioPrompt` (folding connected audio-style hints) and colours the
  // FINAL string. These run against the real shared aggregator (no mocks).

  it("(audio) generate-music with a genre audio-style node + a {Var}: promptText folds the style AND resolves the variable; segments carry picker + variable spans", () => {
    const nodes = [
      // generate-music consumer — prompt lives on node.data (production passes
      // userPrompt: data.prompt, so they're the same value).
      { id: "n1", type: "generate-music", position: { x: 0, y: 0 }, data: { prompt: "a song about {Topic}" } },
      // Variable source wired into the consumer (resolves {Topic} → "the sea").
      { id: "var", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Topic", text: "the sea" } },
      // music-genre audio-style node (folds a genre hint via the audio-style handle).
      { id: "genre", type: "music-genre", position: { x: 0, y: 0 }, data: { label: "Genre", genre: "electronic" } },
    ] as never[]
    const edges = [
      { id: "ev", source: "var", target: "n1" },
      { id: "eg", source: "genre", target: "n1", targetHandle: "audio-style" },
    ] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a song about {Topic}",
        consumerNodeId: "n1",
        nodes,
        edges,
        // no provider / no videoProvider → audio branch
      }),
    )
    // The resolved variable AND the folded audio-style hint are both in the prompt.
    expect(result.current.promptText).toContain("a song about the sea")
    expect(result.current.promptText).toContain("electronic")
    // promptSegments carries a `picker` span (the folded style hint) AND a
    // `variable` span (the resolved {Topic}).
    const pickerSeg = result.current.promptSegments.find((s) => s.origin === "picker")
    expect(pickerSeg?.text).toContain("electronic")
    const variableSeg = result.current.promptSegments.find((s) => s.origin === "variable")
    expect(variableSeg?.text).toBe("the sea")
    // Absolute join invariant: tinted spans reconstruct the displayed prompt.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
    // No negative levers on the audio surface.
    expect(result.current.negativeRouting).toBeNull()
    expect(result.current.negativeText).toBe("")
  })

  it("(audio) generate-music with NO typed prompt but a genre node shows the style text alone", () => {
    const nodes = [
      { id: "n1", type: "generate-music", position: { x: 0, y: 0 }, data: { prompt: "" } },
      { id: "genre", type: "music-genre", position: { x: 0, y: 0 }, data: { label: "Genre", genre: "electronic" } },
    ] as never[]
    const edges = [{ id: "eg", source: "genre", target: "n1", targetHandle: "audio-style" }] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({ userPrompt: "", consumerNodeId: "n1", nodes, edges }),
    )
    expect(result.current.promptText).toContain("electronic")
    // The whole prompt is the folded style hint → a single picker span.
    const pickerSeg = result.current.promptSegments.find((s) => s.origin === "picker")
    expect(pickerSeg?.text).toBe(result.current.promptText)
  })

  it("(audio) Task 3: suno-generate in custom mode now SHOWS the folded style + the prompt body", () => {
    const nodes = [
      { id: "n1", type: "suno-generate", position: { x: 0, y: 0 }, data: { prompt: "a ballad", customMode: true } },
      { id: "genre", type: "music-genre", position: { x: 0, y: 0 }, data: { label: "Genre", genre: "electronic" } },
    ] as never[]
    const edges = [{ id: "eg", source: "genre", target: "n1", targetHandle: "audio-style" }] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({ userPrompt: "a ballad", consumerNodeId: "n1", nodes, edges }),
    )
    // Custom mode → style folds into the STYLE field, which the multi-field
    // preview now renders (previously the prompt-field view dropped it entirely).
    expect(result.current.promptText).toContain("a ballad")
    expect(result.current.promptText).toContain("Style:")
    expect(result.current.promptText).toContain("electronic")
    // The folded picker hint is coloured as a `picker` span wherever it landed.
    const pickerSeg = result.current.promptSegments.find((s) => s.origin === "picker")
    expect(pickerSeg?.text).toContain("electronic")
    // Absolute join invariant holds across the multi-field string.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })

  it("(audio) Task 3 complaint 1: typed style + lyrics + title with an EMPTY prompt are all shown", () => {
    const nodes = [
      { id: "n1", type: "suno-generate", position: { x: 0, y: 0 }, data: { prompt: "", style: "lo-fi", lyrics: "[verse] hi", title: "My Song" } },
    ] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({ userPrompt: "", consumerNodeId: "n1", nodes, edges: [] as never[] }),
    )
    expect(result.current.promptText).toContain("lo-fi")
    expect(result.current.promptText).toContain("[verse] hi")
    expect(result.current.promptText).toContain("My Song")
  })

  it("(audio) Task 3 complaint 4: custom mode + EMPTY prompt + connected picker → preview is NON-empty", () => {
    // The exact empty-preview bug: in custom mode the prompt field is empty and
    // the picker hint went to STYLE, so the OLD prompt-field view rendered "".
    const nodes = [
      { id: "n1", type: "suno-generate", position: { x: 0, y: 0 }, data: { prompt: "", title: "Untitled" } },
      { id: "genre", type: "music-genre", position: { x: 0, y: 0 }, data: { label: "Genre", genre: "electronic" } },
    ] as never[]
    const edges = [{ id: "eg", source: "genre", target: "n1", targetHandle: "audio-style" }] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({ userPrompt: "", consumerNodeId: "n1", nodes, edges }),
    )
    expect(result.current.promptText.length).toBeGreaterThan(0)
    expect(result.current.promptText).toContain("electronic")
    expect(result.current.promptText).toContain("Untitled")
  })

  it("(audio) a pass-through audio node (suno-cover) shows the bare resolved prompt, no fold", () => {
    const nodes = [
      { id: "n1", type: "suno-cover", position: { x: 0, y: 0 }, data: { prompt: "make it jazzy" } },
      // even with a connected style node, pass-through never folds
      { id: "genre", type: "music-genre", position: { x: 0, y: 0 }, data: { label: "Genre", genre: "electronic" } },
    ] as never[]
    const edges = [{ id: "eg", source: "genre", target: "n1", targetHandle: "audio-style" }] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({ userPrompt: "make it jazzy", consumerNodeId: "n1", nodes, edges }),
    )
    expect(result.current.promptText).toBe("make it jazzy")
    expect(result.current.promptText).not.toContain("electronic")
  })

  it("(audio) video-sfx is NOT routed through the audio branch — its negative display is preserved", () => {
    // video-sfx has snippet media "audio" but is OUT of scope: it has a negative
    // lever. It must keep hitting the provider-less fallback (negative shown).
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "explosion sfx",
        negativePrompt: "music",
        consumerNodeId: "n1",
        nodes: [{ id: "n1", type: "video-sfx", position: { x: 0, y: 0 }, data: {} }] as never[],
        edges: [] as never[],
      }),
    )
    expect(result.current.promptText).toBe("explosion sfx")
    // The audio branch would have dropped this to "" — the fallback preserves it.
    expect(result.current.negativeText).toBe("music")
  })

  it("(audio) forced-alignment is NOT routed through the audio branch — its transcript is shown", () => {
    // forced-alignment has media "audio" but its prompt field is `transcript`;
    // the generic assembler would read the wrong field. The fallback shows it.
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "the quick brown fox",
        consumerNodeId: "n1",
        nodes: [{ id: "n1", type: "forced-alignment", position: { x: 0, y: 0 }, data: { transcript: "the quick brown fox" } }] as never[],
        edges: [] as never[],
      }),
    )
    expect(result.current.promptText).toBe("the quick brown fox")
  })
})

describe("useFinalPromptSegments — Phase 2: full-input image preview fidelity + colour", () => {
  // Phase 2 routes the IMAGE preview through the SAME shared assembler the run
  // uses (`assembleImageInput`) with the FULL input set (templates + library
  // defs + ancestor/order/suppression levers), built via
  // `buildImageAssembleInput`. These tests read store slices; reset BEFORE each
  // (pre-render, so no mounted hook re-renders → no act() warning) so a test
  // that sets a template can't leak into the next.
  beforeEach(() => {
    useWorkflowStore.setState({
      userPromptTemplates: {},
      flowPromptTemplates: {},
      characterDefinitions: [],
    })
  })

  it("(a) carries store userPromptTemplates into the assembler (run-parity, no longer dropped)", () => {
    // The OLD path called `buildImagePromptSegments` WITHOUT `userTemplates`, so
    // the preview's assembler input could never reflect a store template. The
    // new path passes them. We assert byte-parity against the SAME shared
    // assembler the run drives, with the templates set — proving the FULL input
    // set is wired (the run passes `userTemplates` at execute-node:1612).
    useWorkflowStore.setState({
      userPromptTemplates: { "character-description": "ZZZ-CUSTOM {name}: {description}." },
    })
    const node = { id: "n1", type: "generate-image", position: { x: 0, y: 0 }, data: { prompt: "a knight" } }
    const nodes = [node] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a knight",
        consumerNodeId: "n1",
        nodes,
        edges: [] as never[],
        provider: "gpt-image",
      }),
    )
    // The hook's assembled text equals the shared assembler fed the same full
    // input set (templates included). Computed inline from the public helper so
    // any future drift between hook and assembler fails here.
    const expected = assembleImageInput(
      buildImageAssembleInput({
        node: node as never,
        nodes,
        edges: [] as never[],
        characterDefinitions: [],
        userPromptTemplates: { "character-description": "ZZZ-CUSTOM {name}: {description}." },
        flowPromptTemplates: {},
        composedPrompt: "a knight",
        provider: "gpt-image",
        styleBypass: false,
      }),
    ).prompt
    expect(result.current.promptText).toBe(expected)
  })

  it("(a2) promptText is a byte-faithful pass-through of the shared assembler (FULL graph input)", () => {
    // The core Phase-2 contract: the image preview's `promptText` is byte-
    // identical to `assembleImageInput(buildImageAssembleInput(<full input>))` —
    // the SAME assembler the run drives — for a node with WIRED references. This
    // pins the hook to the shared assembler: a regression to the old narrowed
    // `buildImagePromptSegments(config)` call (which dropped templates / ancestor
    // refs / order / suppression) would diverge here. With two wired characters,
    // the directive block is non-trivial, so the parity is meaningful.
    const consumer = {
      id: "n1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { prompt: "a duel", referenceOrder: ["char2", "char1"] },
    }
    const char1 = {
      id: "char1",
      type: "character",
      position: { x: 0, y: 0 },
      data: { characterName: "Aria", sourceImageUrl: "https://x/a.png", canonicalDescription: "a brave warrior" },
    }
    const char2 = {
      id: "char2",
      type: "character",
      position: { x: 0, y: 0 },
      data: { characterName: "Borin", sourceImageUrl: "https://x/b.png", canonicalDescription: "a stout dwarf" },
    }
    const nodes = [consumer, char1, char2] as never[]
    const edges = [
      { id: "e1", source: "char1", target: "n1" },
      { id: "e2", source: "char2", target: "n1" },
    ] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a duel",
        consumerNodeId: "n1",
        nodes,
        edges,
        provider: "gpt-image",
      }),
    )
    const expected = assembleImageInput(
      buildImageAssembleInput({
        node: consumer as never,
        nodes,
        edges,
        characterDefinitions: [],
        userPromptTemplates: {},
        flowPromptTemplates: {},
        composedPrompt: "a duel",
        provider: "gpt-image",
        styleBypass: false,
      }),
    ).prompt
    expect(result.current.promptText).toBe(expected)
    // The directive block (the run-faithful reference text) is present.
    expect(result.current.promptText).toContain("Aria")
    expect(result.current.promptText).toContain("Borin")
  })

  it("(b) tints BOTH a variable span AND a mention (reference directive) span", () => {
    // The OLD path collapsed provenance to user/snippet only whenever references
    // rewrote the body. The new tagger locates fragments in the FINAL string, so
    // a {Var} (variable) AND the identity-directive block (mention) both colour.
    const consumer = {
      id: "n1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { prompt: "{Hero} duels @Borin" },
    }
    const hero = {
      id: "srcHero",
      type: "text-prompt",
      position: { x: 0, y: 0 },
      data: { label: "Hero", text: "a knight" },
    }
    const borin = {
      id: "char2",
      type: "character",
      position: { x: 0, y: 0 },
      data: { characterName: "Borin", sourceImageUrl: "https://x/b.png", canonicalDescription: "a stout dwarf" },
    }
    const nodes = [consumer, hero, borin] as never[]
    const edges = [
      { id: "e1", source: "srcHero", target: "n1" },
      { id: "e2", source: "char2", target: "n1" },
    ] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "{Hero} duels @Borin",
        consumerNodeId: "n1",
        nodes,
        edges,
        provider: "gpt-image",
      }),
    )
    // Variable span: {Hero} resolved to "a knight".
    const variableSeg = result.current.promptSegments.find((s) => s.origin === "variable")
    expect(variableSeg?.text).toBe("a knight")
    // Mention span: the reference directive block is present and tagged.
    const mentionSeg = result.current.promptSegments.find((s) => s.origin === "mention")
    expect(mentionSeg).toBeDefined()
    expect(mentionSeg?.text).toContain("Borin")
    // Absolute join invariant always holds (pure partitioning).
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })

  it("(b2) still tints style + appended-negative suffixes alongside references", () => {
    // gpt-image folds style → `\nStyle: …` and the non-native negative → `\nAvoid: …`.
    // Both must still colour (style/negative origins) when a reference is wired.
    const consumer = {
      id: "n1",
      type: "generate-image",
      position: { x: 0, y: 0 },
      data: { prompt: "a duel", style: "noir", negativePrompt: "blurry" },
    }
    const borin = {
      id: "char2",
      type: "character",
      position: { x: 0, y: 0 },
      data: { characterName: "Borin", sourceImageUrl: "https://x/b.png", canonicalDescription: "a stout dwarf" },
    }
    const nodes = [consumer, borin] as never[]
    const edges = [{ id: "e2", source: "char2", target: "n1" }] as never[]
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a duel",
        style: "noir",
        negativePrompt: "blurry",
        consumerNodeId: "n1",
        nodes,
        edges,
        provider: "gpt-image",
      }),
    )
    const styleSeg = result.current.promptSegments.find((s) => s.origin === "style")
    expect(styleSeg?.text).toContain("Style:")
    const negSeg = result.current.promptSegments.find((s) => s.origin === "negative")
    expect(negSeg?.text).toContain("Avoid: blurry")
    expect(result.current.negativeRouting).toBe("appended")
    // Join invariant.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })
})

describe("useFinalPromptSegments — Phase 5: text/LLM node faithfulness (regression lock)", () => {
  // TEXT and LLM nodes (text-prompt, llm-chat, image-to-text, generate-script, etc.)
  // hit the provider-less fallback path: no `provider`, no `videoProvider`, no audio
  // branch. Pure-text nodes have no cinematography/style/refs folding, so the flat
  // path already faithfully represents the run payload. These tests LOCK that contract
  // so a future refactor can't silently break text-family nodes.

  // ── 5A-1: text-prompt node with {Var} ─────────────────────────────────────────
  // A `text-prompt` node whose `text` field contains a `{Var}` reference. The
  // hook resolves it (variable span) and `promptText` equals the resolved text.
  it("(1) text-prompt: {Var} resolves to its source text and a variable span appears", () => {
    // text-prompt is the CONSUMER here (it is itself a node whose `text` field the
    // caller previews). We simulate a second text-prompt acting as the variable
    // source, wired into the consumer just like in the editor. No image/video
    // provider → pure provider-less path.
    const nodes = [
      {
        id: "consumer",
        type: "text-prompt",
        position: { x: 0, y: 0 },
        data: { label: "Consumer", text: "Hello {World}" },
      },
      {
        id: "src",
        type: "text-prompt",
        position: { x: 0, y: 0 },
        data: { label: "World", text: "Planet Earth" },
      },
    ] as never[]
    const edges = [{ id: "e1", source: "src", target: "consumer" }] as never[]

    const { result } = renderHook(() =>
      useFinalPromptSegments({
        // The config panel passes `data.text` as `userPrompt` for text-prompt nodes.
        userPrompt: "Hello {World}",
        consumerNodeId: "consumer",
        nodes,
        edges,
        // No provider → flat provider-less path.
      }),
    )

    // The variable is resolved: {World} → "Planet Earth".
    expect(result.current.promptText).toBe("Hello Planet Earth")
    // A `variable`-origin span appears in the decomposition.
    const variableSeg = result.current.promptSegments.find((s) => s.origin === "variable")
    expect(variableSeg).toBeDefined()
    expect(variableSeg?.text).toBe("Planet Earth")
    // Absolute join-guard: the tinted spans reconstruct the displayed text.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
    // No negative / routing on a plain text node.
    expect(result.current.negativeRouting).toBeNull()
    expect(result.current.negativeText).toBe("")
  })

  // ── 5A-2a: llm-chat systemPrompt field ────────────────────────────────────────
  // `llm-chat-config.tsx` calls the hook TWICE — once for `data.systemPrompt` and
  // once for `data.userInput` — each as a separate `useFinalPromptSegments` call
  // with that field as `userPrompt`. Assert that a {variable} in `systemPrompt`
  // is resolved and tinted correctly (the hook is field-agnostic; node type is
  // irrelevant on the provider-less path).
  it("(2a) llm-chat systemPrompt: {Var} resolves and produces a variable span", () => {
    const nodes = [
      {
        id: "chat",
        type: "llm-chat",
        position: { x: 0, y: 0 },
        data: { label: "Chat", systemPrompt: "You are a {Role}" },
      },
      {
        id: "roleNode",
        type: "text-prompt",
        position: { x: 0, y: 0 },
        data: { label: "Role", text: "helpful assistant" },
      },
    ] as never[]
    const edges = [{ id: "e1", source: "roleNode", target: "chat" }] as never[]

    const { result } = renderHook(() =>
      useFinalPromptSegments({
        // Mirrors llm-chat-config.tsx line 115: userPrompt: data.systemPrompt
        userPrompt: "You are a {Role}",
        consumerNodeId: "chat",
        nodes,
        edges,
      }),
    )

    expect(result.current.promptText).toBe("You are a helpful assistant")
    const variableSeg = result.current.promptSegments.find((s) => s.origin === "variable")
    expect(variableSeg?.text).toBe("helpful assistant")
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })

  // ── 5A-2b: llm-chat userInput field ───────────────────────────────────────────
  // The second hook call in `llm-chat-config.tsx` (line 121) previews `data.userInput`.
  // Same contract: {Var} must resolve and produce a `variable` span.
  it("(2b) llm-chat userInput: {Var} resolves and produces a variable span", () => {
    const nodes = [
      {
        id: "chat",
        type: "llm-chat",
        position: { x: 0, y: 0 },
        data: { label: "Chat", userInput: "Summarise {Topic}" },
      },
      {
        id: "topicNode",
        type: "text-prompt",
        position: { x: 0, y: 0 },
        data: { label: "Topic", text: "renewable energy" },
      },
    ] as never[]
    const edges = [{ id: "e1", source: "topicNode", target: "chat" }] as never[]

    const { result } = renderHook(() =>
      useFinalPromptSegments({
        // Mirrors llm-chat-config.tsx line 122: userPrompt: data.userInput
        userPrompt: "Summarise {Topic}",
        consumerNodeId: "chat",
        nodes,
        edges,
      }),
    )

    expect(result.current.promptText).toBe("Summarise renewable energy")
    const variableSeg = result.current.promptSegments.find((s) => s.origin === "variable")
    expect(variableSeg?.text).toBe("renewable energy")
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })

  // ── 5A-3: snippet in a text node's prompt ──────────────────────────────────────
  // A snippet present in a text node's prompt → a `snippet`-origin span appears
  // in `promptSegments`. This exercises the snippet post-pass on the provider-less
  // path, locking it for text-family consumers (generate-script, image-to-text,
  // llm-chat all have a snippet menu attached to their prompt field in production).
  it("(3) text-prompt: an inserted snippet fragment produces a snippet span", () => {
    const snippets: SnippetPoolItem[] = [
      {
        id: "cinematic",
        name: "Cinematic Style",
        text: "cinematic lighting",
        target: "prompt",
        category: "Lighting",
        source: "factory",
      },
    ]

    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "a portrait with cinematic lighting",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
        // No provider → flat provider-less path.
        snippets,
      }),
    )

    // `promptText` is the literal resolved prompt (no variables → unchanged).
    expect(result.current.promptText).toBe("a portrait with cinematic lighting")
    // The snippet text is present as a `snippet`-origin span.
    const snippetSeg = result.current.promptSegments.find((s) => s.origin === "snippet")
    expect(snippetSeg).toBeDefined()
    expect(snippetSeg?.text).toBe("cinematic lighting")
    // Absolute join-guard: no text is lost or duplicated.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })

  // ── 5A bonus: unresolved {Var} stays literal (no undefined injection) ───────
  // A {Label} reference with NO matching upstream node must pass through as-is
  // (the resolved text equals the raw text). This guards against a regression
  // where an unresolved variable could leave `undefined` in the output.
  it("(bonus) unresolved {Var} passes through as literal text, no undefined in output", () => {
    const { result } = renderHook(() =>
      useFinalPromptSegments({
        userPrompt: "describe {NonExistent}",
        consumerNodeId: "n1",
        ...EMPTY_GRAPH,
      }),
    )

    // No upstream node → variable stays unreplaced.
    expect(result.current.promptText).toBe("describe {NonExistent}")
    expect(result.current.promptText).not.toContain("undefined")
    // Join-guard.
    expect(result.current.promptSegments.map((s) => s.text).join("")).toBe(result.current.promptText)
  })
})
