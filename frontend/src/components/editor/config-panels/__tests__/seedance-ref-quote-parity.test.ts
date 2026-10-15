import { describe, it, expect } from "vitest"
import { getModelIdentifier } from "../helpers"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * Generate Video with Seedance 2.5 and a wired reference video makes the SAME
 * KIE call as Video to Video's Seedance edit lane (a text-to-video job with the
 * clip as reference video 1). Both are quoted from one identifier — the
 * reference-video ladder, at the resolution the run sends (the model's own UI
 * fill when the node names none; 480p for a draft). The reference video is a
 * GRAPH fact (a `videoReferences` edge), never node data: nothing writes
 * `referenceVideoUrls` into a Generate Video node.
 */

const node = (id: string, type: string, data: Record<string, unknown>): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode

const clip = node("clip", "upload-video", { videoUrl: "https://cdn.example/clip.mp4" })

function generateVideo(data: Record<string, unknown>, wired = true) {
  const gv = node("gv", "generate-video", { provider: "seedance-2-5", duration: -1, ...data })
  const edges: WorkflowEdge[] = wired
    ? [{ id: "e1", source: "clip", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" } as WorkflowEdge]
    : []
  return getModelIdentifier(gv, edges, [clip, gv])
}

function videoToVideo(data: Record<string, unknown>) {
  const v2v = node("v2v", "video-to-video", { provider: "seedance-2-5", ...data })
  const edges = [{ id: "e1", source: "clip", target: "v2v", sourceHandle: "video", targetHandle: "video" } as WorkflowEdge]
  return getModelIdentifier(v2v, edges, [clip, v2v])
}

describe("Seedance 2.5 reference-video quote — Generate Video ≡ Video to Video", () => {
  it("quotes the same id for the same KIE call (Auto, resolution unset)", () => {
    expect(generateVideo({})).toBe("seedance-2-5:30s:480p-ref")
    expect(videoToVideo({})).toBe("seedance-2-5:30s:480p-ref")
  })

  it("quotes the same id at a chosen resolution", () => {
    expect(generateVideo({ resolution: "720p" })).toBe(videoToVideo({ v2vResolution: "720p" }))
    expect(generateVideo({ resolution: "720p" })).toBe("seedance-2-5:30s:720p-ref")
  })

  it("a draft is quoted at 480p on both nodes, whatever resolution came with it", () => {
    expect(generateVideo({ resolution: "720p", draft: true })).toBe("seedance-2-5:30s:480p-ref")
    expect(videoToVideo({ v2vResolution: "720p", draft: true })).toBe("seedance-2-5:30s:480p-ref")
  })

  it("Generate Video with no reference video wired stays on the plain ladder", () => {
    expect(generateVideo({ resolution: "720p" }, false)).toBe("seedance-2-5:30s:720p")
  })

  it("stale referenceVideoUrls in node data does not flip the ladder", () => {
    expect(generateVideo({ resolution: "720p", referenceVideoUrls: ["https://x/y.mp4"] }, false)).toBe("seedance-2-5:30s:720p")
  })
})
