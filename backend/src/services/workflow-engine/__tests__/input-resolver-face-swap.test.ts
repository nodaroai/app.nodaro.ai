/**
 * Face Swap's two inputs on the SERVER, routed by handle exactly as the editor
 * routes them: the `face` handle carries the face photo into `faceImageUrl`,
 * whatever produced it (an uploaded or generated image, or a character / face
 * entity's portrait); the `video` handle carries the target video.
 *
 * Before this the server had no face lane: an image landed in `imageUrl` and an
 * entity in `referenceImageUrls`, the payload shipped no face, and every
 * server-run Face Swap crashed at the provider.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(source: string, target: string, targetHandle: string): SimpleEdge {
  return { id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle: null, targetHandle }
}

const FACE = "https://cdn.example/face.png"
const VIDEO = "https://cdn.example/clip.mp4"

/** An entity node's run state as the orchestrator leaves it: its portrait as output. */
const portraitState: Record<string, NodeExecutionState> = {
  src: { status: "completed", output: { imageUrl: FACE } },
}

describe("resolveNodeInputs — face-swap", () => {
  it.each([
    // An upload is a source node: its file is read from its data.
    ["an uploaded image", "upload-image", { url: FACE }, {}],
    // An entity runs (or is pre-completed from its saved portrait): its image is its run output.
    ["a character's portrait", "character", {}, portraitState],
    ["a face entity", "face", {}, portraitState],
  ])("routes %s on the face handle into faceImageUrl", (_label, type, data, states) => {
    const swap = node("swap", "face-swap")
    const src = node("src", type, data)

    const inputs = resolveNodeInputs(swap, [edge("src", "swap", "face")], states, [src, swap])

    expect(inputs.faceImageUrl).toBe(FACE)
    expect(inputs.imageUrl).toBeUndefined()
    expect(inputs.referenceImageUrls).toBeUndefined()
  })

  it("routes the video handle into videoUrl, beside the face", () => {
    const swap = node("swap", "face-swap")
    const face = node("face-src", "upload-image", { url: FACE })
    const video = node("video-src", "upload-video", { url: VIDEO })

    const inputs = resolveNodeInputs(
      swap,
      [edge("face-src", "swap", "face"), edge("video-src", "swap", "video")],
      {},
      [face, video, swap],
    )

    expect(inputs.faceImageUrl).toBe(FACE)
    expect(inputs.videoUrl).toBe(VIDEO)
  })
})
