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
import { STYLINGS, STYLING_FIELD_BY_DIMENSION } from "@nodaro/shared"
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

  it("surfaces a multi-picker dimension the registry `fields` list has drifted behind", () => {
    // styling stores ~17 dimensions but the registry hand-lists only 9, so
    // fields like `outfit`/`top`/`bottom` are NOT declared. The summary must
    // still resolve them via the flattened catalog (the drift safety net).
    const meta = getParameterPickerMeta("styling") as MultiDimParameterPickerMeta
    const declared = new Set<string>(meta.fields)
    const drifted = STYLINGS.find((s) => !declared.has(STYLING_FIELD_BY_DIMENSION[s.dimension]))
    // If the registry is ever completed there's no drift left to exercise — the
    // declared path already covers everything, so there's nothing to assert.
    if (!drifted) return
    const field = STYLING_FIELD_BY_DIMENSION[drifted.dimension]
    const values = getNodeConfigSummary(node("styling", { [field]: drifted.id })).map((c) => c.value)
    expect(values).toContain(drifted.label)
  })

  it("ignores a free-text field whose value is not a catalog id", () => {
    // A custom node label must NOT leak into the styling chips.
    expect(getNodeConfigSummary(node("styling", { label: "My Styling Node" }))).toEqual([])
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

  it("treats an LLM node's `llmModel` as its model chip", () => {
    expect(getNodeConfigSummary(node("llm-chat", { llmModel: "claude-opus-4-8" })).map((c) => c.value)).toContain(
      "claude-opus-4-8",
    )
  })

  it("recognizes `durationSeconds` (composition nodes) as a duration", () => {
    expect(getNodeConfigSummary(node("render-video", { durationSeconds: 12 })).map((c) => c.value)).toContain("12s")
  })

  it("summarizes a suno node's style and a social node's platform", () => {
    expect(getNodeConfigSummary(node("suno-generate", { style: "lofi hip hop" })).map((c) => c.value)).toContain(
      "lofi hip hop",
    )
    expect(getNodeConfigSummary(node("instagram-post", { platform: "instagram" })).map((c) => c.value)).toContain(
      "instagram",
    )
  })

  it("shows a versions count only when >1", () => {
    expect(getNodeConfigSummary(node("video-sfx", { versions: 3 })).map((c) => c.value)).toContain("3 versions")
    expect(getNodeConfigSummary(node("video-sfx", { versions: 1 }))).toEqual([])
  })

  it("covers utility nodes via the per-type fallback (separator, strategy)", () => {
    expect(getNodeConfigSummary(node("split-text", { separator: "," })).map((c) => c.value)).toEqual([","])
    expect(getNodeConfigSummary(node("reduce", { strategyId: "concat" })).map((c) => c.value)).toEqual(["concat"])
  })
})
