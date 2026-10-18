/**
 * buildPayload: @-mentions and label references (character and named-image
 * mentions, the entity image handle, unresolved {Label} refs).
 *
 * Merged from 4 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 4 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"
import { assembleImageInput } from "@nodaro/prompts/assembly"
import type { ConnectedReference } from "@nodaro/shared/types"
import { resolveEffectiveSourceType } from "@nodaro/shared/entities"

describe("payload-builder-mentions.test.ts", () => {
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

    it("does NOT expand a character wired via the `image` handle — plain portrait, no identity injection (PR #3369)", () => {
      const character = charNode("char-1")
      const generateImage = node("gen-1", "generate-image", {
        // Same prompt as the identity-handle test above, which DOES inject
        // "Image 1 (Kira)" + the smile variant. Via the plain `image` handle the
        // character must NOT be expanded, so neither happens.
        prompt: "make her dance, @kira:1:smile",
        provider: "nano-banana-pro",
      })
      const nodes = [character, generateImage]
      // Wire via the plain `image` source handle (PR #3369), NOT the identity handle.
      const edges = [edge("char-1", "gen-1", "image")]
      const inputs: ResolvedInputs = {
        referenceImageUrls: ["https://r2/kira-portrait.png"],
      }

      const result = buildPayload(generateImage, jobId, inputs, undefined, { nodes, edges, nodeStates: {} })

      expect(result.jobName).toBe("generate-image")
      const refs = result.payload.referenceImageUrls as string[] | undefined
      expect(refs).toBeDefined()
      // The plain portrait flows through as a normal reference image.
      expect(refs).toContain("https://r2/kira-portrait.png")
      // NOT expanded as identity: no asset-variant pulled in, and no "@kira"
      // identity directive injected into the prompt (contrast the first test).
      expect(refs).not.toContain("https://r2/kira-smile.png")
      expect(result.payload.prompt as string).not.toContain("Image 1 (Kira)")
    })
  })
})

describe("payload-builder-image-mentions.test.ts", () => {
  // ---------------------------------------------------------------------------
  // P3 — named-image mentions through the ORCHESTRATOR (FE/BE parity).
  //
  // Two stacked defects this file pins shut:
  //
  //  1. `buildConnectedRefsForGenerate` stamped `defaultName: id` (`wired_0`, the
  //     raw source node id), so an upload node's LABEL never reached the
  //     resolver and `@town:1` had nothing to bind to.
  //  2. `useConnectedRefs = hasWiredCharacter || extraRefEntries.length > 0` —
  //     an images-only graph took the FLAT branch, so `connectedReferences`
  //     never reached `buildImagePrompt` AT ALL, while the frontend
  //     (`execute-node.ts`) passes them unconditionally. Left unfixed, a mention
  //     resolved on a single-node Run and shipped literal text through the
  //     identical DAG run.
  //
  // The widening is scoped to prompts that carry a RESOLVABLE mention and is
  // hybrid-gated, so every mention-free graph keeps its exact branch and byte
  // output — which is what the second describe block asserts.
  //
  // Env pattern (save/restore in `finally`) copied from
  // `payload-builder-hybrid-gate.test.ts`: NODE_ENV=test forces legacy, so the
  // hybrid cases must simulate staging.
  // ---------------------------------------------------------------------------

  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }

  function edge(source: string, target: string): SimpleEdge {
    return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null }
  }

  const TOWN_URL = "https://r2/town.png"

  /** An images-only graph: a NAMED `upload-image` node wired into generate-image. */
  function buildUploadImagePayload(prompt: string) {
    const upload = node("upload-1", "upload-image", { label: "Town", imageUrl: TOWN_URL })
    const generateImage = node("gen-1", "generate-image", {
      prompt,
      provider: "nano-banana-pro",
    })
    const inputs: ResolvedInputs = { referenceImageUrls: [TOWN_URL] }
    return buildPayload(generateImage, "job-1", inputs, undefined, {
      nodes: [upload, generateImage],
      edges: [edge("upload-1", "gen-1")],
      nodeStates: {},
    })
  }

  /** The same graph with NO label on the upload node — the type-fallback case. */
  function buildUnnamedUploadPayload(prompt: string) {
    const upload = node("upload-1", "upload-image", { imageUrl: TOWN_URL })
    const generateImage = node("gen-1", "generate-image", { prompt, provider: "nano-banana-pro" })
    return buildPayload(generateImage, "job-1", { referenceImageUrls: [TOWN_URL] }, undefined, {
      nodes: [upload, generateImage],
      edges: [edge("upload-1", "gen-1")],
      nodeStates: {},
    })
  }

  function withHybridEnv<T>(fn: () => T): T {
    const prevNodeEnv = process.env.NODE_ENV
    const prevFmt = process.env.IMAGE_REFERENCE_FORMAT
    try {
      process.env.NODE_ENV = "development"
      process.env.IMAGE_REFERENCE_FORMAT = "hybrid"
      return fn()
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevFmt === undefined) delete process.env.IMAGE_REFERENCE_FORMAT
      else process.env.IMAGE_REFERENCE_FORMAT = prevFmt
    }
  }

  describe("payload-builder: named-image mentions resolve on an images-only graph", () => {
    it("a named upload-image node + @town:1 → the structured branch, label plumbed", () => {
      const result = withHybridEnv(() => buildUploadImagePayload("a wide shot of @town:1 at dusk"))
      const prompt = result.payload.prompt as string

      expect(prompt).toContain("reference image A")
      expect(prompt).not.toContain("@town")
      expect(result.payload.referenceImageUrls as string[]).toContain(TOWN_URL)
    })

    it("@town:1:background renders the role phrase", () => {
      const result = withHybridEnv(() =>
        buildUploadImagePayload("a wide shot of @town:1:background at dusk"),
      )
      expect(result.payload.prompt as string).toContain("the background from reference image A")
    })

    it("FE/BE PARITY: the orchestrator's prompt equals `assembleImageInput` on the equivalent frontend refs", () => {
      // The frontend (`frontend/src/components/editor/workflow-editor/execute-node.ts`)
      // names a wired upstream from its node label and passes `connectedReferences`
      // unconditionally. Feeding the SAME reference list through the shared
      // assembler must reproduce the orchestrator's prompt byte for byte.
      const userPrompt = "a wide shot of @town:1:background at dusk"
      const frontendRefs: ConnectedReference[] = [
        { id: "upload-1", defaultName: "Town", source: "wired-image", url: TOWN_URL },
      ]
      const { orchestrated, frontendish } = withHybridEnv(() => ({
        orchestrated: buildUploadImagePayload(userPrompt),
        frontendish: assembleImageInput({
          userPrompt,
          provider: "nano-banana-pro",
          referenceFormat: "hybrid",
          connectedReferences: frontendRefs,
        }),
      }))
      expect(orchestrated.payload.prompt as string).toBe(frontendish.prompt)
      expect(orchestrated.payload.referenceImageUrls as string[]).toEqual(
        frontendish.referenceImageUrls,
      )
    })
  })

  describe("payload-builder: the useConnectedRefs widening is scoped to resolvable mentions", () => {
    it("MENTION-FREE graph → byte-identical prompt and referenceImageUrls (flat branch kept)", () => {
      // The pre-change flat-branch output for this graph. Captured, not
      // re-derived: this is the guard on the branch widening.
      const result = withHybridEnv(() => buildUploadImagePayload("a wide shot of a quiet town square"))
      expect(result.payload.prompt as string).toBe("a wide shot of a quiet town square")
      expect(result.payload.referenceImageUrls as string[]).toEqual([TOWN_URL])
    })

    it("an UNRESOLVABLE mention (no ref by that name) does not widen the branch either", () => {
      const result = withHybridEnv(() => buildUploadImagePayload("a wide shot of @plaza:1 at dusk"))
      // Nothing to bind → token stays literal, flat branch, output unchanged.
      expect(result.payload.prompt as string).toContain("@plaza:1")
      expect(result.payload.referenceImageUrls as string[]).toEqual([TOWN_URL])
    })

    it("an UNNAMED upload node is named from its TYPE, so `@town:1` finds nothing", () => {
      const result = withHybridEnv(() => buildUnnamedUploadPayload("a wide shot of @town:1 at dusk"))
      expect(result.payload.prompt as string).toContain("@town:1")
    })
  })

  describe("payload-builder: how an UNNAMED node gets its mention name", () => {
    // `buildRefNameLookup` resolves `label ?? name ?? type` — the node TYPE, NOT
    // the node id. So an unlabelled upload node is mentionable as
    // `@upload-image:N`. Deliberate: the frontend
    // (`execute-node.ts`, `label || name || type`) does exactly the same, and
    // dropping the type fallback here would make the two engines resolve
    // different mention sets on the same graph.
    it("the TYPE fallback is mentionable: `@upload-image:1` RESOLVES", () => {
      const result = withHybridEnv(() =>
        buildUnnamedUploadPayload("a wide shot of @upload-image:1 at dusk"),
      )
      const prompt = result.payload.prompt as string
      expect(prompt).toContain("reference image A")
      expect(prompt).not.toContain("@upload-image")
    })

    it("a ref id with NO node behind it keeps the id as its name (the `?? id` fallback)", () => {
      // `extractedReferenceUrls` keys as `extracted_0` — an id that is not a
      // canvas node id, so the lookup misses and the id itself is the name. It
      // slugs to "extracted-0", which a leading-digit-free slug CAN match.
      const generateImage = node("gen-1", "generate-image", {
        prompt: "a wide shot of @extracted-0:1 at dusk",
        provider: "nano-banana-pro",
        extractedReferenceUrls: [TOWN_URL],
      })
      const result = withHybridEnv(() =>
        buildPayload(generateImage, "job-1", {}, undefined, {
          nodes: [generateImage],
          edges: [],
          nodeStates: {},
        }),
      )
      const prompt = result.payload.prompt as string
      expect(prompt).toContain("reference image A")
      expect(prompt).not.toContain("@extracted-0")
    })
  })

  describe("payload-builder: the node-name lookup is forfeited when the ref zip is not 1:1", () => {
    // `refUrlMap` zips `wiredSourceIds` (edge sources FILTERED to image types)
    // against `chainRefs` POSITIONALLY. A `reference-sheet` upstream spreads its
    // whole `panels` set into `referenceImageUrls` AND is not an image type, so
    // both halves of the zip shift: `chainRefs[0]` (a panel) would be keyed
    // "upload-1" and stamped with the upload node's label "Town". A mention would
    // then bind the WRONG image with no error.
    const PANEL_1 = "https://r2/panel1.png"
    const PANEL_2 = "https://r2/panel2.png"

    function buildShiftedZipPayload(prompt: string) {
      const sheet = node("sheet-1", "reference-sheet", { label: "Sheet" })
      const upload = node("upload-1", "upload-image", { label: "Town", imageUrl: TOWN_URL })
      const generateImage = node("gen-1", "generate-image", { prompt, provider: "nano-banana-pro" })
      return buildPayload(
        generateImage,
        "job-1",
        { referenceImageUrls: [PANEL_1, PANEL_2, TOWN_URL] },
        undefined,
        {
          nodes: [sheet, upload, generateImage],
          edges: [edge("sheet-1", "gen-1"), edge("upload-1", "gen-1")],
          nodeStates: {},
        },
      )
    }

    it("a multi-URL non-image upstream shifts the zip → `@town:1` stays literal, never mis-binds", () => {
      const result = withHybridEnv(() => buildShiftedZipPayload("a wide shot of @town:1 at dusk"))
      const prompt = result.payload.prompt as string
      // The failure this pins shut: `@town:1` resolving to "reference image A",
      // which is the reference SHEET's first panel, not the node named "Town".
      expect(prompt).toContain("@town:1")
      expect(prompt).not.toContain("reference image A")
      // Forfeiting the names forfeits the branch widening too → flat branch,
      // byte-identical to pre-P3.
      expect(result.payload.referenceImageUrls as string[]).toEqual([PANEL_1, PANEL_2, TOWN_URL])
    })

    it("mention-free on the same shifted graph is unchanged (the guard adds no behavior)", () => {
      const result = withHybridEnv(() => buildShiftedZipPayload("a wide shot of a quiet town square"))
      expect(result.payload.prompt as string).toBe("a wide shot of a quiet town square")
      expect(result.payload.referenceImageUrls as string[]).toEqual([PANEL_1, PANEL_2, TOWN_URL])
    })
  })

  describe("payload-builder: LEGACY reference format leaves image mentions literal", () => {
    it("NODE_ENV=test (the legacy default) → flat branch, token verbatim", () => {
      expect(process.env.NODE_ENV).toBe("test")
      const result = buildUploadImagePayload("a wide shot of @town:1 at dusk")
      expect(result.payload.prompt as string).toContain("@town:1")
      expect(result.payload.prompt as string).not.toContain("reference image A")
      expect(result.payload.referenceImageUrls as string[]).toContain(TOWN_URL)
    })
  })
})

describe("payload-builder-entity-image-handle.test.ts", () => {
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
})

describe("payload-builder-unresolved-refs.test.ts", () => {
  /**
   * §4.6. `resolveNodeRefs` leaves a `{Label}` literal when the upstream is
   * absent and there is no `|| fallback` — and the DAG engine then sent those
   * characters to the provider ({Describe Image} ×2 on gpt-image-2, {gravity
   * flip} / {rewind} on two seedance-2-5 rows). Refuse at build time, before the
   * credit reservation (node-executor.ts builds the payload at :1314 and only
   * reserves at :1419, deleting the placeholder jobs row on a build throw).
   *
   * Substitute-then-refuse: a token naming a node that EXISTS but produced
   * nothing resolves to empty text (or its `|| fallback`); only a token naming no
   * node at all refuses.
   *
   * SCOPE (fix round 1): the pass applies to AUTHOR-TYPED text only — the node's
   * own prompt candidate fields and its promptPrefix / promptSuffix, settled
   * BEFORE composition. Text that ARRIVES through a wired edge or a list fan-out
   * item is DATA and passes through verbatim: JSON out of a Generate Text node
   * legitimately contains `{...}`, and the `{name || fallback}` escape is
   * unreachable for text nobody authored.
   *
   * CROSS-ENGINE PARITY: the `typed prompt:` / `wired prompt:` / `affixes:` cases
   * below are named IDENTICALLY to their twins in
   * `frontend/src/components/editor/workflow-editor/__tests__/unresolved-refs-guard.test.ts`
   * so a future divergence between the two engines is one grep away.
   */
  const JOB = "job-unresolved-refs"
  const img = (prompt: string): SimpleNode =>
    ({ id: "img-1", type: "generate-image", data: { label: "Hero", prompt, provider: "nano-banana" } })

  describe("unresolved {Label} guard", () => {
    it("refuses a prompt whose reference matches no node", () => {
      const n = img("a {gravity flip} of a car")
      expect(() => buildPayload(n, JOB, {}, undefined, { nodes: [n], edges: [], nodeStates: {} }))
        .toThrow(/unresolved_reference/)
    })

    it("names the token so the user can fix it", () => {
      const n = img("a {gravity flip} of a car")
      expect(() => buildPayload(n, JOB, {}, undefined, { nodes: [n], edges: [], nodeStates: {} }))
        .toThrow(/gravity flip/)
    })

    it("names the node and the escape hatch, and carries a stable code", () => {
      const n = img("a {gravity flip} of a car")
      try {
        buildPayload(n, JOB, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
        throw new Error("expected a refusal")
      } catch (err) {
        const e = err as Error & { code?: string }
        expect(e.code).toBe("unresolved_reference")
        expect(e.message).toContain('"Hero"')
        expect(e.message).toContain("{name || fallback}")
      }
    })

    // A blank optional input is NOT the §4.6 defect — but neither may its token
    // SHIP. The orchestrator gives a source node a state entry only `if (output)`
    // (orchestrator-worker.ts, the isSourceNode branch), so an EMPTY text-prompt
    // has no state entry at all: `nodeStates: {}` below is what production really
    // looks like. `known` is graph-derived, so the reference is recognised — and
    // resolves to EMPTY TEXT, as if the author had written `{Notes || }`.
    // Refusing it is not an option: in a published app the person who left the
    // input blank cannot edit the prompt to add the escape.
    const emptyNotes: SimpleNode = { id: "t-1", type: "text-prompt", data: { label: "Notes", text: "" } }
    const withNotes = (n: SimpleNode) => ({
      nodes: [n, emptyNotes],
      edges: [{ id: "e1", source: "t-1", target: "img-1" }],
      nodeStates: {},
    })

    // --- Composition point 1: the node's own (typed) prompt, via promptFor ---

    it("typed prompt: an empty existing node contributes empty text, not the literal", () => {
      const n = img("write {Notes} about cats")
      const result = buildPayload(n, JOB, {}, undefined, withNotes(n))
      expect(result.payload.prompt).toBe("write about cats") // token gone, double space collapsed
      expect(String(result.payload.prompt)).not.toContain("{")
    })

    it("typed prompt: an empty existing node WITH a fallback contributes the fallback", () => {
      const n = img("write {Notes || nothing} about cats")
      const result = buildPayload(n, JOB, {}, undefined, withNotes(n))
      expect(result.payload.prompt).toBe("write nothing about cats")
    })

    it("typed prompt: a label naming no node in the graph still refuses", () => {
      const n = img("write {Notes} about {NotANode}")
      expect(() => buildPayload(n, JOB, {}, undefined, withNotes(n)))
        .toThrow(/unresolved_reference: node "Hero" references \{NotANode\}/)
    })

    // Prompt affixes ride the SAME composition point: computeNodePrompt wraps the
    // core via applyPromptAffixes, so promptPrefix / promptSuffix text is inside
    // the string finalizeRefTokens sees. Without that, a `{Label}` typed into an
    // affix would bypass both the refusal and the substitution.
    it("affixes: a nonexistent {Label} in promptPrefix refuses", () => {
      const n: SimpleNode = { id: "img-1", type: "generate-image", data: {
        label: "Hero", prompt: "a car", provider: "nano-banana", promptPrefix: "{NotANode} style,",
      } }
      expect(() => buildPayload(n, JOB, {}, undefined, withNotes(n)))
        .toThrow(/unresolved_reference: node "Hero" references \{NotANode\}/)
    })

    it("affixes: an empty existing node in promptSuffix substitutes to empty text", () => {
      const n: SimpleNode = { id: "img-1", type: "generate-image", data: {
        label: "Hero", prompt: "a car", provider: "nano-banana", promptSuffix: "shot {Notes} today",
      } }
      const result = buildPayload(n, JOB, {}, undefined, withNotes(n))
      expect(String(result.payload.prompt)).toContain("shot today")
      expect(String(result.payload.prompt)).not.toContain("{Notes}")
    })

    // --- Composition point 2: the WIRED upstream prompt is DATA, not a prompt ---
    //
    // These three are the INVERSE of how they were first written, and the exact
    // twins of the frontend file's `wired prompt:` cases. A `{` that arrived over
    // an edge is a character the upstream node emitted, and no one can add
    // `{name || fallback}` to text they did not type.

    it("wired prompt: text arriving from an edge is data — passed through verbatim", () => {
      const n = img("")
      const result = buildPayload(n, JOB, { prompt: "wired {Notes} tail" }, undefined, withNotes(n))
      expect(result.payload.prompt).toBe("wired {Notes} tail")
    })

    it("wired prompt: JSON from an upstream node reaches the provider unchanged", () => {
      const n = img("")
      const json = '{"shot": "wide", "lens": "35mm"}'
      const result = buildPayload(n, JOB, { prompt: json }, undefined, withNotes(n))
      expect(result.payload.prompt).toBe(json)
    })

    it("wired prompt: a {NotANode} arriving from an edge does NOT refuse", () => {
      const n = img("")
      const result = buildPayload(n, JOB, { prompt: "wired {NotANode} tail" }, undefined, withNotes(n))
      expect(result.payload.prompt).toBe("wired {NotANode} tail")
    })

    // Adversarial: BOTH halves of the rule on one node. The typed affix must
    // still refuse, and the refusal must name ONLY the authored token — the
    // missing label riding in on the wire is data and is never reported.
    it("wired data + a typed {NotANode} affix: refuses, naming only the typed token", () => {
      const n: SimpleNode = { id: "img-1", type: "generate-image", data: {
        label: "Hero", prompt: "", provider: "nano-banana", promptPrefix: "{NotANode} style,",
      } }
      try {
        buildPayload(n, JOB, { prompt: "wired {AlsoMissing} tail" }, undefined, withNotes(n))
        throw new Error("expected a refusal")
      } catch (err) {
        const e = err as Error & { code?: string }
        expect(e.code).toBe("unresolved_reference")
        expect(e.message).toContain("{NotANode}")
        expect(e.message).not.toContain("AlsoMissing")
      }
    })

    it("passes a token with an explicit fallback, and substitutes it", () => {
      const n = img("a {mood || calm} scene")
      const result = buildPayload(n, JOB, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
      // Even with an EMPTY ref map — where `resolvePrompt`'s `rr` skips
      // resolveNodeRefs entirely — the fallback is substituted, so a `{x || y}`
      // token can no longer reach a provider as characters.
      expect(result.payload.prompt).toBe("a calm scene")
    })

    it("never fires on the reference/recast grammars, and leaves them intact", () => {
      const n = img("use {image:1:face} and {slot:hero} and {ref:car}")
      const result = buildPayload(n, JOB, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
      // Not refused AND not stripped: their own resolvers run further down.
      expect(String(result.payload.prompt)).toContain("{slot:hero}")
      expect(String(result.payload.prompt)).toContain("{ref:car}")
    })
  })

  // ---------------------------------------------------------------------------
  // FieldMapping / `{}` injection — the second way DATA reaches a "typed" field
  //
  // `node-executor.ts` runs `resolveFieldMappings` BEFORE `buildPayload`, so
  // `node.data.<field>` may already hold an upstream node's output by the time
  // the settle pass reads it. The pre-mapping snapshot travels in
  // `PayloadBuildContext.authoredData`; a field that no longer equals its
  // authored value is DATA and passes through untouched.
  // ---------------------------------------------------------------------------

  describe("field mapping: injected upstream text is data, not an authored prompt", () => {
    const JSON_OUT = '{"k": "v"}'
    const notes: SimpleNode = { id: "t-1", type: "text-prompt", data: { label: "Notes", text: "" } }
    const graph = (n: SimpleNode) => ({
      nodes: [n, notes],
      edges: [{ id: "e1", source: "t-1", target: "img-1" }],
      nodeStates: {},
    })
    const withAuthored = (n: SimpleNode, authoredData: Record<string, unknown>) => ({
      ...graph(n),
      authoredData,
    })

    it("{} injection: JSON written into data.prompt does not refuse and ships verbatim", () => {
      const n = img(JSON_OUT)
      const result = buildPayload(n, JOB, {}, undefined, withAuthored(n, { ...n.data, prompt: "{}" }))
      expect(result.payload.prompt).toBe(JSON_OUT)
    })

    it("a mapped field is data even when the mapping wrote a {NotANode}", () => {
      const n = img("upstream {NotANode} text")
      const result = buildPayload(n, JOB, {}, undefined, withAuthored(n, { ...n.data, prompt: "{}" }))
      expect(result.payload.prompt).toBe("upstream {NotANode} text")
    })

    it("the same node's typed promptSuffix is still authored — and still refuses", () => {
      const n: SimpleNode = { id: "img-1", type: "generate-image", data: {
        label: "Hero", prompt: JSON_OUT, provider: "nano-banana", promptSuffix: "{NotANode} style",
      } }
      try {
        buildPayload(n, JOB, {}, undefined, withAuthored(n, { ...n.data, prompt: "{}" }))
        throw new Error("expected a refusal")
      } catch (err) {
        const e = err as Error & { code?: string }
        expect(e.code).toBe("unresolved_reference")
        expect(e.message).toContain("{NotANode}")
        // The injected JSON is data — its brace token is never reported.
        expect(e.message).not.toContain('"k"')
      }
    })

    it("no authoredData (direct callers, single-node parity) treats every field as authored", () => {
      const n = img("a {NotANode} scene")
      expect(() => buildPayload(n, JOB, {}, undefined, graph(n)))
        .toThrow(/unresolved_reference/)
    })
  })
})
