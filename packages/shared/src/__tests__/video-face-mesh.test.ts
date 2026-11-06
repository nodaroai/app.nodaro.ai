import { describe, expect, it } from "vitest"
import {
  VIDEO_FACE_MESH_LIMITS,
  VIDEO_FACE_MESH_PARTS,
  VIDEO_FACE_MESH_PATH,
  VIDEO_FACE_MESH_RECIPE,
  videoFaceMeshCreditId,
  videoFaceMeshCreditIds,
} from "../video-face-mesh.js"

describe("video face mesh pricing rows", () => {
  it("one row per length bucket, smallest first", () => {
    expect(videoFaceMeshCreditIds()).toEqual([
      "video-face-mesh:5s",
      "video-face-mesh:10s",
      "video-face-mesh:15s",
      "video-face-mesh:30s",
      "video-face-mesh:60s",
      "video-face-mesh:120s",
      "video-face-mesh:300s",
    ])
  })

  it("a clip is priced at the smallest bucket that holds it", () => {
    expect(videoFaceMeshCreditId(0.5)).toBe("video-face-mesh:5s")
    expect(videoFaceMeshCreditId(5)).toBe("video-face-mesh:5s")
    expect(videoFaceMeshCreditId(5.01)).toBe("video-face-mesh:5s")
    expect(videoFaceMeshCreditId(15)).toBe("video-face-mesh:15s")
    expect(videoFaceMeshCreditId(21)).toBe("video-face-mesh:30s")
    expect(videoFaceMeshCreditId(60)).toBe("video-face-mesh:60s")
    // A 30 s clip at 60 fps (1,801 frames) is priced at about 60.03 s: within 0.05 s of the 60 s row.
    expect(videoFaceMeshCreditId(60.03)).toBe("video-face-mesh:60s")
    expect(videoFaceMeshCreditId(61)).toBe("video-face-mesh:120s")
    expect(videoFaceMeshCreditId(121)).toBe("video-face-mesh:300s")
    expect(videoFaceMeshCreditId(300)).toBe("video-face-mesh:300s")
  })

  it("an unknown, non-positive or over-cap length prices the longest row", () => {
    for (const v of [undefined, null, 0, -3, Number.NaN, 301, 600]) {
      expect(videoFaceMeshCreditId(v as number)).toBe("video-face-mesh:300s")
    }
  })

  it("the cap is the last bucket, and Video Mask's (any clip the mask takes, the mesh takes)", () => {
    expect(VIDEO_FACE_MESH_LIMITS.MAX_BILLED_SEC).toBe(300)
    expect(videoFaceMeshCreditIds().at(-1)).toBe(`video-face-mesh:${VIDEO_FACE_MESH_LIMITS.MAX_BILLED_SEC}s`)
  })

  it("names the route and a dated recipe", () => {
    expect(VIDEO_FACE_MESH_PATH).toBe("/v1/video-face-mesh")
    expect(VIDEO_FACE_MESH_RECIPE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("video face mesh parts", () => {
  it("the full mesh first (the default), then the eye and lip outlines, the lip outline, and the contours", () => {
    expect(VIDEO_FACE_MESH_PARTS).toEqual(["full", "features", "mouth", "contours"])
  })
})
