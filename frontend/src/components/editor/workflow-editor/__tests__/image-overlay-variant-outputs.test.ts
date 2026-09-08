/**
 * A variant:<platformId> source handle feeds that platform's render into the
 * next node — the reason the handles exist (one run, one publisher per
 * platform). Guarded on the canvas resolver; the backend has the mirror case.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../node-input-resolver"
import { extractNodeOutput } from "../execution-graph"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as WorkflowNode
}
function edge(source: string, target: string, sourceHandle?: string, targetHandle?: string): WorkflowEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle, targetHandle } as WorkflowEdge
}

const overlay = node("ov", "image-overlay", {
  generatedImageUrl: "https://x/main.png",
  generatedResults: [{ url: "https://x/main.png", timestamp: "t", jobId: "j" }],
  generatedMaskUrl: "https://x/mask.png",
  overlayVariants: [
    { id: "instagram-post", label: "Instagram post (1:1)", url: "https://x/ig.png", width: 1080, height: 1080 },
    { id: "youtube-thumbnail", label: "YouTube thumbnail", url: "https://x/yt.png", width: 1280, height: 720 },
  ],
})

describe("image-overlay variant output handles (canvas)", () => {
  it("extractNodeOutput routes each handle to its file", () => {
    expect(extractNodeOutput(overlay, "variant:instagram-post")).toBe("https://x/ig.png")
    expect(extractNodeOutput(overlay, "variant:youtube-thumbnail")).toBe("https://x/yt.png")
    expect(extractNodeOutput(overlay, "variant:x-header")).toBeUndefined()
    expect(extractNodeOutput(overlay, "mask")).toBe("https://x/mask.png")
    expect(extractNodeOutput(overlay, "image")).toBe("https://x/main.png")
    expect(extractNodeOutput(overlay, undefined)).toBe("https://x/main.png")
  })

  it("the main image + mask feed a Modify Image (the AI-finish chain) on the canvas", () => {
    const mod = node("mod", "modify-image")
    const inputs = resolveNodeInputs(mod, [overlay, mod], [edge("ov", "mod", "image", "image"), edge("ov", "mod", "mask", "mask")])
    expect(inputs.referenceImageUrls).toEqual(["https://x/main.png"])
    expect(inputs.maskUrl).toBe("https://x/mask.png")
  })

  it("an Upscale wired to a variant handle receives that platform's render as its image", () => {
    const up = node("up", "upscale-image")
    const inputs = resolveNodeInputs(up, [overlay, up], [edge("ov", "up", "variant:youtube-thumbnail", "image")])
    expect(inputs.imageUrl).toBe("https://x/yt.png")
  })
})
