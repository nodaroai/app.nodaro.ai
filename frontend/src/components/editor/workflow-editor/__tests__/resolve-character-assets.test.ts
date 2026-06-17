import { describe, it, expect } from "vitest"
import { resolveCharacterAssets } from "../node-input-resolver"

// Element/asset injection: everything wired into a character node's `assets`
// handle resolves into two channels at generation time —
//   • injectedAssets  — text/dynamic producers + element pickers, whole fragment (P1)
//   • facetInjections — identity/character sources, { sourceText, facet } for
//                       server-side facet extraction (P2)
// Wiring is the source of truth; order within each channel is deterministic
// (ascending source id). Picker resolution goes through getParameterPromptHint
// (its own tests); these focus on the resolver's compose + split logic.
const char = { id: "char1" }

describe("resolveCharacterAssets", () => {
  it("returns empty channels when nothing is wired to the assets handle", () => {
    expect(resolveCharacterAssets(char, [], [])).toEqual({ injectedAssets: "", facetInjections: [] })
  })

  it("ignores edges to unrelated handles (not in/assets)", () => {
    const edges = [{ source: "t1", target: "char1", targetHandle: "characterRef" }]
    const nodes = [{ id: "t1", type: "text-prompt", data: { text: "ignored" } }]
    expect(resolveCharacterAssets(char, edges, nodes)).toEqual({ injectedAssets: "", facetInjections: [] })
  })

  it("reads a text producer on the 'in'/Prompt handle too (both handles inject)", () => {
    const edges = [{ source: "t1", target: "char1", targetHandle: "in" }]
    const nodes = [{ id: "t1", type: "text-prompt", data: { text: "wearing a red scarf" } }]
    const r = resolveCharacterAssets(char, edges, nodes)
    expect(r.injectedAssets).toBe("wearing a red scarf")
    expect(r.facetInjections).toEqual([])
  })

  it("combines 'in' and 'assets' text fragments in source-id order", () => {
    const edges = [
      { source: "z-assets", target: "char1", targetHandle: "assets" },
      { source: "a-prompt", target: "char1", targetHandle: "in" },
    ]
    const nodes = [
      { id: "a-prompt", type: "text-prompt", data: { text: "from prompt" } },
      { id: "z-assets", type: "text-prompt", data: { text: "from assets" } },
    ]
    // a-prompt < z-assets by source id → prompt fragment first
    expect(resolveCharacterAssets(char, edges, nodes).injectedAssets).toBe("from prompt, from assets")
  })

  // ── P1: text / picker → injectedAssets ──────────────────────────────────
  it("injects a text producer's output text into injectedAssets", () => {
    const edges = [{ source: "t1", target: "char1", targetHandle: "assets" }]
    const nodes = [{ id: "t1", type: "text-prompt", data: { text: "wearing a leather jacket" } }]
    const r = resolveCharacterAssets(char, edges, nodes)
    expect(r.injectedAssets).toBe("wearing a leather jacket")
    expect(r.facetInjections).toEqual([])
  })

  it("composes multiple text sources in deterministic source-id order", () => {
    const edges = [
      { source: "b", target: "char1", targetHandle: "assets" },
      { source: "a", target: "char1", targetHandle: "assets" },
    ]
    const nodes = [
      { id: "a", type: "text-prompt", data: { text: "AAA" } },
      { id: "b", type: "text-prompt", data: { text: "BBB" } },
    ]
    expect(resolveCharacterAssets(char, edges, nodes).injectedAssets).toBe("AAA, BBB")
  })

  it("skips text sources that resolve to empty/whitespace text", () => {
    const edges = [
      { source: "a", target: "char1", targetHandle: "assets" },
      { source: "b", target: "char1", targetHandle: "assets" },
    ]
    const nodes = [
      { id: "a", type: "text-prompt", data: { text: "   " } },
      { id: "b", type: "text-prompt", data: { text: "kept" } },
    ]
    expect(resolveCharacterAssets(char, edges, nodes).injectedAssets).toBe("kept")
  })

  it("resolves an element picker via its prompt hint into injectedAssets", () => {
    const edges = [{ source: "p1", target: "char1", targetHandle: "assets" }]
    const nodes = [{ id: "p1", type: "styling", data: {} }]
    const r = resolveCharacterAssets(char, edges, nodes)
    expect(typeof r.injectedAssets).toBe("string")
    expect(r.facetInjections).toEqual([])
  })

  // ── P2: identity / character → facetInjections ──────────────────────────
  it("emits a facetInjection for a character source (default 'full' facet)", () => {
    const edges = [{ source: "src", target: "char1", targetHandle: "assets" }]
    const nodes = [
      { id: "char1", type: "character", data: {} },
      { id: "src", type: "character", data: { canonicalDescription: "a tall woman with red hair" } },
    ]
    const r = resolveCharacterAssets(char, edges, nodes)
    expect(r.injectedAssets).toBe("")
    expect(r.facetInjections).toEqual([{ sourceText: "a tall woman with red hair", facet: "full" }])
  })

  it("uses the facet chosen on the consumer's assetInjections", () => {
    const edges = [{ source: "src", target: "char1", targetHandle: "assets" }]
    const nodes = [
      { id: "char1", type: "character", data: { assetInjections: [{ sourceNodeId: "src", facet: "hair" }] } },
      { id: "src", type: "character", data: { canonicalDescription: "curly red hair, green dress" } },
    ]
    expect(resolveCharacterAssets(char, edges, nodes).facetInjections).toEqual([
      { sourceText: "curly red hair, green dress", facet: "hair" },
    ])
  })

  it("prefers canonicalDescription over description for the facet source text", () => {
    const edges = [{ source: "src", target: "char1", targetHandle: "assets" }]
    const nodes = [
      { id: "char1", type: "character", data: {} },
      { id: "src", type: "object", data: { canonicalDescription: "canonical", description: "fallback" } },
    ]
    expect(resolveCharacterAssets(char, edges, nodes).facetInjections[0].sourceText).toBe("canonical")
  })

  it("falls back to description when canonicalDescription is absent", () => {
    const edges = [{ source: "src", target: "char1", targetHandle: "assets" }]
    const nodes = [
      { id: "char1", type: "character", data: {} },
      { id: "src", type: "location", data: { description: "a foggy harbor at dawn" } },
    ]
    expect(resolveCharacterAssets(char, edges, nodes).facetInjections[0].sourceText).toBe("a foggy harbor at dawn")
  })

  it("skips an identity source with no description yet (ungenerated likeness)", () => {
    const edges = [{ source: "src", target: "char1", targetHandle: "assets" }]
    const nodes = [
      { id: "char1", type: "character", data: {} },
      { id: "src", type: "character", data: {} },
    ]
    expect(resolveCharacterAssets(char, edges, nodes).facetInjections).toEqual([])
  })

  it("splits mixed wiring: text → injectedAssets, character → facetInjections", () => {
    const edges = [
      { source: "txt", target: "char1", targetHandle: "assets" },
      { source: "chr", target: "char1", targetHandle: "assets" },
    ]
    const nodes = [
      { id: "char1", type: "character", data: { assetInjections: [{ sourceNodeId: "chr", facet: "skin-tone" }] } },
      { id: "txt", type: "text-prompt", data: { text: "in a trench coat" } },
      { id: "chr", type: "character", data: { canonicalDescription: "warm olive skin" } },
    ]
    const r = resolveCharacterAssets(char, edges, nodes)
    expect(r.injectedAssets).toBe("in a trench coat")
    expect(r.facetInjections).toEqual([{ sourceText: "warm olive skin", facet: "skin-tone" }])
  })
})
