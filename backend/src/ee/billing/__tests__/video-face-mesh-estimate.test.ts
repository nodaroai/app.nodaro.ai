// @test-units-by-name prices the node types it names (upload-video, video-face-mesh, video-mask)
import { describe, it, expect } from "vitest"
import { videoFaceMeshCreditId, videoFaceMeshCreditIds, videoMaskBilledSeconds } from "@nodaro/shared/media"
import { STATIC_CREDIT_COSTS, CreditsService } from "../credits.js"

// The Cast Swap engine's quote graph prices its face mesh child as
// `{ id: "mesh", type: "video-face-mesh", data: {} }`, wired from the clip's
// `upload-video` node into `targetHandle: "video"`: quoted at the
// `video-face-mesh:<n>s` row for the clip's PRICED length (the 30 fps basis),
// the row the route charges.

type N = { id?: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; targetHandle?: string }

const est = (nodes: N[], edges?: E[]) => CreditsService.estimateWorkflowBaseCredits(nodes, edges)
const upload = (extra: Record<string, unknown> = {}): N => ({
  id: "clip",
  type: "upload-video",
  data: { url: "https://cdn.example.com/clip.mp4", duration: 21, ...extra },
})
const mesh: N = { id: "mesh", type: "video-face-mesh", data: {} }
const meshPart = (clip: N) => est([clip, mesh], [{ source: "clip", target: "mesh", targetHandle: "video" }]) - est([clip])
const row = (sec: number | undefined, fps?: number) =>
  STATIC_CREDIT_COSTS[videoFaceMeshCreditId(sec === undefined ? undefined : Math.ceil(videoMaskBilledSeconds(sec, fps)))]

describe("video-face-mesh workflow estimate", () => {
  it("every row is priced (one base credit a second of its bucket)", () => {
    for (const id of videoFaceMeshCreditIds()) {
      expect(STATIC_CREDIT_COSTS[id]).toBe(Number(id.split(":")[1]!.replace("s", "")))
    }
  })

  it("a 21-second clip is quoted at the 30-second row, and a short one at its own bucket", () => {
    expect(meshPart(upload())).toBe(row(21))
    expect(row(21)).toBe(STATIC_CREDIT_COSTS["video-face-mesh:30s"])
    expect(meshPart(upload({ duration: 4 }))).toBe(STATIC_CREDIT_COSTS["video-face-mesh:5s"])
  })

  it("a fast clip is quoted at the 30 fps basis, as the route charges it", () => {
    expect(meshPart(upload({ duration: 6, fps: 60 }))).toBe(STATIC_CREDIT_COSTS["video-face-mesh:15s"])
    // A 30 s clip at 60 fps: about 60.03 s priced, within 0.05 s of the 60 s row.
    expect(meshPart(upload({ duration: 30.02, fps: 60 }))).toBe(STATIC_CREDIT_COSTS["video-face-mesh:60s"])
  })

  it("a clip whose length the graph does not tell is quoted at the longest row, never 0", () => {
    const noFile: N = { id: "clip", type: "upload-video", data: { duration: 10 } }
    expect(meshPart(noFile)).toBe(STATIC_CREDIT_COSTS["video-face-mesh:300s"])
    expect(est([mesh])).toBe(STATIC_CREDIT_COSTS["video-face-mesh:300s"])
  })

  it("beside the mask in one graph, each child priced on its own row", () => {
    const vm: N = { id: "vm", type: "video-mask", data: {} }
    const both = est([upload(), vm, mesh], [
      { source: "clip", target: "vm", targetHandle: "video" },
      { source: "clip", target: "mesh", targetHandle: "video" },
    ])
    const maskOnly = est([upload(), vm], [{ source: "clip", target: "vm", targetHandle: "video" }])
    expect(both - maskOnly).toBe(row(21))
  })
})
