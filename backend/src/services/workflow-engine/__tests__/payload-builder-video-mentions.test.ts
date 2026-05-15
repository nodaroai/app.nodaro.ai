import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Video payload-builder: @-mention resolution + per-character default fallback
//
// Frontend / backend parity contract:
//   - wired character @-mentioned (`@kira:1:smile`) → ONLY variant URL in
//     payload (no canonical auto-attach).
//   - wired character NOT @-mentioned → canonical URL in payload + strong
//     identity directive in prompt (pre-mention "wire it = use it" behavior).
// ---------------------------------------------------------------------------

describe("payload-builder video paths: @-mention resolution", () => {
  const jobId = "job-1"

  describe("image-to-video", () => {
    it("resolves @kira:1:smile and slots the variant URL into imageUrl when no upstream image is wired", () => {
      const character = charNode("char-1")
      const i2v = node("i2v-1", "image-to-video", {
        prompt: "@kira:1:smile dances in a forest",
        provider: "kling",
      })
      const nodes = [character, i2v]
      const edges = [edge("char-1", "i2v-1")]
      // No upstream image — only the character is wired.
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        i2v,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      expect(result.jobName).toBe("image-to-video")
      // First mention URL fills the missing imageUrl slot.
      expect(result.payload.imageUrl).toBe("https://r2/kira-smile.png")
      // The prompt now has "Kira" instead of the literal token.
      const prompt = result.payload.prompt as string
      expect(prompt).toContain("Kira")
      expect(prompt).not.toMatch(/@kira:1:smile\b/)
      // Canonical description ride-along (first mention emits the long bio).
      expect(prompt).toContain("auburn shoulder-length hair")
      // Numeric index from the typed slug surfaces in the directive.
      expect(prompt).toContain("Image 1 (Kira)")
    })

    it("preserves upstream imageUrl and routes the mention URL into referenceImageUrls", () => {
      const character = charNode("char-1")
      const i2v = node("i2v-1", "image-to-video", {
        prompt: "@kira:1:smile pose in the rain",
        provider: "kling",
      })
      const nodes = [character, i2v]
      const edges = [edge("char-1", "i2v-1")]
      // Upstream image already present — preserve it.
      const inputs: ResolvedInputs = {
        imageUrl: "https://r2/user-uploaded.png",
      }

      const result = buildPayload(
        i2v,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      // Upstream image won — mention URL went to referenceImageUrls.
      expect(result.payload.imageUrl).toBe("https://r2/user-uploaded.png")
      const refs = result.payload.referenceImageUrls as string[] | undefined
      expect(refs).toBeDefined()
      expect(refs).toContain("https://r2/kira-smile.png")
      // Canonical NOT attached because the character was @-mentioned.
      expect(refs).not.toContain("https://r2/kira-portrait.png")
    })

    it("falls back to canonical URL when character is wired but not @-mentioned (parity with frontend)", () => {
      const character = charNode("char-1")
      const i2v = node("i2v-1", "image-to-video", {
        prompt: "a calm forest at dawn",
        provider: "kling",
      })
      const nodes = [character, i2v]
      const edges = [edge("char-1", "i2v-1")]
      // No upstream image — only the character is wired (no @-mention).
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        i2v,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      // Canonical URL fills the missing imageUrl slot (default fallback).
      expect(result.payload.imageUrl).toBe("https://r2/kira-portrait.png")
      const prompt = result.payload.prompt as string
      // Strong directive prepended for the unmentioned wired character.
      expect(prompt).toContain("Use these characters:")
      expect(prompt).toContain("auburn shoulder-length hair")
      expect(prompt).toMatch(/Match exactly\. Maintain perfect likeness/)
      // No literal `@-mention` ever appeared, so the body is unchanged.
      expect(prompt).toContain("a calm forest at dawn")
    })

    it("leaves prompt body untouched when there are no mentions AND no wired character", () => {
      const i2v = node("i2v-1", "image-to-video", {
        prompt: "a dog runs through a park",
        provider: "kling",
      })
      const nodes = [i2v]
      const edges: SimpleEdge[] = []
      const inputs: ResolvedInputs = {
        imageUrl: "https://r2/dog.png",
      }

      const result = buildPayload(
        i2v,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      expect(result.payload.imageUrl).toBe("https://r2/dog.png")
      const prompt = result.payload.prompt as string
      expect(prompt.startsWith("a dog runs through a park")).toBe(true)
      // No mention → no "Use these characters:" header.
      expect(prompt).not.toContain("Use these characters:")
    })

    it("applies canonical fallback when prompt is empty AND character is wired (no typed text)", () => {
      // Parity test: a wired Character with NO typed prompt should still get
      // the canonical fallback block prepended. Before the fix,
      // `resolveVideoPromptMentions` bailed early when `prompt` was empty,
      // dropping the fallback. Now it treats `""` as the working prompt and
      // assembles the canonical block on top of it.
      const character = charNode("char-1")
      const i2v = node("i2v-1", "image-to-video", {
        // No prompt typed.
        provider: "kling",
      })
      const nodes = [character, i2v]
      const edges = [edge("char-1", "i2v-1")]
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        i2v,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      // Canonical URL fills the imageUrl slot.
      expect(result.payload.imageUrl).toBe("https://r2/kira-portrait.png")
      const prompt = result.payload.prompt as string
      // Canonical fallback directive must appear even with empty user input.
      expect(prompt).toContain("Use these characters:")
      expect(prompt).toContain("auburn shoulder-length hair")
      expect(prompt).toMatch(/Match exactly\. Maintain perfect likeness/)
    })
  })

  describe("text-to-video", () => {
    it("resolves @kira:1 (no variant) and appends the canonical URL to referenceImageUrls", () => {
      const character = charNode("char-1")
      const t2v = node("t2v-1", "text-to-video", {
        prompt: "@kira:1 walks across a desert",
        provider: "kling",
      })
      const nodes = [character, t2v]
      const edges = [edge("char-1", "t2v-1")]
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        t2v,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      expect(result.jobName).toBe("text-to-video")
      const refs = result.payload.referenceImageUrls as string[] | undefined
      expect(refs).toBeDefined()
      // @kira:1 (no variant) → canonical / defaultAssetUrl.
      expect(refs).toContain("https://r2/kira-portrait.png")
      const prompt = result.payload.prompt as string
      expect(prompt).toContain("Kira")
      expect(prompt).not.toMatch(/@kira:1\b/)
      // Canonical description directive should be prepended.
      expect(prompt).toContain("auburn shoulder-length hair")
    })

    it("dedupes mention URLs against existing referenceImageUrls", () => {
      const character = charNode("char-1")
      const t2v = node("t2v-1", "text-to-video", {
        prompt: "@kira:1:smile in a meadow",
        provider: "kling",
      })
      const nodes = [character, t2v]
      const edges = [edge("char-1", "t2v-1")]
      const inputs: ResolvedInputs = {
        referenceImageUrls: ["https://r2/kira-smile.png"], // already present
      }

      const result = buildPayload(
        t2v,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      const refs = result.payload.referenceImageUrls as string[] | undefined
      expect(refs).toBeDefined()
      const occurrences = refs!.filter((u) => u === "https://r2/kira-smile.png").length
      expect(occurrences).toBe(1)
    })

    it("falls back to canonical URL when character is wired but not @-mentioned", () => {
      const character = charNode("char-1")
      const t2v = node("t2v-1", "text-to-video", {
        prompt: "a desert at sunset",
        provider: "kling",
      })
      const nodes = [character, t2v]
      const edges = [edge("char-1", "t2v-1")]
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        t2v,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      const refs = result.payload.referenceImageUrls as string[] | undefined
      expect(refs).toBeDefined()
      expect(refs).toContain("https://r2/kira-portrait.png")
      const prompt = result.payload.prompt as string
      expect(prompt).toContain("Use these characters:")
      expect(prompt).toContain("auburn shoulder-length hair")
    })
  })

  describe("video-to-video", () => {
    it("leaves unknown @mystery:1 as a literal token (no character wired with that slug)", () => {
      const character = charNode("char-1") // slug "kira"
      const v2v = node("v2v-1", "video-to-video", {
        prompt: "@mystery:1 person appears suddenly",
        provider: "wan",
        videoUrl: "https://r2/source.mp4",
      })
      const nodes = [character, v2v]
      const edges = [edge("char-1", "v2v-1")]
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        v2v,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      expect(result.jobName).toBe("video-to-video")
      const prompt = result.payload.prompt as string
      // Unknown slug stays literal — no expansion happened.
      expect(prompt).toContain("@mystery:1")
      // Wired Kira (unmentioned) falls back to canonical — fills the single
      // v2v reference slot since no upstream ref was provided.
      expect(result.payload.referenceImageUrl).toBe("https://r2/kira-portrait.png")
    })

    it("resolves @kira:1:smile and routes the URL into v2v's single referenceImageUrl slot", () => {
      const character = charNode("char-1")
      const v2v = node("v2v-1", "video-to-video", {
        prompt: "transform the figure into @kira:1:smile",
        provider: "wan",
        videoUrl: "https://r2/source.mp4",
      })
      const nodes = [character, v2v]
      const edges = [edge("char-1", "v2v-1")]
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        v2v,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      // v2v has a single string slot — the mention URL fills it.
      expect(result.payload.referenceImageUrl).toBe("https://r2/kira-smile.png")
      // Prompt token was replaced regardless of slot capacity.
      const prompt = result.payload.prompt as string
      expect(prompt).toContain("Kira")
      expect(prompt).not.toMatch(/@kira:1:smile\b/)
    })
  })
})
