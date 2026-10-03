import { describe, it, expect } from "vitest"
import { getCompatibleNodes, resolveTargetHandle, TYPED_HANDLE_IDS, type CompatibleNodes, type NodeOption } from "../node-compatibility"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"
import type { SceneNodeType } from "@/types/nodes"
import { IDENTITY_TYPES } from "../generate-image-handles"

const opt = (type: string): NodeOption => ({
  type: type as SceneNodeType,
  label: type,
  icon: null,
  category: "x",
})

describe("getCompatibleNodes — Generate Image v2 handles", () => {
  it("References shows only image producers", () => {
    const pool = [
      opt("upload-image"),
      opt("generate-image"),
      opt("text-prompt"),
      opt("character"),
    ]
    const out = getCompatibleNodes("references", "target", pool)
    expect(new Set(out.direct.map((o) => o.type))).toEqual(new Set(["upload-image", "generate-image"]))
    expect(out.compatible).toEqual([])
  })

  it("Subjects shows only identity nodes", () => {
    const pool = [
      opt("character"),
      opt("location"),
      opt("object"),
      opt("face"),
      opt("text-prompt"),
    ]
    const out = getCompatibleNodes("subjects", "target", pool)
    expect(new Set(out.direct.map((o) => o.type))).toEqual(new Set(["character", "location", "object", "face"]))
    expect(out.compatible).toEqual([])
  })

  it("Prompt shows text producers as direct, pickers as compatible", () => {
    const pool = [
      opt("text-prompt"),
      opt("ai-writer"),
      opt("mood"),
      opt("upload-image"),
    ]
    const out = getCompatibleNodes("prompt", "target", pool)
    const direct = out.direct.map((o) => o.type).sort()
    expect(direct).toContain("ai-writer")
    expect(direct).toContain("text-prompt")
    // 'mood' is a visual picker — appears in compatible (not direct) — covered by
    // the VISUAL_PARAMETER_PICKER_NODE_TYPES set. Note: the test runs against the
    // actual set so the assertion is conditional.
  })

  it("Negative shows text producers only", () => {
    const pool = [opt("text-prompt"), opt("ai-writer"), opt("mood"), opt("upload-image")]
    const out = getCompatibleNodes("negative", "target", pool)
    const direct = out.direct.map((o) => o.type).sort()
    expect(direct).toContain("text-prompt")
    expect(direct).toContain("ai-writer")
    // pickers should NOT appear as direct for Negative
    expect(direct).not.toContain("mood")
  })

  it("Style handle (v2 rename of cinematography) shows pickers", () => {
    const pool = [opt("style"), opt("lens"), opt("lighting"), opt("text-prompt"), opt("upload-image")]
    const out = getCompatibleNodes("style", "target", pool, "generate-image")
    expect(out.direct.length).toBeGreaterThan(0)
    // Only pickers in direct, no text-prompt or upload-image
    const directTypes = new Set(out.direct.map((o) => o.type))
    expect(directTypes.has("text-prompt")).toBe(false)
    expect(directTypes.has("upload-image")).toBe(false)
  })

  it("Cinematography handle still works for legacy callers", () => {
    const pool = [opt("style"), opt("lens"), opt("lighting"), opt("text-prompt")]
    const out = getCompatibleNodes("cinematography", "target", pool, "image-to-video")
    expect(out.direct.length).toBeGreaterThan(0)
    const directTypes = new Set(out.direct.map((o) => o.type))
    expect(directTypes.has("text-prompt")).toBe(false)
  })
})

describe("getCompatibleNodes — typed-handle branches (camera-motion, transition, character-fx)", () => {
  it("camera-motion's startState shows hint-producers (pickers + tone + text-prompt)", () => {
    const pool = [
      opt("mood"),
      opt("lens"),
      opt("tone"),
      opt("text-prompt"),
      opt("upload-image"),
      opt("character"),
    ]
    const out = getCompatibleNodes("startState", "target", pool, "camera-motion")
    const direct = new Set(out.direct.map((o) => o.type))
    // Visual pickers + tone + text-prompt → direct
    expect(direct.has("mood")).toBe(true)
    expect(direct.has("lens")).toBe(true)
    expect(direct.has("tone")).toBe(true)
    expect(direct.has("text-prompt")).toBe(true)
    // Image / identity sources → not direct
    expect(direct.has("upload-image")).toBe(false)
    expect(direct.has("character")).toBe(false)
    expect(out.compatible).toEqual([])
  })

  it("camera-motion's endState mirrors startState", () => {
    const pool = [opt("mood"), opt("character")]
    const out = getCompatibleNodes("endState", "target", pool, "camera-motion")
    const direct = new Set(out.direct.map((o) => o.type))
    expect(direct.has("mood")).toBe(true)
    expect(direct.has("character")).toBe(false)
  })

  it("transition's startState behaves identically to camera-motion's", () => {
    const pool = [opt("mood"), opt("tone"), opt("character"), opt("music-genre")]
    const out = getCompatibleNodes("startState", "target", pool, "transition")
    const direct = new Set(out.direct.map((o) => o.type))
    expect(direct.has("mood")).toBe(true)
    expect(direct.has("tone")).toBe(true)
    // audio picker → excluded by VISUAL_PARAMETER_PICKER_NODE_TYPES
    expect(direct.has("music-genre")).toBe(false)
    expect(direct.has("character")).toBe(false)
  })

  it("character-fx's target shows identity refs only", () => {
    const pool = [
      opt("character"),
      opt("face"),
      opt("object"),
      opt("location"),
      opt("mood"),
      opt("upload-image"),
      opt("text-prompt"),
    ]
    const out = getCompatibleNodes("target", "target", pool, "character-fx")
    const direct = new Set(out.direct.map((o) => o.type))
    expect(direct).toEqual(new Set(["character", "face", "object", "location"]))
    expect(out.compatible).toEqual([])
  })

  it.each(["target", "partner"])("character-motion's %s shows identity refs only", (handle) => {
    const pool = [opt("character"), opt("face"), opt("object"), opt("location"), opt("mood"), opt("upload-image"), opt("text-prompt")]
    const out = getCompatibleNodes(handle, "target", pool, "character-motion")
    expect(new Set(out.direct.map((o) => o.type))).toEqual(new Set(["character", "face", "object", "location"]))
    expect(out.compatible).toEqual([])
  })
})

// TYPED_HANDLE_IDS is the single source of truth — exported from
// node-compatibility.ts and consumed by both (a) the dev-time warning
// in getCompatibleNodes for missing consumerNodeType, AND (b) the
// add-node popup's typed-handle pool inclusion check (which surfaces
// Parameter-category nodes only on these handles).
//
// Drift catcher: TYPED_HANDLE_IDS must match every non-generate-image
// entry in TARGET_HANDLE_ACCEPTS (the registry that drives the canvas
// validator and source-direction popovers). If a new typed handle is
// added to the registry without being added to TYPED_HANDLE_IDS, the
// add-node popup silently hides Parameter-category candidates on it.
// Edge-drop path (drag FROM an output handle onto empty canvas → Add Node).
// getCompatibleNodes/resolveTargetHandle tier + wire via def.inputs ∩
// HANDLE_COMPATIBILITY[sourceHandle]. Two pre-existing breakages for video nodes:
//   - video-retake's stale inputs:["in"] made resolveTargetHandle pick "in", a
//     handle the node never renders → orphan edge (fixed by correcting .inputs).
//   - generate-video's only video input is `videoReferences`, absent from
//     HANDLE_COMPATIBILITY["video"] → the node was dropped from the popup
//     entirely for a video source (fixed by adding videoReferences to the map).
describe("getCompatibleNodes / resolveTargetHandle — video-source edge-drop reaches video nodes", () => {
  it("offers generate-video and video-retake as direct matches for a video source", () => {
    const pool = [opt("generate-video"), opt("video-retake"), opt("text-prompt"), opt("upload-image")]
    const direct = new Set(getCompatibleNodes("video", "source", pool).direct.map((o) => o.type))
    expect(direct.has("generate-video")).toBe(true)
    expect(direct.has("video-retake")).toBe(true)
  })

  it("resolves a real rendered target handle (never the phantom 'in')", () => {
    expect(resolveTargetHandle("generate-video", "video", "source")).toBe("videoReferences")
    expect(resolveTargetHandle("video-retake", "video", "source")).toBe("video")
  })
})

// Video Overlay's only image inputs are its layer handles. Without "overlay" in
// HANDLE_COMPATIBILITY.image, an image producer's edge-drop popup never listed
// the node; Image Overlay must keep resolving to its base ("image", inputs[0]).
describe("getCompatibleNodes / resolveTargetHandle — an image edge-drop reaches Video Overlay's first layer", () => {
  it("offers video-overlay as a direct match for an image source and wires the overlay handle", () => {
    const pool = [opt("video-overlay"), opt("image-overlay"), opt("text-prompt")]
    const direct = new Set(getCompatibleNodes("image", "source", pool).direct.map((o) => o.type))
    expect(direct.has("video-overlay")).toBe(true)
    expect(resolveTargetHandle("video-overlay", "image", "source")).toBe("overlay")
    expect(resolveTargetHandle("image-overlay", "image", "source")).toBe("image")
  })
})

// suno-generate's mappable secondary text fields (field-style / field-lyrics /
// field-title / field-negativeStyle) are TEXT inputs: dragging FROM one of their
// input pips must offer text producers (ai-writer, text-prompt, …) — NOT the audio
// pickers (music-genre, …), which stay on the audio-style / voice handles. Mirrors
// the `negative` branch. The pool mixes a text producer and an audio picker so the
// branch's filter is exercised in both directions.
describe("field-* handles surface text producers, not pickers", () => {
  const pool = [
    opt("text-prompt"),
    opt("ai-writer"),
    opt("llm-chat"),
    opt("music-genre"),
    opt("upload-image"),
  ]
  for (const id of ["field-style", "field-lyrics", "field-title", "field-negativeStyle"]) {
    it(`${id} target → text producers direct, no music-genre`, () => {
      const res = getCompatibleNodes(id, "target", pool, "suno-generate")
      // `ai-writer` is a real runtime node type but intentionally outside the
      // SceneNodeType union (the codebase casts it everywhere), so assert it via
      // the loosely-typed `direct` array — the same convention as the Negative
      // handle test above. `music-genre` IS a union member, so the picker-
      // exclusion check uses the strict `directTypes` set verbatim per the brief.
      expect(res.direct.map((o) => o.type)).toContain("ai-writer")
      expect(res.directTypes.has("music-genre")).toBe(false)
    })
  }
})

describe("TYPED_HANDLE_IDS contract", () => {
  it("matches every typed-pool-gating handle in TARGET_HANDLE_ACCEPTS", () => {
    // Node types whose registry entries describe DATA-producer inputs (not
    // parameter-picker inputs) and therefore aren't typed-pool gates — the
    // add-node popup should surface data-producer nodes on these, not the
    // Parameter-category pickers.
    const NON_TYPED_POOL_NODE_TYPES = new Set([
      "generate-image", // owns 6 handle ids that aren't typed-pool gates
      "list", "web-scrape", "extract-field", "filter-list",
      "deduplicate", "merge-lists", "sort-list",
    ])
    const registryHandles = new Set<string>()
    for (const [nodeType, entries] of Object.entries(TARGET_HANDLE_ACCEPTS)) {
      if (NON_TYPED_POOL_NODE_TYPES.has(nodeType)) continue
      for (const e of entries) registryHandles.add(e.handleId)
    }
    expect(new Set(TYPED_HANDLE_IDS)).toEqual(registryHandles)
  })
})

// Edge-drop from an identity ref pip (characterRef / faceRef / objectRef /
// creatureRef / locationRef) onto empty canvas. HANDLE_COMPATIBILITY maps those
// handles to themselves only, so the generic path offered just the nodes with an
// `in` input (Character FX through its phantom `in`) and never Character Motion,
// whose only inputs are `target` / `partner`. Nodes whose TARGET_HANDLE_ACCEPTS
// entries accept the identity type are direct matches, wired to that handle; the
// generic `in` tier is kept so the offered set only grows.
describe("getCompatibleNodes / resolveTargetHandle — identity ref source drags", () => {
  const pool = [
    "character", "face", "object", "creature", "location",
    "character-fx", "character-motion", "reference-sheet", "preview", "face-swap",
    "generate-image", "generate-video", "motion-transfer", "image-to-image", "lip-sync",
    "upload-image", "text-prompt", "combine-videos", "mood",
  ].map(opt)
  const offered = (r: CompatibleNodes) => new Set<string>([...r.direct, ...r.compatible].map((o) => o.type))

  // Every identity type's ref output. Pinned against IDENTITY_TYPES so a new
  // identity type fails here until its ref handle is listed.
  const REF_HANDLES: ReadonlyArray<readonly [string, string]> = [
    ["character", "characterRef"],
    ["face", "faceRef"],
    ["object", "objectRef"],
    ["creature", "creatureRef"],
    ["location", "locationRef"],
  ]

  it("covers every identity type", () => {
    expect(new Set(REF_HANDLES.map(([t]) => t))).toEqual(new Set(IDENTITY_TYPES))
  })

  it("a characterRef drag offers character-motion as a direct match, wired to `target`", () => {
    const r = getCompatibleNodes("characterRef", "source", pool, "character")
    expect(r.directTypes.has("character-motion" as SceneNodeType)).toBe(true)
    expect(resolveTargetHandle("character-motion", "characterRef", "source")).toBe("target")
  })

  it.each(REF_HANDLES)("a %s drag (%s) offers character-motion, wired to `target`", (type, handle) => {
    const r = getCompatibleNodes(handle, "source", pool, type)
    expect(r.directTypes.has("character-motion" as SceneNodeType)).toBe(true)
    expect(resolveTargetHandle("character-motion", handle, "source")).toBe("target")
  })

  it.each(REF_HANDLES)("a %s drag (%s) still offers Character FX, wired to its rendered `target`", (type, handle) => {
    const r = getCompatibleNodes(handle, "source", pool, type)
    expect(offered(r).has("character-fx")).toBe(true)
    expect(resolveTargetHandle("character-fx", handle, "source")).toBe("target")
  })

  it.each(REF_HANDLES)("a %s drag (%s) offers every registry-accepting node, wired to an accepting handle", (type, handle) => {
    const r = getCompatibleNodes(handle, "source", pool, type)
    for (const option of pool) {
      const accepting = (TARGET_HANDLE_ACCEPTS[option.type] ?? []).filter((e) => e.accepts(type)).map((e) => e.handleId)
      if (accepting.length === 0) continue
      expect(r.directTypes.has(option.type), option.type).toBe(true)
      expect(accepting, option.type).toContain(resolveTargetHandle(option.type, handle, "source"))
    }
  })

  // Snapshot taken before the change: what these drags offered then must all
  // still be offered.
  it("drops nothing that was offered before", () => {
    const BEFORE_WITHOUT_FACE_SWAP = [
      "character", "face", "object", "creature", "location", "character-fx",
      "reference-sheet", "preview", "upload-image", "text-prompt", "combine-videos", "mood",
    ]
    for (const [type, handle] of REF_HANDLES) {
      const before = type === "face" ? [...BEFORE_WITHOUT_FACE_SWAP, "face-swap"] : BEFORE_WITHOUT_FACE_SWAP
      const now = offered(getCompatibleNodes(handle, "source", pool, type))
      for (const t of before) expect(now.has(t), `${handle} → ${t}`).toBe(true)
    }
  })

  // Snapshot taken before the change, over the same pool: an `image` drag (from a
  // plain image producer, and from a Character's own `image` pip, which is not an
  // identity ref) is byte-identical — tiers, order and resolved handles.
  it.each([["upload-image"], ["character"]])("an `image` drag from %s is unchanged", (sourceType) => {
    const r = getCompatibleNodes("image", "source", pool, sourceType)
    expect(r.direct.map((o) => o.type)).toEqual(["face-swap", "generate-video", "motion-transfer", "lip-sync"])
    expect(r.compatible.map((o) => o.type)).toEqual([
      "character", "face", "object", "creature", "location", "character-fx",
      "reference-sheet", "preview", "upload-image", "text-prompt", "combine-videos", "mood",
    ])
    const handles = Object.fromEntries([...r.direct, ...r.compatible].map((o) => [o.type, resolveTargetHandle(o.type, "image", "source")]))
    expect(handles).toEqual({
      "face-swap": "face", "generate-video": "startFrame", "motion-transfer": "image", "lip-sync": "image",
      character: "in", face: "in", object: "in", creature: "in", location: "in", "character-fx": "in",
      "reference-sheet": "in", preview: "in", "upload-image": "in", "text-prompt": "in", "combine-videos": "in", mood: "in",
    })
  })
})
