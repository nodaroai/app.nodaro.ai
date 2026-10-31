import { describe, expect, it } from "vitest"
import { FACE_MESH_STYLE, compositeFaceMesh, faceMeshOverlay } from "../face-mesh-draw.js"
import { FACEMESH_LEFT_EYE, FACEMESH_LIPS, FACEMESH_RIGHT_EYE, FACEMESH_TESSELATION } from "../face-mesh-topology.js"
import { FACE_MESH_POINTS } from "../face-mesh-model.js"

const W = 200
const H = 100

/** 468 points spread on a grid inside [x0, x0 + w] × [y0, y0 + h] (fractions). */
function face(x0: number, y0: number, w: number, h: number): Float64Array {
  const out = new Float64Array(FACE_MESH_POINTS * 2)
  for (let i = 0; i < FACE_MESH_POINTS; i++) {
    out[2 * i] = x0 + ((i % 22) / 21) * w
    out[2 * i + 1] = y0 + (Math.floor(i / 22) / 21) * h
  }
  return out
}

describe("the topology", () => {
  it("joins points of the 468 only, in pairs", () => {
    for (const t of [FACEMESH_TESSELATION, FACEMESH_LIPS, FACEMESH_LEFT_EYE, FACEMESH_RIGHT_EYE]) {
      expect(t.length % 2).toBe(0)
      expect(t.every((i) => Number.isInteger(i) && i >= 0 && i < FACE_MESH_POINTS)).toBe(true)
    }
    expect(FACEMESH_TESSELATION.length / 2).toBe(2556)
    expect(FACEMESH_LIPS.length / 2).toBe(40)
    expect(FACEMESH_LEFT_EYE.length / 2).toBe(16)
    expect(FACEMESH_RIGHT_EYE.length / 2).toBe(16)
  })
})

describe("faceMeshOverlay", () => {
  it("nothing to draw: null", () => {
    expect(faceMeshOverlay([], W, H)).toBeNull()
    expect(faceMeshOverlay([face(2, 2, 0.1, 0.1)], W, H)).toBeNull() // entirely off the frame
  })

  it("one path per style: a thin translucent blue mesh, solid blue lips twice as thick, solid green eyes", () => {
    // 50 px tall face → the 1-px floor; a 300 px face → 3 px.
    const o = faceMeshOverlay([face(0.1, 0.1, 0.2, 0.5)], W, H)!
    expect(o.svg.match(/<path /g)).toHaveLength(3)
    expect(o.svg).toContain(`stroke="${FACE_MESH_STYLE.mesh.color}" stroke-opacity="0.6" stroke-width="1"`)
    expect(o.svg).toContain(`stroke="${FACE_MESH_STYLE.lips.color}" stroke-width="2"`)
    expect(o.svg).toContain(`stroke="${FACE_MESH_STYLE.eyes.color}" stroke-width="2"`)
    expect(FACE_MESH_STYLE.mesh.color).toBe("#3D7BFF")
    expect(FACE_MESH_STYLE.eyes.color).toBe("#2BD96B")
    const big = faceMeshOverlay([face(0, 0, 1, 1)], 1000, 300)!
    expect(big.svg).toContain('stroke-opacity="0.6" stroke-width="3"')
    expect(big.svg).toContain(`stroke="${FACE_MESH_STYLE.lips.color}" stroke-width="6"`)
  })

  it("covers only the faces' box (widened by the thickest line), clipped to the frame", () => {
    const o = faceMeshOverlay([face(0.25, 0.25, 0.25, 0.5)], W, H)!
    // Points span x 50–100, y 25–75; padding 2·1 + 1 = 3.
    expect(o.left).toBe(47)
    expect(o.top).toBe(22)
    expect(o.width).toBe(106 - 47 - 3)
    expect(o.height).toBe(78 - 22)
    const edge = faceMeshOverlay([face(0, 0, 1, 1)], W, H)!
    expect([edge.left, edge.top, edge.width, edge.height]).toEqual([0, 0, W, H])
  })

  it("draws every face of the frame", () => {
    const o = faceMeshOverlay([face(0.1, 0.1, 0.2, 0.3), face(0.6, 0.5, 0.2, 0.3)], W, H)!
    expect(o.svg.match(/<path /g)).toHaveLength(6)
  })
})

describe("compositeFaceMesh", () => {
  it("draws the lines on the frame at their place, the rest untouched, same size", async () => {
    const rgb = Buffer.alloc(W * H * 3, 0)
    const o = faceMeshOverlay([face(0.3, 0.2, 0.4, 0.6)], W, H)!
    const out = await compositeFaceMesh(rgb, W, H, o)
    expect(out.length).toBe(W * H * 3)
    let blueish = 0
    let greenish = 0
    for (let i = 0; i < W * H; i++) {
      const r = out[3 * i]!, g = out[3 * i + 1]!, b = out[3 * i + 2]!
      if (b > 120 && b > r && b > g) blueish++
      if (g > 120 && g > r && g > b) greenish++
    }
    expect(blueish).toBeGreaterThan(100)
    expect(greenish).toBeGreaterThan(10)
    // A corner far from the face stays black.
    expect([out[0], out[1], out[2]]).toEqual([0, 0, 0])
    expect(rgb.every((v) => v === 0)).toBe(true) // the input is not changed
  })
})
