import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS, type WorkflowNode } from "@/types/nodes"
import { getQuickConfigs } from "@/components/nodes/node-quick-configs"
import { VIDEO_V2V_MODELS } from "@/components/editor/config-panels/model-options"
import { getExposableFields, exposedOptionValue } from "../exposable-fields"
import { findExposableField } from "../helpers"

/**
 * A node's app fields are its hand-declared `exposableFields` plus one field per
 * quick-strip control (NODE_QUICK_CONFIGS), so a lever the strip offers is a
 * lever an app can offer — a new node is covered by registering its strip.
 */
const keys = (type: string) => getExposableFields(type).map((f) => f.key)
const field = (type: string, key: string) => getExposableFields(type).find((f) => f.key === key)

describe("getExposableFields — hand-declared fields plus the strip's controls", () => {
  it("Video to Video, which declares none, exposes its strip: model, resolution, draft", () => {
    expect(keys("video-to-video")).toEqual(expect.arrayContaining(["provider", "v2vResolution", "draft"]))
    for (const k of ["provider", "v2vResolution", "draft"]) expect(field("video-to-video", k)?.quick).toBeDefined()
  })

  it("a derived field carries the strip control's label", () => {
    const control = getQuickConfigs("video-to-video").find((c) => c.field === "provider")!
    expect(field("video-to-video", "provider")?.label).toBe(control.ariaLabel)
  })

  it("a hand-declared field wins a key collision", () => {
    const declared = NODE_DEFINITIONS.find((d) => d.type === "generate-video")!.exposableFields!.find((f) => f.key === "provider")!
    expect(field("generate-video", "provider")).toBe(declared)
    expect(field("generate-video", "provider")?.quick).toBeUndefined()
    expect(keys("generate-video").filter((k) => k === "provider")).toHaveLength(1)
  })

  it("Generate Video gains its strip's duration, resolution, aspect and draft", () => {
    expect(keys("generate-video")).toEqual(expect.arrayContaining(["duration", "resolution", "aspectRatio", "draft"]))
  })

  it("never derives an opted-out control", () => {
    for (const type of ["generate-image", "generate-video", "switchx"]) expect(keys(type)).not.toContain("repeatCount")
    expect(keys("image-collage")).not.toContain("badges")
    expect(keys("speaker-view")).not.toContain("switchType")
  })

  it("a static strip list becomes the field's options; a provider-aware one has none (no restricting it)", () => {
    expect(field("video-to-video", "provider")?.options?.map((o) => o.value)).toEqual(VIDEO_V2V_MODELS.map((m) => String(m.value)))
    expect(field("video-to-video", "v2vResolution")?.options).toBeUndefined()
    expect(field("video-to-video", "draft")?.options).toBeUndefined()
  })

  it("a static list with an option that leaves the field unset is not restrictable either", () => {
    // Video Overlay's "Source" writes no outputAspect at all.
    expect(field("video-overlay", "outputAspect")?.quick).toBeDefined()
    expect(field("video-overlay", "outputAspect")?.options).toBeUndefined()
  })

  it("an unset node's default is the node's own: defaultData, else the model the strip says it runs as", () => {
    expect(field("video-to-video", "provider")?.defaultValue).toBe("wan")
    expect(field("assemble-narrated-video", "voiceVolume")?.defaultValue).toBe(
      (NODE_DEFINITIONS.find((d) => d.type === "assemble-narrated-video")!.defaultData as Record<string, unknown>).voiceVolume,
    )
  })

  it("an unknown node type has no fields", () => {
    expect(getExposableFields("no-such-node")).toEqual([])
    expect(getExposableFields(undefined)).toEqual([])
  })
})

describe("exposedOptionValue — the value a restriction stores", () => {
  it("is the node-data value for a derived field, the option string for a hand-declared one", () => {
    expect(exposedOptionValue(field("assemble-narrated-video", "voiceVolume")!, "100")).toBe(100)
    expect(exposedOptionValue(field("suno-generate", "instrumental")!, "true")).toBe(true)
    expect(exposedOptionValue(field("generate-image", "provider")!, "flux")).toBe("flux")
  })
})

describe("findExposableField resolves derived fields", () => {
  it("finds Video to Video's draft field", () => {
    const node = { id: "n", type: "video-to-video", position: { x: 0, y: 0 }, data: {} } as unknown as WorkflowNode
    expect(findExposableField(node, "draft")?.quick?.field).toBe("draft")
  })
})
