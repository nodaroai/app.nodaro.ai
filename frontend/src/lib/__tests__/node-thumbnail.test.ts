import { describe, it, expect } from "vitest"
import {
  getNodeThumbnailUrl,
  getNodeVideoUrl,
  getNodeConfigSummary,
} from "../node-thumbnail"
import {
  getParameterPickerMeta,
  type SingleDimParameterPickerMeta,
  type MultiDimParameterPickerMeta,
} from "../parameter-picker-registry"
import type { WorkflowNode } from "@/types/nodes"

function node(type: string, data: Record<string, unknown>): WorkflowNode {
  return { id: "n1", type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}

const PNG = "https://cdn.nodaro.ai/a.png"
const PNG2 = "https://cdn.nodaro.ai/b.png"
const MP4 = "https://cdn.nodaro.ai/clip.mp4"

describe("getNodeThumbnailUrl — entity preview fields", () => {
  it("resolves a character's starred default asset (defaultAssetUrl)", () => {
    expect(getNodeThumbnailUrl(node("character", { defaultAssetUrl: PNG, sourceImageUrl: PNG2 }))).toBe(PNG)
  })

  it("falls back to an entity's canonical sourceImageUrl", () => {
    expect(getNodeThumbnailUrl(node("object", { sourceImageUrl: PNG2 }))).toBe(PNG2)
  })

  it("skips a video defaultAssetUrl in the <img> path and uses the portrait instead", () => {
    expect(getNodeThumbnailUrl(node("character", { defaultAssetUrl: MP4, sourceImageUrl: PNG2 }))).toBe(PNG2)
  })

  it("still prefers a generated result poster", () => {
    const n = node("generate-image", {
      generatedResults: [{ url: PNG, thumbnailUrl: PNG2 }],
      activeResultIndex: 0,
    })
    expect(getNodeThumbnailUrl(n)).toBe(PNG2)
  })
})

describe("getNodeVideoUrl — entity video defaults", () => {
  it("returns a video-looking defaultAssetUrl so a motion default plays inline", () => {
    expect(getNodeVideoUrl(node("character", { defaultAssetUrl: MP4, sourceImageUrl: PNG2 }))).toBe(MP4)
  })

  it("does not treat an image defaultAssetUrl as a video", () => {
    expect(getNodeVideoUrl(node("character", { defaultAssetUrl: PNG }))).toBeUndefined()
  })
})

describe("getNodeConfigSummary — picker selected values", () => {
  it("resolves a single-dim picker's selected id to its catalog label", () => {
    const meta = getParameterPickerMeta("mood") as SingleDimParameterPickerMeta
    const first = meta.entries[0]
    const values = getNodeConfigSummary(node("mood", { mood: first.id })).map((c) => c.value)
    expect(values).toEqual([first.label])
  })

  it("resolves a single-dim picker's multi-select array of ids", () => {
    const meta = getParameterPickerMeta("mood") as SingleDimParameterPickerMeta
    const [a, b] = meta.entries
    const values = getNodeConfigSummary(node("mood", { mood: [a.id, b.id] })).map((c) => c.value)
    expect(values).toEqual([a.label, b.label])
  })

  it("caps picker chips and adds a +N overflow chip", () => {
    const meta = getParameterPickerMeta("mood") as SingleDimParameterPickerMeta
    const ids = meta.entries.slice(0, 6).map((e) => e.id)
    const values = getNodeConfigSummary(node("mood", { mood: ids })).map((c) => c.value)
    expect(values).toHaveLength(5) // 4 labels + overflow
    expect(values[4]).toBe("+2")
  })

  it("resolves a multi-dim picker's per-dimension ids via its flat catalog", () => {
    const meta = getParameterPickerMeta("person") as MultiDimParameterPickerMeta
    const entry = meta.catalogEntries[0]
    const values = getNodeConfigSummary(node("person", { [meta.fields[0]]: entry.id })).map((c) => c.value)
    expect(values).toContain(entry.label)
  })

  it("returns an empty summary for an unconfigured picker", () => {
    expect(getNodeConfigSummary(node("mood", {}))).toEqual([])
  })
})

describe("getNodeConfigSummary — generator + simple-param config", () => {
  it("summarizes provider, aspect ratio and resolution for a generator", () => {
    const values = getNodeConfigSummary(
      node("generate-image", { provider: "kling", aspectRatio: "16:9", resolution: "1080p" }),
    ).map((c) => c.value)
    expect(values).toContain("kling")
    expect(values).toContain("16:9")
    expect(values).toContain("1080p")
  })

  it("collapses a multi-provider node into an N-models chip", () => {
    const values = getNodeConfigSummary(node("generate-image", { providers: ["a", "b", "c"] })).map((c) => c.value)
    expect(values).toContain("3 models")
  })

  it("tags the aspect-ratio chip with the ratio icon", () => {
    const chips = getNodeConfigSummary(node("generate-image", { aspectRatio: "9:16" }))
    expect(chips.find((c) => c.value === "9:16")?.icon).toBe("ratio")
  })

  it("summarizes a duration node's seconds", () => {
    expect(getNodeConfigSummary(node("duration", { seconds: 8 })).map((c) => c.value)).toEqual(["8s"])
  })

  it("summarizes a scene-count node", () => {
    expect(getNodeConfigSummary(node("scene-count", { count: 5 })).map((c) => c.value)).toEqual(["× 5"])
  })

  it("returns an empty summary when a node has no recognizable config", () => {
    expect(getNodeConfigSummary(node("sticky-note", {}))).toEqual([])
  })
})
