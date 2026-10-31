import { describe, expect, it } from "vitest"
import { cropToFrame, fillFaceMeshInput, landmarksToFrame, roiOfFace, sigmoid, FACE_MESH_ROI_SCALE } from "../face-mesh-crop.js"
import { FACE_MESH_INPUT_SIZE, FACE_MESH_POINTS } from "../face-mesh-model.js"

const W = 400
const H = 200

/** A YuNet face (fractions) with the eyes at the given pixel points. */
function face(box: [number, number, number, number], rightEye: [number, number], leftEye: [number, number]) {
  const [x, y, w, h] = box
  return {
    x: x / W, y: y / H, w: w / W, h: h / H,
    landmarks: [[rightEye[0] / W, rightEye[1] / H], [leftEye[0] / W, leftEye[1] / H]] as Array<readonly [number, number]>,
  }
}

describe("roiOfFace", () => {
  it("is square around the box centre, 1.5 × its longer side, level when the eyes are", () => {
    const roi = roiOfFace(face([100, 50, 40, 60], [110, 70], [130, 70]), W, H)
    expect(roi.cx).toBeCloseTo(120)
    expect(roi.cy).toBeCloseTo(80)
    expect(roi.size).toBeCloseTo(60 * FACE_MESH_ROI_SCALE)
    expect(roi.angle).toBeCloseTo(0)
  })

  it("turns by the eye line: the right eye (image left) to the left eye", () => {
    // The left eye 20 px right and 20 px lower: a 45° tilt.
    expect(roiOfFace(face([100, 50, 40, 40], [110, 60], [130, 80]), W, H).angle).toBeCloseTo(Math.PI / 4)
    expect(roiOfFace(face([100, 50, 40, 40], [110, 80], [130, 60]), W, H).angle).toBeCloseTo(-Math.PI / 4)
  })
})

describe("cropToFrame", () => {
  it("maps the crop's centre to the roi's centre and its corners by the turn", () => {
    const roi = { cx: 100, cy: 50, size: 96, angle: 0 }
    expect(cropToFrame(roi, 96, 96)).toEqual([100, 50])
    const [x, y] = cropToFrame(roi, 0, 0)
    expect(x).toBeCloseTo(52)
    expect(y).toBeCloseTo(2)
    // Turned a quarter: the crop's top-left corner lands at the frame's top-right of the centre.
    const [tx, ty] = cropToFrame({ ...roi, angle: Math.PI / 2 }, 0, 0)
    expect(tx).toBeCloseTo(148)
    expect(ty).toBeCloseTo(2)
  })

  it("landmarksToFrame gives fractions of the frame through the same map", () => {
    const roi = { cx: 200, cy: 100, size: 100, angle: 0.3 }
    const lm = new Float32Array(FACE_MESH_POINTS * 3)
    lm[0] = 96; lm[1] = 96 // point 0 at the crop's centre
    lm[3] = 10; lm[4] = 150
    const out = landmarksToFrame(lm, roi, W, H)
    expect(out).toHaveLength(FACE_MESH_POINTS * 2)
    expect(out[0]).toBeCloseTo(0.5)
    expect(out[1]).toBeCloseTo(0.5)
    const [x, y] = cropToFrame(roi, 10, 150)
    expect(out[2]).toBeCloseTo(x / W)
    expect(out[3]).toBeCloseTo(y / H)
  })
})

describe("fillFaceMeshInput", () => {
  const n = FACE_MESH_INPUT_SIZE

  it("samples RGB in [0, 1] from a BGR frame (channels swapped)", () => {
    const bgr = new Uint8Array(W * H * 3)
    for (let i = 0; i < W * H; i++) {
      bgr[3 * i] = 255 // blue
      bgr[3 * i + 1] = 0
      bgr[3 * i + 2] = 51 // red = 0.2
    }
    const out = new Float32Array(n * n * 3)
    fillFaceMeshInput(bgr, W, H, { cx: 200, cy: 100, size: 80, angle: 0.4 }, out)
    expect(out[0]).toBeCloseTo(0.2) // R
    expect(out[1]).toBeCloseTo(0) // G
    expect(out[2]).toBeCloseTo(1) // B
    expect(out[(n * n - 1) * 3 + 2]).toBeCloseTo(1)
  })

  it("reads black outside the frame", () => {
    const bgr = new Uint8Array(W * H * 3).fill(200)
    const out = new Float32Array(n * n * 3)
    // Centred on the frame's top-left corner: the crop's top-left quarter is off the frame.
    fillFaceMeshInput(bgr, W, H, { cx: 0, cy: 0, size: 100, angle: 0 }, out)
    expect(out[0]).toBe(0)
    const inside = ((n - 1) * n + (n - 1)) * 3
    expect(out[inside]).toBeCloseTo(200 / 255)
  })

  it("puts the frame's content where cropToFrame says it is", () => {
    // A single bright pixel; the crop pixel that maps onto it reads bright.
    const bgr = new Uint8Array(W * H * 3)
    const at = (73 * W + 211) * 3
    bgr[at] = bgr[at + 1] = bgr[at + 2] = 255
    const roi = { cx: 200, cy: 80, size: 192, angle: 0.25 }
    const out = new Float32Array(n * n * 3)
    fillFaceMeshInput(bgr, W, H, roi, out)
    let best = -1
    let bestU = 0
    let bestV = 0
    for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
      const val = out[(v * n + u) * 3]!
      if (val > best) { best = val; bestU = u; bestV = v }
    }
    const [x, y] = cropToFrame(roi, bestU + 0.5, bestV + 0.5)
    expect(Math.hypot(x - 211.5, y - 73.5)).toBeLessThan(1)
  })

  it("refuses a buffer that is not one frame, or an input of the wrong size", () => {
    expect(() => fillFaceMeshInput(new Uint8Array(10), W, H, { cx: 0, cy: 0, size: 10, angle: 0 }, new Float32Array(n * n * 3))).toThrow(/BGR frame/)
    expect(() => fillFaceMeshInput(new Uint8Array(W * H * 3), W, H, { cx: 0, cy: 0, size: 10, angle: 0 }, new Float32Array(3))).toThrow(/input/)
  })
})

describe("sigmoid", () => {
  it("is 0.5 at 0 and monotone", () => {
    expect(sigmoid(0)).toBe(0.5)
    expect(sigmoid(4)).toBeGreaterThan(0.98)
    expect(sigmoid(-4)).toBeLessThan(0.02)
  })
})
