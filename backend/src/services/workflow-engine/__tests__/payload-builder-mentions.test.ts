import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"

// ---------------------------------------------------------------------------
// Helpers (mirror payload-builder.test.ts)
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
  }
}

// ---------------------------------------------------------------------------
// Character upstream → @-mention expansion for generate-image / image-to-image
//
// Mirrors the frontend's `execute-node.ts` expansion: each wired character
// upstream contributes a canonical entry plus one entry per asset variant
// (expressions/poses/motions/angles/bodyAngles/lighting). Drives @-mention
// resolution in `buildImagePrompt` (Phase 0).
// ---------------------------------------------------------------------------

describe("payload-builder: character @-mention expansion", () => {
  const jobId = "job-1"

  function charNode(id: string, extra: Record<string, unknown> = {}): SimpleNode {
    return node(id, "character", {
      label: "Kira",
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira-source.png",
      description: "young woman with warm smile",
      canonicalDescription:
        "young woman, brown eyes, auburn shoulder-length hair, athletic build",
      defaultAssetUrl: "https://r2/kira-portrait.png",
      expressions: [
        { name: "smile", url: "https://r2/kira-smile.png" },
      ],
      poses: [],
      motions: [],
      angles: [],
      bodyAngles: [],
      lightingVariations: [],
      ...extra,
    })
  }

  it("expands a wired character into canonical + variant connectedReferences for generate-image", () => {
    const character = charNode("char-1")
    const generateImage = node("gen-1", "generate-image", {
      prompt: "make her dance, @kira:1:smile",
      provider: "nano-banana-pro",
    })
    const nodes = [character, generateImage]
    const edges = [edge("char-1", "gen-1")]
    const inputs: ResolvedInputs = {
      referenceImageUrls: ["https://r2/kira-portrait.png"],
    }

    const result = buildPayload(
      generateImage,
      jobId,
      inputs,
      undefined,
      { nodes, edges, nodeStates: {} },
    )

    expect(result.jobName).toBe("generate-image")
    // The smile variant URL must appear in the outgoing reference list — proves
    // the @kira:1:smile token resolved via the expanded connectedReferences.
    const refs = result.payload.referenceImageUrls as string[] | undefined
    expect(refs).toBeDefined()
    expect(refs).toContain("https://r2/kira-smile.png")
    // The variant description should have been folded into the prompt via the
    // shared buildImagePrompt mention-resolution pass.
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("Kira")
    // Token itself is replaced (not left literal).
    expect(prompt).not.toMatch(/@kira:1:smile\b/)
    // Numeric image index from the typed slug surfaces in the directive.
    expect(prompt).toContain("Image 1 (Kira)")
  })

  it("resolves @kira:1 (no variant) to canonical URL", () => {
    const character = charNode("char-1")
    const generateImage = node("gen-1", "generate-image", {
      prompt: "feature @kira:1 prominently",
      provider: "nano-banana-pro",
    })
    const nodes = [character, generateImage]
    const edges = [edge("char-1", "gen-1")]
    const inputs: ResolvedInputs = {
      referenceImageUrls: ["https://r2/kira-portrait.png"],
    }

    const result = buildPayload(
      generateImage,
      jobId,
      inputs,
      undefined,
      { nodes, edges, nodeStates: {} },
    )

    const refs = result.payload.referenceImageUrls as string[] | undefined
    expect(refs).toBeDefined()
    expect(refs).toContain("https://r2/kira-portrait.png")
    const prompt = result.payload.prompt as string
    // Canonical description must appear (proves the canonical entry was built
    // with characterCanonicalDescription).
    expect(prompt).toContain("auburn shoulder-length hair")
  })

  it("works for image-to-image too", () => {
    const character = charNode("char-1")
    const i2i = node("i2i-1", "image-to-image", {
      prompt: "transform into @kira:1:smile",
      provider: "flux-i2i",
      imageUrl: "https://r2/main.png",
    })
    const nodes = [character, i2i]
    const edges = [edge("char-1", "i2i-1")]
    const inputs: ResolvedInputs = {
      referenceImageUrls: ["https://r2/kira-portrait.png"],
    }

    const result = buildPayload(
      i2i,
      jobId,
      inputs,
      undefined,
      { nodes, edges, nodeStates: {} },
    )

    expect(result.jobName).toBe("image-to-image")
    const refs = result.payload.referenceImageUrls as string[] | undefined
    expect(refs).toBeDefined()
    expect(refs).toContain("https://r2/kira-smile.png")
  })

  it("falls back to generic wired upstream when character has no name", () => {
    // Unnamed character → expansion is skipped, falls through to plain ref.
    const character = node("char-1", "character", {
      label: "",
      characterName: "",
      sourceImageUrl: "https://r2/unnamed.png",
      defaultAssetUrl: "",
      expressions: [],
      poses: [],
      motions: [],
      angles: [],
      bodyAngles: [],
      lightingVariations: [],
    })
    const generateImage = node("gen-1", "generate-image", {
      prompt: "a portrait",
      provider: "nano-banana-pro",
    })
    const nodes = [character, generateImage]
    const edges = [edge("char-1", "gen-1")]
    const inputs: ResolvedInputs = {
      referenceImageUrls: ["https://r2/unnamed.png"],
    }

    const result = buildPayload(
      generateImage,
      jobId,
      inputs,
      undefined,
      { nodes, edges, nodeStates: {} },
    )

    // No crash — falls through to plain reference handling.
    expect(result.jobName).toBe("generate-image")
    const refs = result.payload.referenceImageUrls as string[] | undefined
    expect(refs).toBeDefined()
    expect(refs?.length).toBeGreaterThan(0)
  })

  it("skips variants with missing url or unslug-able name", () => {
    const character = charNode("char-1", {
      expressions: [
        { name: "smile", url: "https://r2/kira-smile.png" },
        { name: "no-url-variant", url: "" },           // missing url
        { name: "   ", url: "https://r2/blank.png" },   // empty slug
      ],
    })
    const generateImage = node("gen-1", "generate-image", {
      prompt: "test @kira:1:smile",
      provider: "nano-banana-pro",
    })
    const nodes = [character, generateImage]
    const edges = [edge("char-1", "gen-1")]
    const inputs: ResolvedInputs = {
      referenceImageUrls: ["https://r2/kira-portrait.png"],
    }

    const result = buildPayload(
      generateImage,
      jobId,
      inputs,
      undefined,
      { nodes, edges, nodeStates: {} },
    )

    // The smile URL is present; the bogus entries don't crash anything.
    const refs = result.payload.referenceImageUrls as string[] | undefined
    expect(refs).toBeDefined()
    expect(refs).toContain("https://r2/kira-smile.png")
  })
})
