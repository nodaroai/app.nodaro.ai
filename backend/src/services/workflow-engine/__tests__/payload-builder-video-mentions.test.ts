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
      expect(prompt).toContain("The subject must remain exactly the same person")
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
      expect(prompt).toContain("The subject must remain exactly the same person")
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

  // -------------------------------------------------------------------------
  // Unified generate-video node — mode-dispatch + @-mention parity.
  //
  // The new generate-video case in payload-builder dispatches `jobName` to
  // either "image-to-video" or "text-to-video" depending on whether a start
  // frame is wired. These tests confirm the @-mention resolution behaves
  // identically to the legacy i2v / t2v cases AND that the dynamic dispatch
  // picks the right downstream worker handler — both halves must hold for
  // the new node to be a drop-in replacement for its predecessors.
  // -------------------------------------------------------------------------
  describe("generate-video", () => {
    it("text-only mode + single mention: dispatches jobName='text-to-video' and backfills imageUrl from mention URL", () => {
      const character = charNode("char-1")
      const gv = node("gv-1", "generate-video", {
        prompt: "@kira:1 dances across a moonlit dune",
        provider: "kling",
      })
      const nodes = [character, gv]
      const edges = [edge("char-1", "gv-1")]
      // No start frame wired — mode dispatch lands on text-to-video, BUT
      // the unified case backfills imageUrl from the first resolved mention
      // URL when no start frame is wired (so providers that need an image
      // anchor get one). This is the documented divergence from legacy t2v.
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        gv,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      // Dynamic dispatch picks text-to-video because no start frame is wired.
      expect(result.jobName).toBe("text-to-video")
      // First mention URL backfills imageUrl (unified-node-specific behavior).
      expect(result.payload.imageUrl).toBe("https://r2/kira-portrait.png")
      // Prompt token was expanded.
      const prompt = result.payload.prompt as string
      expect(prompt).toContain("Kira")
      expect(prompt).not.toMatch(/@kira:1\b/)
      // Identity directive present (canonical description ride-along).
      expect(prompt).toContain("auburn shoulder-length hair")
    })

    it("image mode: upstream start frame flips dispatch to jobName='image-to-video' and preserves imageUrl", () => {
      const character = charNode("char-1")
      const gv = node("gv-1", "generate-video", {
        prompt: "@kira:1:smile pose in the rain",
        provider: "kling",
      })
      const nodes = [character, gv]
      const edges = [edge("char-1", "gv-1")]
      // Upstream image triggers image-to-video mode.
      const inputs: ResolvedInputs = {
        startFrameUrl: "https://r2/user-uploaded.png",
      }

      const result = buildPayload(
        gv,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      // Dynamic dispatch landed on i2v.
      expect(result.jobName).toBe("image-to-video")
      // Upstream start frame won — mention URL went to referenceImageUrls.
      expect(result.payload.imageUrl).toBe("https://r2/user-uploaded.png")
      const refs = result.payload.referenceImageUrls as string[] | undefined
      expect(refs).toBeDefined()
      expect(refs).toContain("https://r2/kira-smile.png")
      // Variant resolution swallowed the @-mention token.
      const prompt = result.payload.prompt as string
      expect(prompt).not.toMatch(/@kira:1:smile\b/)
    })

    it("variant mention with no wired start frame: backfills imageUrl from kira-smile.png and keeps text-only dispatch", () => {
      const character = charNode("char-1")
      const gv = node("gv-1", "generate-video", {
        prompt: "@kira:1:smile dances in a forest",
        provider: "kling",
      })
      const nodes = [character, gv]
      const edges = [edge("char-1", "gv-1")]
      // No upstream image — mode dispatch is computed BEFORE mention
      // resolution, so it lands on text-to-video, but the imageUrl slot
      // gets backfilled from the variant URL (kira-smile.png, not the
      // canonical kira-portrait.png).
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        gv,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      expect(result.jobName).toBe("text-to-video")
      // Variant URL wins over canonical because the mention specified `smile`.
      expect(result.payload.imageUrl).toBe("https://r2/kira-smile.png")
      const prompt = result.payload.prompt as string
      // Mention token gone, name expanded.
      expect(prompt).toContain("Kira")
      expect(prompt).not.toMatch(/@kira:1:smile\b/)
      // Canonical description directive (first mention).
      expect(prompt).toContain("auburn shoulder-length hair")
    })

    it("canonical fallback: wired character without @-mention slots canonical URL into imageUrl + emits identity directive", () => {
      const character = charNode("char-1")
      const gv = node("gv-1", "generate-video", {
        prompt: "a calm forest at dawn",
        provider: "kling",
      })
      const nodes = [character, gv]
      const edges = [edge("char-1", "gv-1")]
      // No upstream image, character wired but not mentioned.
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        gv,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      // text-only dispatch (no start frame).
      expect(result.jobName).toBe("text-to-video")
      // Canonical URL fills the imageUrl slot (i2v-style backfill — the
      // generate-video case routes mention/canonical URLs through imageUrl
      // first, then spills overflow to referenceImageUrls).
      expect(result.payload.imageUrl).toBe("https://r2/kira-portrait.png")
      const prompt = result.payload.prompt as string
      // Strong identity directive prepended.
      expect(prompt).toContain("Use these characters:")
      expect(prompt).toContain("auburn shoulder-length hair")
      // Body text untouched.
      expect(prompt).toContain("a calm forest at dawn")
    })

    it("no-mention text-only mode: dispatches text-to-video and leaves prompt body intact", () => {
      const gv = node("gv-1", "generate-video", {
        prompt: "a dog runs through a park",
        provider: "kling",
      })
      const nodes = [gv]
      const edges: SimpleEdge[] = []
      const inputs: ResolvedInputs = {}

      const result = buildPayload(
        gv,
        jobId,
        inputs,
        undefined,
        { nodes, edges, nodeStates: {} },
      )

      expect(result.jobName).toBe("text-to-video")
      const prompt = result.payload.prompt as string
      expect(prompt).toContain("a dog runs through a park")
      // No mentions → no "Use these characters:" header.
      expect(prompt).not.toContain("Use these characters:")
    })
  })
})

// ---------------------------------------------------------------------------
// Video payload-builder: extra reference images (the `extraRefs` field).
//
// Mirrors the frontend `resolveVideoPromptMentions` extras-pass and the
// shared `buildExtraRefDirectives` (which handles the image side). Orchestrator
// path must produce the same prompt + URL ordering as a single-node frontend
// run with the same workflow JSON.
// ---------------------------------------------------------------------------

describe("payload-builder video paths: extra reference images", () => {
  const jobId = "job-extras"

  it("appends manual extra refs to referenceImageUrls AND emits '@image_N (reference): …' directive (image-to-video)", () => {
    const i2v = node("i2v-1", "image-to-video", {
      prompt: "a moody portrait, slow tilt up",
      provider: "kling",
      extraRefs: [
        { url: "https://r2/look-ref.png", description: "warm cinematic color palette" },
      ],
    })
    const nodes = [i2v]
    const edges: SimpleEdge[] = []
    const inputs: ResolvedInputs = { imageUrl: "https://r2/portrait.png" }

    const result = buildPayload(i2v, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

    // imageUrl preserved.
    expect(result.payload.imageUrl).toBe("https://r2/portrait.png")
    // Extra URL appended to referenceImageUrls.
    const refs = result.payload.referenceImageUrls as string[] | undefined
    expect(refs).toBeDefined()
    expect(refs).toContain("https://r2/look-ref.png")
    // Prompt has the dedicated extra-ref bullet.
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("@image_1 (reference): warm cinematic color palette.")
  })

  it("pairs character-sourced extras back to canonically-attached character (same subject as Image A)", () => {
    const character = charNode("char-1")
    const i2v = node("i2v-1", "image-to-video", {
      prompt: "outside a coffee shop",
      provider: "kling",
      extraRefs: [
        {
          url: "https://r2/kira-standing.png",
          description: "full body, standing, facing right",
          characterSlug: "kira",
          variantSlug: "standing",
          variantDisplayName: "standing",
        },
      ],
    })
    const nodes = [character, i2v]
    const edges = [edge("char-1", "i2v-1")]
    const inputs: ResolvedInputs = {}

    const result = buildPayload(i2v, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

    // Canonical fill — i2v slot 0 = canonical Kira (no @-mention used).
    expect(result.payload.imageUrl).toBe("https://r2/kira-portrait.png")
    // Extra URL appended to referenceImageUrls.
    const refs = result.payload.referenceImageUrls as string[] | undefined
    expect(refs).toBeDefined()
    expect(refs).toContain("https://r2/kira-standing.png")
    // Pair-back directive.
    const prompt = result.payload.prompt as string
    expect(prompt).toContain(
      "@image_2 is the same subject as @image_1, full body, standing, facing right.",
    )
  })

  it("emits canonical-style directive for a first-sight character extra (no wired upstream)", () => {
    const i2v = node("i2v-1", "image-to-video", {
      prompt: "a beach scene",
      provider: "kling",
      extraRefs: [
        {
          url: "https://r2/danny.png",
          description: "hands in pockets, looking right",
          characterSlug: "danny",
          variantDisplayName: "canonical",
        },
      ],
    })
    const nodes = [i2v]
    const edges: SimpleEdge[] = []
    const inputs: ResolvedInputs = { imageUrl: "https://r2/beach.png" }

    const result = buildPayload(i2v, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

    expect(result.payload.imageUrl).toBe("https://r2/beach.png")
    const refs = result.payload.referenceImageUrls as string[] | undefined
    expect(refs).toContain("https://r2/danny.png")
    const prompt = result.payload.prompt as string
    // First sight emits a canonical-style bullet with the description.
    expect(prompt).toContain("@image_1 (danny) — hands in pockets, looking right")
  })

  it("propagates extra refs to text-to-video referenceImageUrls", () => {
    const character = charNode("char-1")
    const t2v = node("t2v-1", "text-to-video", {
      prompt: "@kira:1 walks through a snowy street",
      provider: "kling",
      extraRefs: [
        { url: "https://r2/style-ref.png", description: "1970s film look" },
      ],
    })
    const nodes = [character, t2v]
    const edges = [edge("char-1", "t2v-1")]
    const inputs: ResolvedInputs = {}

    const result = buildPayload(t2v, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

    const refs = result.payload.referenceImageUrls as string[] | undefined
    expect(refs).toBeDefined()
    expect(refs).toContain("https://r2/style-ref.png")
    expect(refs).toContain("https://r2/kira-portrait.png")
    const prompt = result.payload.prompt as string
    // Numeric ordering: mention takes position 1; extra takes position 2.
    expect(prompt).toContain("Image 1 (Kira)")
    expect(prompt).toContain("@image_2 (reference): 1970s film look.")
  })
})

// ---------------------------------------------------------------------------
// Video payload-builder: {image:N} reference-token resolution (Task 4.1).
//
// FE↔BE parity contract (mirrors execute-node.ts run + video-prompt-assembly.ts
// preview): the editor numbers `{image:N}` body tokens against the COUNT of
// reference-handle edges wired into the node (`targetHandle === "references"`,
// edge-count NOT resolved-URL count). For a ref-capable provider (its model
// declares the `reference-image` feature) an IN-RANGE token resolves to
// `the {label} from @image_N`; a non-ref provider OR an out-of-range index
// drops to the bare label. The orchestrator must NEVER ship the raw
// `{image:N}` token to the provider — that was the "orchestrator ships raw
// tokens" bug this task closes. Both layers delegate to the SAME shared
// `resolveVideoReferenceCore`, gated by the SAME `hasFeature(provider,
// "reference-image")`, so parity is structural (no cross-layer snapshot).
// ---------------------------------------------------------------------------

describe("payload-builder video paths: {image:N} reference tokens (Task 4.1)", () => {
  const jobId = "job-imgtok"

  // A plain image producer wired into the consumer's `references` handle. Only
  // the edge's targetHandle drives the token COUNT — the source needn't resolve
  // to a URL (edge-count parity with the FE preview, which has no URL layer).
  function refImage(id: string): SimpleNode {
    return node(id, "generate-image", { generatedImageUrl: "https://r2/ref.png" })
  }

  it("image-to-video: ref-capable provider resolves {image:1:object} → 'the object from @image_1'", () => {
    const i2v = node("i2v-1", "image-to-video", {
      prompt: "circle {image:1:object}",
      provider: "seedance-2", // declares `reference-image` in MODEL_CATALOG
    })
    const nodes = [refImage("img-1"), i2v]
    const edges = [edge("img-1", "i2v-1", "image", "references")]
    const inputs: ResolvedInputs = {}

    const result = buildPayload(i2v, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

    const prompt = result.payload.prompt as string
    expect(prompt).toContain("circle the object from @image_1")
    // Never ship the raw token.
    expect(prompt).not.toContain("{image:1")
  })

  it("image-to-video: non-ref provider drops {image:1:object} to the bare label (no @image_1, no raw token)", () => {
    const i2v = node("i2v-1", "image-to-video", {
      prompt: "circle {image:1:object}",
      provider: "kling", // no `reference-image` feature → tokens bare-label
    })
    const nodes = [refImage("img-1"), i2v]
    const edges = [edge("img-1", "i2v-1", "image", "references")]
    const inputs: ResolvedInputs = {}

    const result = buildPayload(i2v, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

    const prompt = result.payload.prompt as string
    expect(prompt).toContain("circle object")
    expect(prompt).not.toContain("@image_1")
    expect(prompt).not.toContain("{image:1")
  })

  it("image-to-video: out-of-range index on a ref-capable provider drops to the bare label", () => {
    const i2v = node("i2v-1", "image-to-video", {
      // Only ONE references edge wired → index 2 is out of range.
      prompt: "circle {image:2:object}",
      provider: "seedance-2",
    })
    const nodes = [refImage("img-1"), i2v]
    const edges = [edge("img-1", "i2v-1", "image", "references")]
    const inputs: ResolvedInputs = {}

    const result = buildPayload(i2v, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

    const prompt = result.payload.prompt as string
    expect(prompt).toContain("circle object")
    expect(prompt).not.toContain("@image_2")
    expect(prompt).not.toContain("{image:2")
  })

  it("text-to-video: ref-capable provider resolves {image:1:object} → '@image_1'", () => {
    const t2v = node("t2v-1", "text-to-video", {
      prompt: "circle {image:1:object}",
      provider: "seedance-2",
    })
    const nodes = [refImage("img-1"), t2v]
    const edges = [edge("img-1", "t2v-1", "image", "references")]
    const inputs: ResolvedInputs = {}

    const result = buildPayload(t2v, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

    const prompt = result.payload.prompt as string
    expect(prompt).toContain("the object from @image_1")
    expect(prompt).not.toContain("{image:1")
  })

  it("generate-video: ref-capable provider threads the LEGACY references-handle count into {image:N} resolution", () => {
    // Legacy-alias regression guard: the modality count (countRefModalityEdges →
    // shared referenceModalityForHandle) covers the legacy `references` id too, so
    // un-migrated workflows wiring image refs on `references` keep resolving.
    // (no start frame → dispatches text-to-video).
    const gv = node("gv-1", "generate-video", {
      prompt: "circle {image:1:object}",
      provider: "seedance-2",
    })
    const nodes = [refImage("img-1"), gv]
    const edges = [edge("img-1", "gv-1", "image", "references")]
    const inputs: ResolvedInputs = {}

    const result = buildPayload(gv, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

    expect(result.jobName).toBe("text-to-video")
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("the object from @image_1")
    expect(prompt).not.toContain("{image:1")
  })

  it("generate-video: resolves {image:1:object} when the ref edge is on the CANONICAL `imageReferences` handle (Task 4.2 headline)", () => {
    // Real generate-video nodes wire image refs on `imageReferences`
    // (generate-video-node.tsx:178), NOT the legacy `references` handle. Before
    // the fix the COUNT looked only at `references`, so {image:N} saw 0 in-range
    // refs and dropped to the bare label on EVERY real generate-video node — the
    // feature was inert. The shared modality count now treats `imageReferences`
    // as an image ref, so {image:1} binds to @image_1 (no start frame →
    // text-to-video dispatch).
    const gv = node("gv-1", "generate-video", {
      prompt: "circle {image:1:object}",
      provider: "seedance-2",
    })
    const nodes = [refImage("img-1"), gv]
    const edges = [edge("img-1", "gv-1", "image", "imageReferences")]
    const inputs: ResolvedInputs = {}

    const result = buildPayload(gv, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

    expect(result.jobName).toBe("text-to-video")
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("the object from @image_1")
    expect(prompt).not.toContain("{image:1")
  })

  // ── D5 unified-asset-references: Assets-handle entities join the {image:N}
  // numbering AFTER the leading plain image-refs. ──
  it("text-to-video: an OBJECT wired via the Assets handle attaches as @image_2 after a leading ref (D5)", () => {
    const t2v = node("t2v-ent", "text-to-video", {
      prompt: "the {image:1:bg} with the {image:2:gadget}",
      provider: "seedance-2",
    })
    const obj = node("obj-1", "object", { sourceImageUrl: "https://r2/obj.png", objectName: "Gadget" })
    const nodes = [refImage("img-1"), obj, t2v]
    const edges = [
      edge("img-1", "t2v-ent", "image", "references"), // leading plain ref → @image_1
      edge("obj-1", "t2v-ent", "objectRef", "assets"), // object asset → @image_2
    ]
    const inputs: ResolvedInputs = { referenceImageUrls: ["https://r2/bg.png"] }

    const result = buildPayload(t2v, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("the bg from @image_1") // leading plain ref
    expect(prompt).toContain("the gadget from @image_2") // object asset, numbered AFTER
    // the object's image lands in the worker payload at the @image_2 slot
    expect(result.payload.referenceImageUrls).toEqual(["https://r2/bg.png", "https://r2/obj.png"])
  })
})
