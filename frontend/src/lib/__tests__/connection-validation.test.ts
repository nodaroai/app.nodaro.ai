import { describe, expect, it } from "vitest"
import {
  isValidWorkflowConnection,
  resolveEffectiveSourceType,
  enumerableSourceHandles,
  collectTargetCandidates,
} from "../connection-validation"
import { resolveTargetHandle, getCompatibleNodes } from "../node-compatibility"
import { getTargetHandlesAccepting } from "../target-handle-registry"
import { isValidImageToImageConnection } from "../image-producer-handles"
import { isValidGenerateImageConnection } from "../generate-image-handles"
import { isVisualPickerType } from "../parameter-picker-types"
import { NODE_DEFINITIONS, NODE_DEF_MAP } from "@/types/nodes"

describe("isValidWorkflowConnection (generate-video dispatch)", () => {
  it("dispatches to generate-video validator for generate-video target", () => {
    const ok = isValidWorkflowConnection(
      {
        source: "src",
        target: "gv1",
        sourceHandle: "image",
        targetHandle: "startFrame",
      },
      (id: string) => (id === "gv1" ? "generate-video" : "generate-image"),
    )
    expect(ok).toBe(true)
  })

  it("refuses video producer on startFrame (image-only)", () => {
    const ok = isValidWorkflowConnection(
      {
        source: "src",
        target: "gv1",
        sourceHandle: "video",
        targetHandle: "startFrame",
      },
      // Both src + target are generate-video — source produces video,
      // and startFrame is image-only.
      (_id: string) => "generate-video",
    )
    expect(ok).toBe(false)
  })

  it("accepts video producer on videoReferences", () => {
    const ok = isValidWorkflowConnection(
      {
        source: "src",
        target: "gv1",
        sourceHandle: "video",
        targetHandle: "videoReferences",
      },
      (_id: string) => "generate-video",
    )
    expect(ok).toBe(true)
  })

  it("still dispatches to generate-image for generate-image target", () => {
    // Sanity: the new arm doesn't break the existing image dispatch.
    const ok = isValidWorkflowConnection(
      {
        source: "src",
        target: "gi1",
        sourceHandle: "image",
        targetHandle: "references",
      },
      (id: string) => (id === "gi1" ? "generate-image" : "generate-image"),
    )
    expect(ok).toBe(true)
  })
})

// ─── cinematic-avatar ref-* connectivity (drop-time validator) ──────────
// Regression: cinematic-avatar renders ref-video / ref-audio / ref-image
// target handles, each accepting one media producer. The bug was that
// NODE_DEFINITIONS.inputs only listed "prompt", so source-direction
// enumeration never offered cinematic-avatar and resolveTargetHandle
// pointed at a non-existent "in" handle.
describe("cinematic-avatar ref-* connection validity", () => {
  const getType = (target: string, source: string) => (id: string) =>
    id === "ca1" ? "cinematic-avatar" : (id === "src" ? source : target)

  it("accepts a video producer on ref-video", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "ca1", sourceHandle: "video", targetHandle: "ref-video" },
      getType("cinematic-avatar", "generate-video"),
    )
    expect(ok).toBe(true)
  })

  it("accepts an audio producer on ref-audio", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "ca1", sourceHandle: "audio", targetHandle: "ref-audio" },
      getType("cinematic-avatar", "text-to-speech"),
    )
    expect(ok).toBe(true)
  })

  it("accepts an image producer on ref-image", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "ca1", sourceHandle: "image", targetHandle: "ref-image" },
      getType("cinematic-avatar", "generate-image"),
    )
    expect(ok).toBe(true)
  })

  it("rejects an audio producer on ref-video (wrong media type)", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "ca1", sourceHandle: "audio", targetHandle: "ref-video" },
      getType("cinematic-avatar", "text-to-speech"),
    )
    expect(ok).toBe(false)
  })
})

// ─── ai-avatar typed input connectivity (drop-time validator) ───────────
describe("ai-avatar typed input connection validity", () => {
  const getType = (source: string) => (id: string) =>
    id === "aa1" ? "ai-avatar" : (id === "src" ? source : "preview")

  it("accepts a text producer on script", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "aa1", sourceHandle: "text", targetHandle: "script" },
      getType("text-prompt"),
    )
    expect(ok).toBe(true)
  })

  it("rejects a parameter picker (mood) on script (verbatim text only, no picker prose)", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "aa1", sourceHandle: "out", targetHandle: "script" },
      getType("mood"),
    )
    expect(ok).toBe(false)
  })

  it("accepts an image producer on image", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "aa1", sourceHandle: "image", targetHandle: "image" },
      getType("generate-image"),
    )
    expect(ok).toBe(true)
  })

  it("accepts an audio producer on audio", () => {
    const ok = isValidWorkflowConnection(
      { source: "src", target: "aa1", sourceHandle: "audio", targetHandle: "audio" },
      getType("text-to-speech"),
    )
    expect(ok).toBe(true)
  })
})

// ─── Source-direction enumeration + handle resolution ───────────────────
// Mirrors dragging a wire OUT of a producer: cinematic-avatar must surface
// as a candidate consumer AND resolveTargetHandle must point the wire at
// the correct ref-* handle (not the non-existent "in").
describe("cinematic-avatar source-direction connectivity", () => {
  const options = NODE_DEFINITIONS.map((d) => ({
    type: d.type,
    label: d.label,
    icon: null,
    category: d.category,
  }))

  it("resolveTargetHandle maps video → ref-video", () => {
    expect(resolveTargetHandle("cinematic-avatar", "video", "source")).toBe("ref-video")
  })

  it("resolveTargetHandle maps audio → ref-audio", () => {
    expect(resolveTargetHandle("cinematic-avatar", "audio", "source")).toBe("ref-audio")
  })

  it("resolveTargetHandle maps image → ref-image", () => {
    expect(resolveTargetHandle("cinematic-avatar", "image", "source")).toBe("ref-image")
  })

  it("a video producer dragging out offers cinematic-avatar as a candidate", () => {
    const { directTypes } = getCompatibleNodes("video", "source", options)
    expect(directTypes.has("cinematic-avatar")).toBe(true)
  })

  it("an image producer dragging out offers cinematic-avatar as a candidate", () => {
    const { directTypes } = getCompatibleNodes("image", "source", options)
    expect(directTypes.has("cinematic-avatar")).toBe(true)
  })

  it("an audio producer dragging out offers cinematic-avatar as a candidate", () => {
    const { directTypes } = getCompatibleNodes("audio", "source", options)
    expect(directTypes.has("cinematic-avatar")).toBe(true)
  })
})

// Phase 4: the motion-graphics `lottie` source handle (lottie engine) carries
// the authored Lottie JSON URL and may ONLY feed a lottie-overlay `lottie`
// target. Symmetric to the `composition` source rule.
describe("motion-graphics lottie source handle connectivity", () => {
  const typeOf = (id: string) =>
    id === "mg" ? "motion-graphics" : id === "lo" ? "lottie-overlay" : id === "rv" ? "render-video" : "generate-image"

  it("allows motion-graphics lottie → lottie-overlay lottie", () => {
    const ok = isValidWorkflowConnection(
      { source: "mg", target: "lo", sourceHandle: "lottie", targetHandle: "lottie" },
      typeOf,
    )
    expect(ok).toBe(true)
  })

  it("rejects the lottie source onto render-video (composition consumer)", () => {
    const ok = isValidWorkflowConnection(
      { source: "mg", target: "rv", sourceHandle: "lottie", targetHandle: "composition" },
      typeOf,
    )
    expect(ok).toBe(false)
  })

  it("rejects the lottie source onto a non-lottie target handle of lottie-overlay", () => {
    const ok = isValidWorkflowConnection(
      { source: "mg", target: "lo", sourceHandle: "lottie", targetHandle: "video" },
      typeOf,
    )
    expect(ok).toBe(false)
  })

  it("lottie-overlay lottie target accepts motion-graphics but not arbitrary producers", () => {
    expect(
      isValidWorkflowConnection(
        { source: "mg", target: "lo", sourceHandle: "lottie", targetHandle: "lottie" },
        typeOf,
      ),
    ).toBe(true)
    // An image producer dragging into the lottie target (no sourceHandle "lottie"
    // restriction on its side) must be rejected by the target predicate.
    expect(
      isValidWorkflowConnection(
        { source: "gi", target: "lo", sourceHandle: "image", targetHandle: "lottie" },
        (id: string) => (id === "lo" ? "lottie-overlay" : "generate-image"),
      ),
    ).toBe(false)
  })

  it("a motion-graphics node dragging out offers lottie-overlay as a candidate", () => {
    const options = NODE_DEFINITIONS.map((d) => ({ type: d.type, label: d.label, icon: null, category: d.category }))
    const { directTypes } = getCompatibleNodes("lottie", "source", options)
    expect(directTypes.has("lottie-overlay")).toBe(true)
  })

  it("the lottie target's add-node popup offers motion-graphics as a candidate", () => {
    const options = NODE_DEFINITIONS.map((d) => ({ type: d.type, label: d.label, icon: null, category: d.category }))
    const { directTypes } = getCompatibleNodes("lottie", "target", options, "lottie-overlay")
    expect(directTypes.has("motion-graphics")).toBe(true)
  })
})

// PR #3369: the Character node exposes a plain `image` source handle (the
// portrait URL) alongside the `characterRef` identity handle. From the `image`
// handle the character behaves as a plain image PRODUCER — valid into image
// inputs (generate-image `references`, image-to-image `image`, etc.) and NOT as
// an identity ref (must not reach `assets`). The `characterRef` handle (and the
// no-sourceHandle legacy case) stay identity-only — UNCHANGED.
describe("character image source handle → image inputs (PR #3369)", () => {
  const getNodeType = (id: string) =>
    ({ c: "character", g: "generate-image", v: "generate-video", i: "image-to-image" } as Record<string, string>)[id] ?? id

  it("character `image` handle → generate-image `references` is valid (the fix)", () => {
    const ok = isValidWorkflowConnection(
      { source: "c", target: "g", sourceHandle: "image", targetHandle: "references" },
      getNodeType,
    )
    expect(ok).toBe(true)
  })

  it("character `image` handle → generate-image `assets` is rejected (plain image is not identity)", () => {
    const ok = isValidWorkflowConnection(
      { source: "c", target: "g", sourceHandle: "image", targetHandle: "assets" },
      getNodeType,
    )
    expect(ok).toBe(false)
  })

  it("character `characterRef` handle → generate-image `assets` stays valid (identity UNCHANGED)", () => {
    const ok = isValidWorkflowConnection(
      { source: "c", target: "g", sourceHandle: "characterRef", targetHandle: "assets" },
      getNodeType,
    )
    expect(ok).toBe(true)
  })

  it("character with NO sourceHandle → generate-image `assets` stays valid (identity UNCHANGED)", () => {
    const ok = isValidWorkflowConnection(
      { source: "c", target: "g", targetHandle: "assets" },
      getNodeType,
    )
    expect(ok).toBe(true)
  })

  it("character `characterRef` handle → generate-image `references` is rejected (identity is not a plain image, UNCHANGED)", () => {
    const ok = isValidWorkflowConnection(
      { source: "c", target: "g", sourceHandle: "characterRef", targetHandle: "references" },
      getNodeType,
    )
    expect(ok).toBe(false)
  })

  it("character `image` handle → image-to-image `image` input is valid", () => {
    const ok = isValidWorkflowConnection(
      { source: "c", target: "i", sourceHandle: "image", targetHandle: "image" },
      getNodeType,
    )
    expect(ok).toBe(true)
  })

  it("character `image` handle → generate-video `imageReferences` is valid (plain image into a video image input)", () => {
    const ok = isValidWorkflowConnection(
      { source: "c", target: "v", sourceHandle: "image", targetHandle: "imageReferences" },
      getNodeType,
    )
    expect(ok).toBe(true)
  })
})

// Phase 1 (entity-studios-parity §3): generalize the plain `image` source handle
// from character to ALL four entities (location / object / creature). Each entity
// node now exposes its identity `*Ref` handle PLUS a plain `image` handle that
// emits the portrait URL — behaving as a plain image PRODUCER (valid into image
// inputs, NOT identity). The identity `*Ref` handle stays identity-only,
// UNCHANGED. Mirrors the character block above for each entity.
describe.each([
  { entity: "location", refHandle: "locationRef" },
  { entity: "object", refHandle: "objectRef" },
  { entity: "creature", refHandle: "creatureRef" },
])("$entity image source handle → image inputs (Phase 1)", ({ entity, refHandle }) => {
  const getNodeType = (id: string) =>
    ({ e: entity, g: "generate-image", v: "generate-video", i: "image-to-image" } as Record<string, string>)[id] ?? id

  it(`${entity} \`image\` handle → generate-image \`references\` is valid (plain image)`, () => {
    const ok = isValidWorkflowConnection(
      { source: "e", target: "g", sourceHandle: "image", targetHandle: "references" },
      getNodeType,
    )
    expect(ok).toBe(true)
  })

  it(`${entity} \`image\` handle → generate-image \`assets\` is rejected (plain image is not identity)`, () => {
    const ok = isValidWorkflowConnection(
      { source: "e", target: "g", sourceHandle: "image", targetHandle: "assets" },
      getNodeType,
    )
    expect(ok).toBe(false)
  })

  it(`${entity} \`image\` handle → image-to-image \`image\` input is valid`, () => {
    const ok = isValidWorkflowConnection(
      { source: "e", target: "i", sourceHandle: "image", targetHandle: "image" },
      getNodeType,
    )
    expect(ok).toBe(true)
  })

  it(`${entity} \`image\` handle → generate-video \`imageReferences\` is valid`, () => {
    const ok = isValidWorkflowConnection(
      { source: "e", target: "v", sourceHandle: "image", targetHandle: "imageReferences" },
      getNodeType,
    )
    expect(ok).toBe(true)
  })

  it(`${entity} \`${refHandle}\` identity handle → generate-image \`assets\` stays valid (identity UNCHANGED)`, () => {
    const ok = isValidWorkflowConnection(
      { source: "e", target: "g", sourceHandle: refHandle, targetHandle: "assets" },
      getNodeType,
    )
    expect(ok).toBe(true)
  })

  it(`${entity} \`${refHandle}\` identity handle → generate-image \`references\` is rejected (identity is not a plain image)`, () => {
    const ok = isValidWorkflowConnection(
      { source: "e", target: "g", sourceHandle: refHandle, targetHandle: "references" },
      getNodeType,
    )
    expect(ok).toBe(false)
  })
})

// Bug (#bugs session): an entity's plain `image` source handle was wired to
// image inputs by the DROP validator (isValidWorkflowConnection — the tests
// above), but the two DISCOVERY surfaces that tell the user "what can I
// connect this to" both keyed off the source NODE TYPE ("character") instead
// of the handle's emitted type, so:
//   - the drag-glow (`isValidCandidate`) never lit up image-input pips, and
//   - the source-direction popover candidate list never enumerated them.
// `resolveEffectiveSourceType` is the single source of truth for the remap
// (image handle on an entity emits "upload-image"); all three surfaces now
// route through it so discovery agrees with the drop validator.
describe("resolveEffectiveSourceType (entity image handle → upload-image)", () => {
  const ENTITIES = ["character", "location", "object", "creature"] as const

  it.each(ENTITIES)("%s `image` handle resolves to the plain image producer", (entity) => {
    expect(resolveEffectiveSourceType(entity, "image")).toBe("upload-image")
  })

  it.each(ENTITIES)("%s identity ref handle is left UNCHANGED", (entity) => {
    const refHandle = `${entity === "character" ? "character" : entity}Ref`
    expect(resolveEffectiveSourceType(entity, refHandle)).toBe(entity)
  })

  it("a missing source handle leaves the type unchanged (legacy edges)", () => {
    expect(resolveEffectiveSourceType("character", undefined)).toBe("character")
    expect(resolveEffectiveSourceType("character", null)).toBe("character")
  })

  it("a NON-entity node's `image` handle is left unchanged (only entities remap)", () => {
    expect(resolveEffectiveSourceType("generate-image", "image")).toBe("generate-image")
    expect(resolveEffectiveSourceType("upload-image", "image")).toBe("upload-image")
  })

  it("an unknown / undefined source type stays falsy-safe", () => {
    expect(resolveEffectiveSourceType(undefined, "image")).toBe("")
  })
})

// The discovery surfaces enumerate candidates via getTargetHandlesAccepting.
// After the fix they call it with the REMAPPED type for the entity `image`
// handle — so image inputs surface, and identity-only consumers do not.
describe("entity image handle is discoverable as an image producer", () => {
  const has = (sourceType: string, nodeType: string, handleId: string) =>
    getTargetHandlesAccepting(sourceType).some(
      (m) => m.nodeType === nodeType && m.handleId === handleId,
    )

  it.each(["character", "location", "object", "creature"] as const)(
    "%s `image` handle surfaces image-input targets (the fix)",
    (entity) => {
      const effective = resolveEffectiveSourceType(entity, "image")
      expect(has(effective, "image-to-image", "image")).toBe(true)
      expect(has(effective, "generate-image", "references")).toBe(true)
      expect(has(effective, "lip-sync", "image")).toBe(true)
    },
  )

  it("the entity `image` handle does NOT offer identity-only consumers", () => {
    const effective = resolveEffectiveSourceType("character", "image")
    expect(has(effective, "character-fx", "target")).toBe(false)
    expect(has(effective, "reference-sheet", "in")).toBe(false)
  })

  it("the raw identity type still offers identity consumers (characterRef path UNCHANGED)", () => {
    // characterRef resolves to the raw "character" type — identity behavior.
    expect(resolveEffectiveSourceType("character", "characterRef")).toBe("character")
    expect(has("character", "character-fx", "target")).toBe(true)
    expect(has("character", "reference-sheet", "in")).toBe(true)
  })
})

// Reverse direction (the second half of the fix): the target-direction popover
// — opened by clicking an image INPUT pip — enumerates upstream producer
// candidates. The entity `image` output is NOT declared in NODE_DEFINITIONS
// (its declared output is the `*Ref` handle), so the old "node-type + outputs[0]"
// scan never offered it. enumerableSourceHandles augments the declared outputs
// with the entity `image` passthrough (sourced from the same SSOT as the remap).
describe("enumerableSourceHandles (entity image passthrough)", () => {
  it.each([
    ["character", "characterRef"],
    ["location", "locationRef"],
    ["object", "objectRef"],
    ["creature", "creatureRef"],
  ])("%s adds the `image` passthrough handle to its declared outputs", (entity, ref) => {
    expect(enumerableSourceHandles(entity, [ref])).toEqual([ref, "image"])
  })

  it("does not duplicate `image` when it is already declared", () => {
    expect(enumerableSourceHandles("character", ["characterRef", "image"])).toEqual([
      "characterRef",
      "image",
    ])
  })

  it("leaves non-entity outputs unchanged (face has no image output)", () => {
    expect(enumerableSourceHandles("generate-image", ["image"])).toEqual(["image"])
    expect(enumerableSourceHandles("face", ["faceRef"])).toEqual(["faceRef"])
  })
})

describe("collectTargetCandidates (image input lists entity image output)", () => {
  const outputsOf = (t: string) => NODE_DEF_MAP.get(t as never)?.outputs
  const mkNodes = (...defs: ReadonlyArray<readonly [string, string]>) =>
    defs.map(([id, type]) => ({ id, type }))
  const typeById = (nodes: ReadonlyArray<{ id: string; type?: string }>) => (id: string) =>
    nodes.find((n) => n.id === id)?.type
  const acceptsImageInput = (t: string) =>
    isValidImageToImageConnection("image", t, isVisualPickerType)
  const acceptsIdentityInput = (t: string) =>
    isValidGenerateImageConnection("assets", t, isVisualPickerType)

  it.each(["character", "location", "object", "creature"])(
    "an image input lists %s wired to its `image` output (the fix)",
    (entity) => {
      const nodes = mkNodes(["e1", entity], ["i2i", "image-to-image"])
      const { candidates } = collectTargetCandidates({
        nodes,
        edges: [],
        consumerId: "i2i",
        consumerHandleId: "image",
        alreadyConnectedIds: new Set(),
        accepts: acceptsImageInput,
        nodeTypeById: typeById(nodes),
        outputsOf,
      })
      expect(candidates).toContainEqual({ nodeId: "e1", nodeType: entity, sourceHandle: "image" })
    },
  )

  it("an identity input lists character wired to `characterRef`, NOT image (UNCHANGED)", () => {
    const nodes = mkNodes(["c1", "character"], ["gi", "generate-image"])
    const { candidates } = collectTargetCandidates({
      nodes,
      edges: [],
      consumerId: "gi",
      consumerHandleId: "assets",
      alreadyConnectedIds: new Set(),
      accepts: acceptsIdentityInput,
      nodeTypeById: typeById(nodes),
      outputsOf,
    })
    const forChar = candidates.filter((c) => c.nodeId === "c1")
    expect(forChar).toEqual([{ nodeId: "c1", nodeType: "character", sourceHandle: "characterRef" }])
  })

  it("a plain image producer is still listed wired to its `image` output (UNCHANGED)", () => {
    const nodes = mkNodes(["gi", "generate-image"], ["i2i", "image-to-image"])
    const { candidates } = collectTargetCandidates({
      nodes,
      edges: [],
      consumerId: "i2i",
      consumerHandleId: "image",
      alreadyConnectedIds: new Set(),
      accepts: acceptsImageInput,
      nodeTypeById: typeById(nodes),
      outputsOf,
    })
    expect(candidates).toContainEqual({ nodeId: "gi", nodeType: "generate-image", sourceHandle: "image" })
  })

  it("excludes already-connected and cycle-inducing candidates", () => {
    const nodes = mkNodes(["c1", "character"], ["i2i", "image-to-image"])
    const base = {
      nodes,
      consumerId: "i2i",
      consumerHandleId: "image",
      accepts: acceptsImageInput,
      nodeTypeById: typeById(nodes),
      outputsOf,
    }
    // Already wired on this handle → not re-offered.
    expect(
      collectTargetCandidates({ ...base, edges: [], alreadyConnectedIds: new Set(["c1"]) }).candidates,
    ).toHaveLength(0)
    // c1 is downstream of the consumer (i2i → c1), so wiring c1 → i2i closes a cycle.
    expect(
      collectTargetCandidates({
        ...base,
        edges: [{ source: "i2i", target: "c1" }],
        alreadyConnectedIds: new Set(),
      }).candidates,
    ).toHaveLength(0)
  })
})

describe("audio-separation source → audio/media inputs (regression)", () => {
  const typeOf = (id: string) => id // node id == node type in these probes
  it("audio-separation vocals → voice-changer audio input", () => {
    expect(isValidWorkflowConnection(
      { source: "audio-separation", target: "voice-changer", sourceHandle: "vocals", targetHandle: "audio" },
      typeOf,
    )).toBe(true)
  })
  it("audio-separation instrumental → merge-video-audio media input", () => {
    expect(isValidWorkflowConnection(
      { source: "audio-separation", target: "merge-video-audio", sourceHandle: "instrumental", targetHandle: "in" },
      typeOf,
    )).toBe(true)
  })
  it("audio-separation drums → mix-audio input", () => {
    expect(isValidWorkflowConnection(
      { source: "audio-separation", target: "mix-audio", sourceHandle: "drums", targetHandle: "in" },
      typeOf,
    )).toBe(true)
  })
})
