/**
 * Mask Composite + Video Mask input routing — the three video wires of Mask
 * Composite must land in three DIFFERENT slots (a last-wins clobber into
 * `videoUrl` would composite a video over itself), and Video Mask's single
 * output must reach a downstream mask input as the mask video.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(source: string, target: string, targetHandle: string, sourceHandle: string | null = null): SimpleEdge {
  return { id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle, targetHandle }
}

describe("resolveNodeInputs — mask-composite", () => {
  it("routes foreground, background and mask into their own slots", () => {
    const target = node("mc", "mask-composite")
    const fg = node("fg", "upload-video", { url: "https://x/fg.mp4" })
    const bg = node("bg", "upload-video", { url: "https://x/bg.mp4" })
    const mask = node("vm", "video-mask")
    const states: Record<string, NodeExecutionState> = {
      vm: { status: "completed", output: { videoUrl: "https://x/mask.mp4" } } as NodeExecutionState,
    }
    const edges = [edge("fg", "mc", "video"), edge("bg", "mc", "background-video"), edge("vm", "mc", "mask-video", "video")]
    const result = resolveNodeInputs(target, edges, states, [fg, bg, mask, target])
    expect(result.videoUrl).toBe("https://x/fg.mp4")
    expect(result.backgroundVideoUrl).toBe("https://x/bg.mp4")
    expect(result.maskUrl).toBe("https://x/mask.mp4")
  })

  it("keeps the slots apart whatever order the wires were drawn in", () => {
    const target = node("mc", "mask-composite")
    const fg = node("fg", "upload-video", { url: "https://x/fg.mp4" })
    const bg = node("bg", "upload-video", { url: "https://x/bg.mp4" })
    const m = node("m", "upload-video", { url: "https://x/m.mp4" })
    const edges = [edge("m", "mc", "mask-video"), edge("bg", "mc", "background-video"), edge("fg", "mc", "video")]
    const result = resolveNodeInputs(target, edges, {}, [fg, bg, m, target])
    expect([result.videoUrl, result.backgroundVideoUrl, result.maskUrl]).toEqual(["https://x/fg.mp4", "https://x/bg.mp4", "https://x/m.mp4"])
  })
})

describe("resolveNodeInputs — video-mask", () => {
  it("takes its clip on the video handle and a wired text as its prompt", () => {
    const target = node("vm", "video-mask")
    const clip = node("c", "upload-video", { url: "https://x/clip.mp4" })
    const text = node("t", "text-prompt", { text: "the dancer" })
    const result = resolveNodeInputs(target, [edge("c", "vm", "video"), edge("t", "vm", "prompt")], {}, [clip, text, target])
    expect(result.videoUrl).toBe("https://x/clip.mp4")
    expect(result.prompt).toBe("the dancer")
  })
})
