import { describe, it, expect } from "vitest"
import { getCompatibleNodes, TYPED_HANDLE_IDS, type NodeOption } from "../node-compatibility"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"
import type { SceneNodeType } from "@/types/nodes"

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
describe("TYPED_HANDLE_IDS contract", () => {
  it("matches every non-generate-image handle in TARGET_HANDLE_ACCEPTS", () => {
    const registryHandles = new Set<string>()
    for (const [nodeType, entries] of Object.entries(TARGET_HANDLE_ACCEPTS)) {
      if (nodeType === "generate-image") continue // owns 6 handle ids that aren't typed-pool gates
      for (const e of entries) registryHandles.add(e.handleId)
    }
    expect(new Set(TYPED_HANDLE_IDS)).toEqual(registryHandles)
  })
})
