import { describe, it, expect } from "vitest"
import { resolveCharacterAssets } from "../node-input-resolver"

// Element/asset injection (P1): text producers + element pickers wired into a
// character node's `assets` handle compose one injected-assets string at
// generation time. Wiring is the source of truth; order is deterministic
// (ascending source id). Picker resolution goes through getParameterPromptHint
// (covered by its own tests), so these focus on the resolver's compose logic.
const char = { id: "char1" }

describe("resolveCharacterAssets", () => {
  it("returns '' when nothing is wired to the assets handle", () => {
    expect(resolveCharacterAssets(char, [], [])).toBe("")
  })

  it("ignores edges to other handles (e.g. the 'in'/Prompt handle)", () => {
    const edges = [{ source: "t1", target: "char1", targetHandle: "in" }]
    const nodes = [{ id: "t1", type: "text-prompt", data: { text: "ignored" } }]
    expect(resolveCharacterAssets(char, edges, nodes)).toBe("")
  })

  it("injects a text producer's output text", () => {
    const edges = [{ source: "t1", target: "char1", targetHandle: "assets" }]
    const nodes = [{ id: "t1", type: "text-prompt", data: { text: "wearing a leather jacket" } }]
    expect(resolveCharacterAssets(char, edges, nodes)).toBe("wearing a leather jacket")
  })

  it("composes multiple sources in deterministic source-id order", () => {
    const edges = [
      { source: "b", target: "char1", targetHandle: "assets" },
      { source: "a", target: "char1", targetHandle: "assets" },
    ]
    const nodes = [
      { id: "a", type: "text-prompt", data: { text: "AAA" } },
      { id: "b", type: "text-prompt", data: { text: "BBB" } },
    ]
    expect(resolveCharacterAssets(char, edges, nodes)).toBe("AAA, BBB")
  })

  it("skips sources that resolve to empty/whitespace text", () => {
    const edges = [
      { source: "a", target: "char1", targetHandle: "assets" },
      { source: "b", target: "char1", targetHandle: "assets" },
    ]
    const nodes = [
      { id: "a", type: "text-prompt", data: { text: "   " } },
      { id: "b", type: "text-prompt", data: { text: "kept" } },
    ]
    expect(resolveCharacterAssets(char, edges, nodes)).toBe("kept")
  })

  it("resolves an element picker via its prompt hint without throwing", () => {
    const edges = [{ source: "p1", target: "char1", targetHandle: "assets" }]
    const nodes = [{ id: "p1", type: "styling", data: {} }]
    expect(typeof resolveCharacterAssets(char, edges, nodes)).toBe("string")
  })
})
