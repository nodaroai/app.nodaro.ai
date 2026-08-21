/**
 * Canvas-side slideshow input routing — mirrors the backend
 * input-resolver-slideshow suite, because the two resolvers fail
 * independently (the suno-voice precedent broke on exactly one side):
 *
 *   1. a wired transition PARAMETER node's pick lands in inputs.transition
 *      (VALUE routing — parameter nodes produce no extracted output, so the
 *      empty-output skip must not swallow the edge);
 *   2. direct image edges ACCUMULATE in wire order; audio stays out;
 *   3. a List under the Bundle ("all") edge spreads its rows into imageUrls.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as WorkflowNode
}

function edge(
  source: string,
  target: string,
  targetHandle?: string,
  data?: Record<string, unknown>,
): WorkflowEdge {
  return { id: `${source}->${target}`, source, target, targetHandle, data } as WorkflowEdge
}

describe("resolveNodeInputs — slideshow (canvas)", () => {
  it("routes the transition PARAMETER node's pick into inputs.transition", () => {
    const target = node("show", "slideshow")
    const transition = node("tr", "transition", { transition: "cross-dissolve" })
    const inputs = resolveNodeInputs(target, [transition, target], [edge("tr", "show", "transition")])
    expect(inputs.transition).toBe("cross-dissolve")
  })

  it("routes the pick by SOURCE type even without an explicit target handle", () => {
    const target = node("show", "slideshow")
    const transition = node("tr", "transition", { transition: "fade-to-black" })
    const inputs = resolveNodeInputs(target, [transition, target], [edge("tr", "show")])
    expect(inputs.transition).toBe("fade-to-black")
  })

  it("accumulates direct image edges in wire order; audio routes to audioUrl", () => {
    const target = node("show", "slideshow")
    const img1 = node("i1", "upload-image", { url: "https://x/a.png", imageUrl: "https://x/a.png" })
    const img2 = node("i2", "upload-image", { url: "https://x/b.png", imageUrl: "https://x/b.png" })
    const audio = node("au", "upload-audio", { url: "https://x/t.mp3", audioUrl: "https://x/t.mp3" })
    const inputs = resolveNodeInputs(
      target,
      [img1, img2, audio, target],
      [edge("i1", "show", "images"), edge("i2", "show", "images"), edge("au", "show", "audio")],
    )
    expect(inputs.imageUrls).toEqual(["https://x/a.png", "https://x/b.png"])
    expect(inputs.audioUrl).toBe("https://x/t.mp3")
    expect(inputs.imageUrls).not.toContain("https://x/t.mp3")
  })

  it("spreads a List's rows into imageUrls under the Bundle (all) edge mode", () => {
    const target = node("show", "slideshow")
    const list = node("ls", "list", {
      columns: [{ id: "default", name: "Items", handleId: "col_default", type: "image-url" }],
      rows: [["https://x/1.png"], ["https://x/2.png"], ["https://x/3.png"]],
    })
    const inputs = resolveNodeInputs(
      target,
      [list, target],
      [edge("ls", "show", "images", { outputMode: "all" })],
    )
    expect(inputs.imageUrls).toEqual(["https://x/1.png", "https://x/2.png", "https://x/3.png"])
  })
})
