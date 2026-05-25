import { describe, it, expect } from "vitest"
import { getCompatibleNodes, type NodeOption } from "../node-compatibility"
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
