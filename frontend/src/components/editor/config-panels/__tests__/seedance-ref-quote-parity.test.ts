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

/**
 * Kling 4.0 and Kling 4.0 Flash price a character's video subject like an
 * image subject (decided 2026-11-14). A clip wired as a reference video that is
 * also a wired character's clip goes to the model as the character only, so the
 * editor's id stays on the plain ladder, as the server's does.
 */
describe("Kling 4.0 video subjects — the editor's id", () => {
  const CLIP = "https://cdn.example/clip.mp4"
  const clip = node("clip", "upload-video", { url: CLIP })
  const maya = (subjectVideoUrl?: string) =>
    node("maya", "character", { characterName: "Maya", sourceImageUrl: "https://cdn.example/maya.png", ...(subjectVideoUrl ? { subjectVideoUrl } : {}) })
  const charWire = { id: "c1", source: "maya", target: "gv", sourceHandle: "characterRef", targetHandle: "assets" } as WorkflowEdge
  const clipWire = { id: "e1", source: "clip", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" } as WorkflowEdge
  const idOf = (provider: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) => {
    const gv = node("gv", "generate-video", { provider, duration: 5, resolution: "720p" })
    return getModelIdentifier(gv, edges, [...nodes, gv])
  }

  for (const [provider, plain] of [["kling-4", "kling-4:5s:720p"], ["kling-4-flash", "kling-4-flash:5s:720p"]] as const) {
    it(`${provider}: a run whose only clip is a character's is on the plain ladder`, () => {
      expect(idOf(provider, [maya(CLIP)], [charWire])).toBe(plain)
    })

    it(`${provider}: a wired clip that is also the character's clip is on the plain ladder`, () => {
      expect(idOf(provider, [clip, maya(CLIP)], [clipWire, charWire])).toBe(plain)
    })

    it(`${provider}: a plain reference video beside the character stays on the -ref ladder`, () => {
      expect(idOf(provider, [clip, maya()], [clipWire, charWire])).toBe(`${plain}-ref`)
      expect(idOf(provider, [clip, maya("https://cdn.example/other.mp4")], [clipWire, charWire])).toBe(`${plain}-ref`)
    })

    it(`${provider}: a wired clip not known yet stays on the -ref ladder (never under-quoted)`, () => {
      const pending = node("clip", "upload-video", {})
      expect(idOf(provider, [pending, maya(CLIP)], [clipWire, charWire])).toBe(`${plain}-ref`)
    })
  }
})
