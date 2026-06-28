import { describe, it, expect } from "vitest"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import {
  stripVideoImageTokens,
  expandCharacterNodeIntoRefs,
  expandWiredCharacterRefsForVideo,
  resolveVideoPromptMentions,
  assembleVideoPrompt,
} from "@/lib/video-prompt-assembly"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_REFMAP = new Map<string, string>()

/** Minimal video consumer node (id "v1"). */
function videoNode(type: string, data: Record<string, unknown>): WorkflowNode {
  return { id: "v1", type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}

/**
 * A Character node "shira" with smile + laughing expression variants. Mirrors
 * the fixture used by `execute-node.test.ts` so the moved helpers are pinned to
 * the exact same expansion behavior.
 */
function shiraCharacter(): WorkflowNode {
  return {
    id: "char-shira",
    type: "character",
    position: { x: 0, y: 0 },
    data: {
      label: "shira",
      characterName: "shira",
      sourceImageUrl: "http://shira/portrait.png",
      defaultAssetUrl: "http://shira/portrait.png",
      canonicalDescription: "young woman, brown eyes",
      expressions: [
        { name: "smile", url: "http://shira/smile.png" },
        { name: "laughing", url: "http://shira/laughing.png" },
      ],
      poses: [],
      motions: [],
      angles: [],
      bodyAngles: [],
      lightingVariations: [],
    },
  } as unknown as WorkflowNode
}

/**
 * A `person` parameter (cinematography) node. `buildPersonHints` emits
 * `data.preText` verbatim as the first fragment, so this yields a deterministic
 * hint string decoupled from catalog drift while still being a real Person node.
 */
function personHintNode(id: string, text: string): WorkflowNode {
  return {
    id,
    type: "person",
    position: { x: 0, y: 0 },
    data: { label: "Person", preText: text },
  } as unknown as WorkflowNode
}

// ---------------------------------------------------------------------------
// stripVideoImageTokens (moved verbatim from execute-node.ts)
// ---------------------------------------------------------------------------

describe("stripVideoImageTokens", () => {
  it("keeps the label and drops the {image:N:label} curly syntax", () => {
    expect(stripVideoImageTokens("hold the {image:1:sword} high")).toBe("hold the sword high")
  })

  it("drops a bare {image:N} token entirely (no label)", () => {
    expect(stripVideoImageTokens("walk past {image:2} slowly")).toBe("walk past slowly")
  })

  it("passes through undefined and collapses an all-token prompt to undefined", () => {
    expect(stripVideoImageTokens(undefined)).toBeUndefined()
    expect(stripVideoImageTokens("{image:1}")).toBeUndefined()
  })

  // I2 parity: the FE switchx run-path strips-only (no core pass), so it must
  // collapse {video:N}/{audio:N} to bare label exactly as the BE switchx case
  // (count 0) does — otherwise a hand-typed {video:1:clip} ships raw to the
  // provider (FE-run vs BE-orchestrator divergence).
  it("strips {video:N}/{audio:N} tokens too (keeps the label, drops curly syntax)", () => {
    expect(stripVideoImageTokens("a {video:1:clip} b {audio:2}")).toBe("a clip b")
  })

  it("keeps a multi-word {audio:N:label} label (space allowed, matching the core charset)", () => {
    expect(stripVideoImageTokens("play {audio:2:my song} now")).toBe("play my song now")
  })
})

// ---------------------------------------------------------------------------
// expandCharacterNodeIntoRefs / expandWiredCharacterRefsForVideo (moved)
// ---------------------------------------------------------------------------

describe("expandCharacterNodeIntoRefs", () => {
  it("emits a canonical entry plus one per expression variant", () => {
    const out = expandCharacterNodeIntoRefs(shiraCharacter())
    const byId = new Map(out)
    // Canonical keyed by the node id.
    expect(byId.get("char-shira")?.url).toBe("http://shira/portrait.png")
    expect(byId.get("char-shira")?.variantDisplayName).toBe("canonical")
    // Variants keyed `<nodeId>_expressions_<slug>`.
    expect(byId.get("char-shira_expressions_smile")?.url).toBe("http://shira/smile.png")
    expect(byId.get("char-shira_expressions_laughing")?.url).toBe("http://shira/laughing.png")
  })

  it("falls back to the 'Character' name slug when neither characterName nor label is set", () => {
    // The `characterName || label || "Character"` default means there is always
    // a slug, so the canonical entry is still emitted (faithful to the moved code).
    const unnamed = {
      id: "x",
      type: "character",
      position: { x: 0, y: 0 },
      data: { sourceImageUrl: "http://x/p.png" },
    } as unknown as WorkflowNode
    const out = expandCharacterNodeIntoRefs(unnamed)
    expect(out).toHaveLength(1)
    expect(out[0][1].characterSlug).toBe("character")
    expect(out[0][1].url).toBe("http://x/p.png")
  })
})

describe("expandWiredCharacterRefsForVideo", () => {
  it("flattens every wired Character upstream into ConnectedReference entries", () => {
    const nodes = [shiraCharacter(), videoNode("text-to-video", {})]
    const edges: WorkflowEdge[] = [{ id: "e", source: "char-shira", target: "v1" } as WorkflowEdge]
    const refs = expandWiredCharacterRefsForVideo("v1", nodes, edges)
    expect(refs.map((r) => r.url)).toContain("http://shira/portrait.png")
    expect(refs.map((r) => r.url)).toContain("http://shira/smile.png")
    expect(refs.every((r) => r.source === "wired-character")).toBe(true)
  })

  it("returns [] when no Character is wired upstream", () => {
    const nodes = [videoNode("text-to-video", {})]
    expect(expandWiredCharacterRefsForVideo("v1", nodes, [])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// resolveVideoPromptMentions (moved) — @-mention resolution + canonical fallback
// ---------------------------------------------------------------------------

describe("resolveVideoPromptMentions", () => {
  it("resolves @char:N:variant mentions: drops the token, emits a directive, returns variant URLs", () => {
    const nodes = [shiraCharacter(), videoNode("text-to-video", {})]
    const edges: WorkflowEdge[] = [{ id: "e", source: "char-shira", target: "v1" } as WorkflowEdge]
    const out = resolveVideoPromptMentions("@shira:1:smile dancing", "v1", nodes, edges)
    expect(out.prompt).not.toMatch(/@shira:1:smile\b/)
    expect(out.prompt).toContain("Image 1 (shira)")
    expect(out.additionalUrls).toContain("http://shira/smile.png")
  })

  it("attaches a canonical fallback directive when a wired Character is NOT @-mentioned", () => {
    const nodes = [shiraCharacter(), videoNode("text-to-video", {})]
    const edges: WorkflowEdge[] = [{ id: "e", source: "char-shira", target: "v1" } as WorkflowEdge]
    const out = resolveVideoPromptMentions("make her dance", "v1", nodes, edges)
    expect(out.prompt).toContain("Use these characters:")
    expect(out.prompt).toContain("young woman, brown eyes")
    expect(out.prompt?.endsWith("make her dance")).toBe(true)
    expect(out.additionalUrls).toContain("http://shira/portrait.png")
  })

  it("passes the prompt through unchanged when there are no wired characters or extras", () => {
    const nodes = [videoNode("text-to-video", {})]
    const out = resolveVideoPromptMentions("just a sunset", "v1", nodes, [])
    expect(out).toEqual({ prompt: "just a sunset", additionalUrls: [] })
  })
})

// ---------------------------------------------------------------------------
// assembleVideoPrompt — reproduces the RUN composition per node type
// ---------------------------------------------------------------------------

describe("assembleVideoPrompt", () => {
  it("(a) i2v merges motion + cinematography into ONE hint list with the run's join strings", () => {
    // Person node wired to the `cinematography` handle → hint "a weathered fisherman".
    const person = personHintNode("p1", "a weathered fisherman")
    const node = videoNode("image-to-video", {
      prompt: "a man walking",
      motionEnabled: true,
      motion: "dynamic",
    })
    const nodes = [person, node]
    const edges: WorkflowEdge[] = [
      { id: "e", source: "p1", target: "v1", targetHandle: "cinematography" } as WorkflowEdge,
    ]
    const out = assembleVideoPrompt("image-to-video", { node, nodes, edges, refMap: EMPTY_REFMAP })
    // motion hint FIRST, then cinematography, joined by ", "; body joined by ". ".
    expect(out).toBe("a man walking. dynamic motion, a weathered fisherman")
  })

  it("(a') i2v with no motion still folds cinematography hints (motion hint omitted)", () => {
    const person = personHintNode("p1", "a weathered fisherman")
    const node = videoNode("image-to-video", { prompt: "a man walking" })
    const nodes = [person, node]
    const edges: WorkflowEdge[] = [
      { id: "e", source: "p1", target: "v1", targetHandle: "cinematography" } as WorkflowEdge,
    ]
    const out = assembleVideoPrompt("image-to-video", { node, nodes, edges, refMap: EMPTY_REFMAP })
    expect(out).toBe("a man walking. a weathered fisherman")
  })

  it("(b) t2v with a wired identity Character prepends the canonical 'Use these characters:' block (run-faithful; identity clause helper is a no-op)", () => {
    // collectIdentityLockClause is currently hardcoded to "" (deprecated), so
    // the run emits NO standalone identity suffix. What a wired identity-locked
    // Character actually contributes is the canonical-fallback directive block
    // via resolveVideoPromptMentions — pin THAT (the real run behavior).
    const node = videoNode("text-to-video", { prompt: "dancing in the rain" })
    const nodes = [shiraCharacter(), node]
    const edges: WorkflowEdge[] = [{ id: "e", source: "char-shira", target: "v1" } as WorkflowEdge]
    const out = assembleVideoPrompt("text-to-video", { node, nodes, edges, refMap: EMPTY_REFMAP })
    expect(out).toContain("Use these characters:")
    expect(out).toContain("young woman, brown eyes")
    expect(out.endsWith("dancing in the rain")).toBe(true)
  })

  it("(b') t2v folds cinematography hints onto the user prompt with the run's '. ' join", () => {
    const person = personHintNode("p1", "golden hour, anamorphic")
    const node = videoNode("text-to-video", { prompt: "a city street" })
    const nodes = [person, node]
    const edges: WorkflowEdge[] = [
      { id: "e", source: "p1", target: "v1", targetHandle: "look" } as WorkflowEdge,
    ]
    const out = assembleVideoPrompt("text-to-video", { node, nodes, edges, refMap: EMPTY_REFMAP })
    expect(out).toBe("a city street. golden hour, anamorphic")
  })

  it("(c) i2v resolves an @-mention: token removed, directive present", () => {
    const node = videoNode("image-to-video", { prompt: "@shira:1:smile dancing" })
    const nodes = [shiraCharacter(), node]
    const edges: WorkflowEdge[] = [{ id: "e", source: "char-shira", target: "v1" } as WorkflowEdge]
    const out = assembleVideoPrompt("image-to-video", { node, nodes, edges, refMap: EMPTY_REFMAP })
    expect(out).not.toMatch(/@shira:1:smile\b/)
    expect(out).toContain("Image 1 (shira)")
  })

  it("(c') i2v strips {image:N} tokens before folding", () => {
    const node = videoNode("image-to-video", { prompt: "raise the {image:1:sword}" })
    const out = assembleVideoPrompt("image-to-video", {
      node,
      nodes: [node],
      edges: [],
      refMap: EMPTY_REFMAP,
    })
    expect(out).toBe("raise the sword")
  })

  // ── Task 3.2: ref-capable providers RESOLVE {image:N} to @image_N bindings ──
  /** A plain upstream image source wired to the consumer's `references` handle. */
  function refImageSource(id: string): WorkflowNode {
    return { id, type: "upload-image", position: { x: 0, y: 0 }, data: {} } as unknown as WorkflowNode
  }
  /** ONE `references`-handle edge from `src` → the consumer node v1. */
  function refEdge(src: string): WorkflowEdge {
    return { id: `re_${src}`, source: src, target: "v1", targetHandle: "references" } as WorkflowEdge
  }

  it("(c'') i2v with a ref-capable provider RESOLVES {image:1} into an @image_1 binding (NOT stripped)", () => {
    // seedance-2 declares features:["...","reference-image"] → token is bound, not stripped.
    const node = videoNode("image-to-video", { prompt: "circle {image:1:object}", provider: "seedance-2" })
    const nodes = [refImageSource("img1"), node]
    const out = assembleVideoPrompt("image-to-video", { node, nodes, edges: [refEdge("img1")], refMap: EMPTY_REFMAP })
    expect(out).toContain("circle the object from @image_1")
  })

  it("(c''') i2v with a NON-ref-capable provider still STRIPS {image:1} to the bare label", () => {
    // minimax has no `reference-image` feature → legacy strip path (regression guard).
    const node = videoNode("image-to-video", { prompt: "circle {image:1:object}", provider: "minimax" })
    const nodes = [refImageSource("img1"), node]
    const out = assembleVideoPrompt("image-to-video", { node, nodes, edges: [refEdge("img1")], refMap: EMPTY_REFMAP })
    expect(out).toBe("circle object")
  })

  it("(c'''') i2v ref-capable: an OUT-OF-RANGE {image:5} drops to its bare label (only 1 ref wired)", () => {
    const node = videoNode("image-to-video", { prompt: "{image:5:ghost}", provider: "seedance-2" })
    const nodes = [refImageSource("img1"), node]
    const out = assembleVideoPrompt("image-to-video", { node, nodes, edges: [refEdge("img1")], refMap: EMPTY_REFMAP })
    expect(out).toBe("ghost")
  })

  // ── Task 4.2 headline regression: the COUNT must follow MODALITY, not a single
  // handle string. Real generate-video nodes wire image refs on the canonical
  // `imageReferences` handle (generate-video-node.tsx:178) — the preview re-types
  // generate-video to i2v/t2v before dispatching here, so an i2v node fed by an
  // `imageReferences` edge IS the generate-video preview path. Before the fix the
  // count looked only at `references`, so `{image:1}` saw 0 in-range refs and
  // dropped to the bare label even though a ref was wired (RED). The shared
  // modality count now covers the alias (GREEN). ──
  /** ONE edge on the canonical `imageReferences` handle (generate-video wiring). */
  function imageReferencesEdge(src: string): WorkflowEdge {
    return { id: `ire_${src}`, source: src, target: "v1", targetHandle: "imageReferences" } as WorkflowEdge
  }

  it("(c''''') i2v ref-capable: RESOLVES {image:1} when the ref edge is on the canonical `imageReferences` handle (generate-video parity)", () => {
    const node = videoNode("image-to-video", { prompt: "circle {image:1:object}", provider: "seedance-2" })
    const nodes = [refImageSource("img1"), node]
    const out = assembleVideoPrompt("image-to-video", {
      node,
      nodes,
      edges: [imageReferencesEdge("img1")],
      refMap: EMPTY_REFMAP,
    })
    expect(out).toContain("circle the object from @image_1")
  })

  it("(d) motion-transfer returns the bare resolved prompt (NO folding)", () => {
    // Even with a cinematography Person wired, motion-transfer sends no hints.
    const person = personHintNode("p1", "should not appear")
    const node = videoNode("motion-transfer", { prompt: "transfer this dance" })
    const nodes = [person, node]
    const edges: WorkflowEdge[] = [
      { id: "e", source: "p1", target: "v1", targetHandle: "cinematography" } as WorkflowEdge,
    ]
    const out = assembleVideoPrompt("motion-transfer", { node, nodes, edges, refMap: EMPTY_REFMAP })
    expect(out).toBe("transfer this dance")
  })

  it("(d') video-sfx returns the bare resolved prompt (NO folding)", () => {
    const node = videoNode("video-sfx", { prompt: "add thunder rumbles" })
    const out = assembleVideoPrompt("video-sfx", {
      node,
      nodes: [node],
      edges: [],
      refMap: EMPTY_REFMAP,
    })
    expect(out).toBe("add thunder rumbles")
  })

  it("resolves {Node Label} variable refs in the typed prompt via refMap", () => {
    const node = videoNode("text-to-video", { prompt: "a {Subject} at dusk" })
    const refMap = new Map<string, string>([["Subject", "lighthouse"]])
    const out = assembleVideoPrompt("text-to-video", { node, nodes: [node], edges: [], refMap })
    expect(out).toBe("a lighthouse at dusk")
  })

  it("returns '' for an empty prompt with no hints/characters", () => {
    const node = videoNode("text-to-video", {})
    const out = assembleVideoPrompt("text-to-video", {
      node,
      nodes: [node],
      edges: [],
      refMap: EMPTY_REFMAP,
    })
    expect(out).toBe("")
  })
})
