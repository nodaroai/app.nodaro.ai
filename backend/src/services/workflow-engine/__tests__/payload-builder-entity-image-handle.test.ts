import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { resolveEffectiveSourceType } from "@nodaro/shared"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}
function edge(source: string, target: string, sourceHandle: string | null): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle, targetHandle: null }
}
function charNode(id: string): SimpleNode {
  return node(id, "character", {
    label: "Kira",
    characterName: "Kira",
    sourceImageUrl: "https://r2/kira-source.png",
    canonicalDescription: "young woman, auburn shoulder-length hair, athletic build",
    expressions: [], poses: [], motions: [], angles: [], bodyAngles: [], lightingVariations: [],
  })
}
const PORTRAIT = "https://r2/kira-portrait.png"

function genImagePromptFor(sourceHandle: string | null): { prompt: string; refs: string[] | undefined } {
  const character = charNode("char-1")
  const gen = node("gen-1", "generate-image", { prompt: "feature @kira:1 prominently", provider: "nano-banana-pro" })
  const inputs: ResolvedInputs = { referenceImageUrls: [PORTRAIT] }
  const result = buildPayload(gen, "job-1", inputs, undefined, {
    nodes: [character, gen],
    edges: [edge("char-1", "gen-1", sourceHandle)],
    nodeStates: {},
  })
  return { prompt: result.payload.prompt as string, refs: result.payload.referenceImageUrls as string[] | undefined }
}

describe("payload-builder: entity image handle parity (Gap B)", () => {
  it("shares the single source of truth with the frontend", () => {
    expect(resolveEffectiveSourceType("character", "image")).toBe("upload-image")
    expect(resolveEffectiveSourceType("location", "image")).toBe("upload-image")
    expect(resolveEffectiveSourceType("character", "characterRef")).toBe("character")
  })

  it("characterRef handle → identity (canonical description) injected into the prompt", () => {
    const { prompt } = genImagePromptFor("characterRef")
    expect(prompt).toContain("auburn shoulder-length hair")
  })

  it("image handle → NO identity in the prompt, portrait still delivered as a plain ref", () => {
    const { prompt, refs } = genImagePromptFor("image")
    expect(prompt).not.toContain("auburn shoulder-length hair")
    expect(refs).toContain(PORTRAIT)
  })
})
