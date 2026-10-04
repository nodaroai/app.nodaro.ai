import { describe, it, expect } from "vitest"
import { nodeThumbnailUrl } from "../node-thumbnail"
import type { WorkflowNode } from "@/types/nodes"

function node(type: string, data: Record<string, unknown>): WorkflowNode {
  return { id: "n", type, position: { x: 0, y: 0 }, data: { label: "n", ...data } } as unknown as WorkflowNode
}

describe("nodeThumbnailUrl — the picture a node can lend the workflow", () => {
  it("a generation node lends its image, else its video", () => {
    expect(nodeThumbnailUrl(node("generate-image", { generatedImageUrl: "https://cdn/x.png" }))).toBe("https://cdn/x.png")
    expect(nodeThumbnailUrl(node("generate-video", { generatedVideoUrl: "https://cdn/x.mp4" }))).toBe("https://cdn/x.mp4")
  })

  it("an empty image field does not hide the video behind it", () => {
    expect(nodeThumbnailUrl(node("generate-video", { generatedImageUrl: "", generatedVideoUrl: "https://cdn/x.mp4" }))).toBe(
      "https://cdn/x.mp4",
    )
  })

  it("an Upload Image node lends the image it holds", () => {
    expect(nodeThumbnailUrl(node("upload-image", { url: "https://cdn/uploads/cover.png" }))).toBe("https://cdn/uploads/cover.png")
  })

  it("an Upload Image node with results lends the active one, as a run reads it", () => {
    const results = [{ url: "https://cdn/a.png" }, { url: "https://cdn/b.png" }]
    expect(nodeThumbnailUrl(node("upload-image", { generatedResults: results, activeResultIndex: 1 }))).toBe("https://cdn/b.png")
  })

  it("nothing to lend: an empty upload, a text node, no node", () => {
    expect(nodeThumbnailUrl(node("upload-image", { url: "  " }))).toBeNull()
    expect(nodeThumbnailUrl(node("text-prompt", { text: "https://cdn/x.png" }))).toBeNull()
    expect(nodeThumbnailUrl(undefined)).toBeNull()
  })
})
