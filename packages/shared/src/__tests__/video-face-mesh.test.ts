import { describe, expect, it } from "vitest"
import {
  VIDEO_FACE_MESH_LAYERS,
  VIDEO_FACE_MESH_LIMITS,
  VIDEO_FACE_MESH_LINE_LAYERS,
  VIDEO_FACE_MESH_PARTS,
  VIDEO_FACE_MESH_PATH,
  VIDEO_FACE_MESH_RECIPE,
  videoFaceMeshCreditId,
  videoFaceMeshCreditIds,
  videoFaceMeshLayersDrawLines,
  videoFaceMeshLayersOfParts,
  videoFaceMeshLayersOn,
  videoFaceMeshPartsOfLayers,
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

describe("video face mesh layers", () => {
  it("six layers, bold the one that draws no line of its own", () => {
    expect(VIDEO_FACE_MESH_LAYERS).toEqual(["wireframe", "eyes", "lips", "contours", "irises", "bold"])
    expect(VIDEO_FACE_MESH_LINE_LAYERS).toEqual(["wireframe", "eyes", "lips", "contours", "irises"])
  })

  it("every parts value is one set of layers", () => {
    expect(videoFaceMeshLayersOfParts()).toEqual({ wireframe: true, eyes: true, lips: true })
    expect(videoFaceMeshLayersOfParts("full")).toEqual({ wireframe: true, eyes: true, lips: true })
    expect(videoFaceMeshLayersOfParts("features")).toEqual({ eyes: true, lips: true })
    expect(videoFaceMeshLayersOfParts("mouth")).toEqual({ lips: true })
    expect(videoFaceMeshLayersOfParts("contours")).toEqual({ eyes: true, lips: true, contours: true })
  })

  it("a set names its parts value back, whatever its key order or its false keys; one only layers name has none", () => {
    for (const p of VIDEO_FACE_MESH_PARTS) expect(videoFaceMeshPartsOfLayers(videoFaceMeshLayersOfParts(p))).toBe(p)
    expect(videoFaceMeshPartsOfLayers({ lips: true, wireframe: true, eyes: true, irises: false })).toBe("full")
    expect(videoFaceMeshPartsOfLayers({ eyes: true })).toBeUndefined()
    expect(videoFaceMeshPartsOfLayers({ eyes: true, lips: true, bold: true })).toBeUndefined()
    expect(videoFaceMeshPartsOfLayers({ eyes: true, lips: true, irises: true })).toBeUndefined()
    expect(videoFaceMeshPartsOfLayers({})).toBeUndefined()
    expect(videoFaceMeshPartsOfLayers({ eyes: true, lips: true, contours: true }, ["full", "features", "mouth"])).toBeUndefined()
  })

  it("the layers on, in order, as a new object; lines need a layer other than bold", () => {
    const given = { bold: true, eyes: false, wireframe: true }
    const on = videoFaceMeshLayersOn(given)
    expect(on).toEqual({ wireframe: true, bold: true })
    expect(Object.keys(on)).toEqual(["wireframe", "bold"])
    expect(given).toEqual({ bold: true, eyes: false, wireframe: true })
    expect(videoFaceMeshLayersOn(undefined)).toEqual({})
    expect(videoFaceMeshLayersDrawLines({ bold: true })).toBe(false)
    expect(videoFaceMeshLayersDrawLines({ irises: true })).toBe(true)
    expect(videoFaceMeshLayersDrawLines(null)).toBe(false)
  })
})
