import { describe, expect, it } from "vitest"
import { VIDEO_FACE_MESH_PARTS } from "@nodaro/shared/media"
import {
  LEFT_EYE_EDGES,
  RIGHT_EYE_EDGES,
  drawsIrises,
  hidesFarSide,
  layerSetOf,
  outlineEdgesOf,
  uniqueEdges,
  visibilityLayoutOf,
} from "../face-mesh-layers.js"
import { CONTOUR_EDGES } from "../face-mesh-draw.js"
import { FACE_MESH_VISIBILITY } from "../face-mesh-visibility.js"
import {
  FACEMESH_FACE_OVAL,
  FACEMESH_LEFT_EYE,
  FACEMESH_LEFT_EYEBROW,
  FACEMESH_LIPS,
  FACEMESH_NOSE,
  FACEMESH_RIGHT_EYE,
  FACEMESH_RIGHT_EYEBROW,
} from "../face-mesh-topology.js"
import { FACE_MESH_IRISES } from "../face-mesh-irises.js"

describe("layerSetOf", () => {
  it("names every layer of each parts value, the default the full mesh", () => {
    const off = { wireframe: false, eyes: false, lips: false, contours: false, irises: false, bold: false }
    expect(layerSetOf()).toEqual({ ...off, wireframe: true, eyes: true, lips: true })
    expect(layerSetOf("features")).toEqual({ ...off, eyes: true, lips: true })
    expect(layerSetOf("mouth")).toEqual({ ...off, lips: true })
    expect(layerSetOf("contours")).toEqual({ ...off, eyes: true, lips: true, contours: true })
    expect(layerSetOf({ layers: { irises: true, bold: true, eyes: false } })).toEqual({ ...off, irises: true, bold: true })
  })

  it("only the contours read the depths, only the irises the 10 iris points", () => {
    expect(VIDEO_FACE_MESH_PARTS.filter((p) => hidesFarSide(layerSetOf(p)))).toEqual(["contours"])
    expect(VIDEO_FACE_MESH_PARTS.filter((p) => drawsIrises(layerSetOf(p)))).toEqual([])
    expect(hidesFarSide(layerSetOf({ layers: { wireframe: true, contours: true } }))).toBe(true)
    expect(drawsIrises(layerSetOf({ layers: { irises: true } }))).toBe(true)
  })
})

describe("outlineEdgesOf: the outlines in the order each parts value has always drawn them", () => {
  it("the full mesh's and the features': the lips, then the eyes", () => {
    const want = Array.from(uniqueEdges([...FACEMESH_LIPS, ...FACEMESH_LEFT_EYE, ...FACEMESH_RIGHT_EYE]))
    expect(Array.from(outlineEdgesOf(layerSetOf("full")))).toEqual(want)
    expect(Array.from(outlineEdgesOf(layerSetOf("features")))).toEqual(want)
  })

  it("the mouth's: the lips alone; the contours': the lips, the eyes, the oval, the brows, the nose", () => {
    expect(Array.from(outlineEdgesOf(layerSetOf("mouth")))).toEqual(Array.from(uniqueEdges(FACEMESH_LIPS)))
    const contours = uniqueEdges([
      ...FACEMESH_LIPS, ...FACEMESH_LEFT_EYE, ...FACEMESH_RIGHT_EYE,
      ...FACEMESH_FACE_OVAL, ...FACEMESH_LEFT_EYEBROW, ...FACEMESH_RIGHT_EYEBROW, ...FACEMESH_NOSE,
    ])
    expect(Array.from(outlineEdgesOf(layerSetOf("contours")))).toEqual(Array.from(contours))
    expect(Array.from(CONTOUR_EDGES)).toEqual(Array.from(contours))
  })

  it("the wireframe, the irises and bold add no outline; the same set is the same array", () => {
    expect(outlineEdgesOf(layerSetOf({ layers: { wireframe: true, irises: true, bold: true } }))).toHaveLength(0)
    expect(outlineEdgesOf(layerSetOf({ layers: { eyes: true, bold: true } }))).toBe(outlineEdgesOf(layerSetOf({ layers: { eyes: true } })))
  })
})

describe("visibilityLayoutOf", () => {
  const P = FACE_MESH_VISIBILITY.pieces

  it("the outlines, then each eye's outline for its iris, then the wireframe's points", () => {
    const set = layerSetOf({ layers: { wireframe: true, lips: true, contours: true, irises: true } })
    const layout = visibilityLayoutOf(set)
    const outline = outlineEdgesOf(set)
    const n = outline.length / 2
    expect(layout.outline).toEqual([0, n])
    expect(layout.leftIris).toEqual([n, n + LEFT_EYE_EDGES.length / 2])
    expect(layout.rightIris).toEqual([n + LEFT_EYE_EDGES.length / 2, n + (LEFT_EYE_EDGES.length + RIGHT_EYE_EDGES.length) / 2])
    expect(Array.from(layout.edges)).toEqual([...outline, ...LEFT_EYE_EDGES, ...RIGHT_EYE_EDGES])
    expect(layout.meshPointsFrom).toBe((layout.edges.length / 2) * P)
  })

  it("the contours' own: the contours' edges and nothing else", () => {
    const layout = visibilityLayoutOf(layerSetOf("contours"))
    expect(Array.from(layout.edges)).toEqual(Array.from(CONTOUR_EDGES))
    expect([layout.leftIris, layout.rightIris, layout.meshPointsFrom]).toEqual([undefined, undefined, undefined])
  })
})

describe("the irises' eyes", () => {
  it("the right iris (468–472) in the right eye's outline, the left (473–477) in the left's; each opening a closed loop of 16", () => {
    expect(FACE_MESH_IRISES.right).toMatchObject({ centre: 468, rim: [469, 470, 471, 472] })
    expect(FACE_MESH_IRISES.left).toMatchObject({ centre: 473, rim: [474, 475, 476, 477] })
    expect(new Set(FACE_MESH_IRISES.right.opening)).toEqual(new Set(FACEMESH_RIGHT_EYE))
    expect(new Set(FACE_MESH_IRISES.left.opening)).toEqual(new Set(FACEMESH_LEFT_EYE))
    for (const { opening } of [FACE_MESH_IRISES.left, FACE_MESH_IRISES.right]) {
      expect(opening).toHaveLength(16)
      // Each step round the loop is one of the eye's edges.
      const edges = new Set<string>()
      const eye = opening === FACE_MESH_IRISES.left.opening ? FACEMESH_LEFT_EYE : FACEMESH_RIGHT_EYE
      for (let i = 0; i < eye.length; i += 2) edges.add(`${Math.min(eye[i]!, eye[i + 1]!)}-${Math.max(eye[i]!, eye[i + 1]!)}`)
      opening.forEach((a, i) => {
        const b = opening[(i + 1) % opening.length]!
        expect(edges.has(`${Math.min(a, b)}-${Math.max(a, b)}`)).toBe(true)
      })
    }
  })
})
