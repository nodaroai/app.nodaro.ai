import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"

// Backend workflow-run parity for the downstream character-element injection: a
// held-prop wired into a Character that feeds a Generate Image node must surface
// INSIDE that character's identity bullet (canonical-fallback path — the
// user-reported case), NOT appended at the prompt tail. Mirrors the frontend
// build-image-assemble-input-element-injection integration test.

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}
function edge(source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null }
}

describe("payload-builder: character-borne held-prop rides the identity bullet", () => {
  it("weaves a wired held-prop into the character's bullet, not the prompt tail", () => {
    const character = node("char-1", "character", {
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira-source.png",
      canonicalDescription: "young woman, brown eyes, auburn hair, athletic build",
      defaultAssetUrl: "https://r2/kira-portrait.png",
    })
    const heldProp = node("hp-1", "held-prop", { heldProp: "smartphone" })
    const generateImage = node("gen-1", "generate-image", {
      prompt: "a woman in a cafe",
      provider: "nano-banana-pro",
    })
    const nodes = [character, heldProp, generateImage]
    const edges = [
      edge("hp-1", "char-1", null, "assets"), // prop → character
      edge("char-1", "gen-1"), // character → consumer (no @-mention → canonical fallback)
    ]
    const inputs: ResolvedInputs = { referenceImageUrls: ["https://r2/kira-portrait.png"] }

    const result = buildPayload(generateImage, "job-1", inputs, undefined, { nodes, edges, nodeStates: {} })
    const prompt = result.payload.prompt as string

    // Prop is inside Kira's identity bullet, after her canonical description.
    expect(prompt).toMatch(/- Image 1 \(Kira\) — young woman[^\n]*smartphone/i)
    // ...within the "Use these characters:" directive block (before the body).
    const blockEnd = prompt.indexOf("\n\n")
    const block = blockEnd === -1 ? prompt : prompt.slice(0, blockEnd)
    expect(block).toMatch(/smartphone/i)
    // ...and the user's body prose still follows the block.
    expect(prompt).toContain("a woman in a cafe")
    // CRITICAL: exactly ONCE — bullet only, NOT also appended to the tail (the
    // generate-image case excludes the cinematography char-element fold). Guards
    // against the double-injection the opt-out flag prevents.
    expect((prompt.match(/smartphone/gi) || []).length).toBe(1)
  })

  it("edit-image (non-bullet) appends the held-prop to its edit prompt (no bullet, so tail is correct)", () => {
    const character = node("char-1", "character", {
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira-source.png",
      canonicalDescription: "young woman, brown eyes",
      defaultAssetUrl: "https://r2/kira-portrait.png",
    })
    const heldProp = node("hp-1", "held-prop", { heldProp: "smartphone" })
    const editImage = node("ei-1", "edit-image", { prompt: "make it sunset", provider: "nano-banana-edit" })
    const nodes = [character, heldProp, editImage]
    const edges = [edge("hp-1", "char-1", null, "assets"), edge("char-1", "ei-1")]
    const inputs: ResolvedInputs = { imageUrl: "https://r2/base.png", prompt: "make it sunset" }

    const result = buildPayload(editImage, "job-2", inputs, undefined, { nodes, edges, nodeStates: {} })
    const prompt = result.payload.prompt as string
    // No "Use these characters:" bullet on edit-image — the element is appended
    // to the edit instruction (the only sensible placement). Preserves the
    // behavior the prior flat fold provided; not a silent regression.
    expect(prompt).toMatch(/smartphone/i)
    expect(prompt).toContain("make it sunset")
  })
})
