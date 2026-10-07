/**
 * YuNet's output decode, the probe's NMS and the input layout — pure, no
 * onnxruntime. The parity test (`detect-faces.parity.test.ts`) checks the same
 * code against the measured detections; these pin the rules one at a time.
 */
import { describe, it, expect } from "vitest"
import {
  YUNET_STRIDES,
  YUNET_NMS_IOU,
  decodeYunet,
  fillYunetInput,
  paddedSize,
  rgbThumb,
  type YunetOutputs,
} from "../yunet-decode.js"

/** Empty outputs for a padded `pw × ph` input: every anchor scores 0. */
function emptyOutputs(pw: number, ph: number): Record<string, Float32Array> {
  const out: Record<string, Float32Array> = {}
  for (const st of YUNET_STRIDES) {
    const n = (pw / st) * (ph / st)
    out[`cls_${st}`] = new Float32Array(n)
    out[`obj_${st}`] = new Float32Array(n)
    out[`bbox_${st}`] = new Float32Array(4 * n)
    out[`kps_${st}`] = new Float32Array(10 * n)
  }
  return out
}

/** Put a face on anchor (row, col) of stride `st`: score² = cls × obj. */
function plant(
  out: Record<string, Float32Array>,
  pw: number,
  st: number,
  row: number,
  col: number,
  face: { cls: number; obj: number; dx?: number; dy?: number; logW?: number; logH?: number },
): void {
  const i = row * (pw / st) + col
  out[`cls_${st}`]![i] = face.cls
  out[`obj_${st}`]![i] = face.obj
  out[`bbox_${st}`]!.set([face.dx ?? 0.5, face.dy ?? 0.5, face.logW ?? Math.log(4), face.logH ?? Math.log(4)], 4 * i)
  // Five landmarks at the anchor's centre offsets 0.1 … 0.5.
  out[`kps_${st}`]!.set([0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.4, 0.4, 0.5, 0.5], 10 * i)
}

const asOutputs = (o: Record<string, Float32Array>): YunetOutputs => o as unknown as YunetOutputs

describe("paddedSize", () => {
  it("pads each side up to a multiple of 32, as OpenCV's FaceDetectorYN does", () => {
    expect(paddedSize(960, 540)).toEqual({ pw: 960, ph: 544 })
    expect(paddedSize(640, 360)).toEqual({ pw: 640, ph: 384 })
    expect(paddedSize(32, 32)).toEqual({ pw: 32, ph: 32 })
    expect(paddedSize(33, 1)).toEqual({ pw: 64, ph: 32 })
  })
})

describe("fillYunetInput", () => {
  it("writes BGR planes (unnormalized 0..255) and never touches the padding", () => {
    const w = 2, h = 1
    const { pw, ph } = paddedSize(w, h)
    const input = new Float32Array(3 * pw * ph) // zeroed once per window
    const plane = pw * ph
    // Two frames through the same buffer: (B,G,R) = (1,2,3),(4,5,6), then (9,9,9),(8,8,8).
    for (const bgr of [Buffer.from([1, 2, 3, 4, 5, 6]), Buffer.from([9, 9, 9, 8, 8, 8])]) {
      fillYunetInput(bgr, w, h, pw, ph, input)
      expect([input[0], input[1]]).toEqual([bgr[0], bgr[3]]) // B
      expect([input[plane], input[plane + 1]]).toEqual([bgr[1], bgr[4]]) // G
      expect([input[2 * plane], input[2 * plane + 1]]).toEqual([bgr[2], bgr[5]]) // R
      // Everything outside the picture stays zero: the padding is the
      // detector's input too, and a frame never leaks into it.
      let nonZeroPadding = 0
      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) if ((x >= w || y >= h) && input[c * plane + y * pw + x] !== 0) nonZeroPadding++
        }
      }
      expect(nonZeroPadding).toBe(0)
    }
  })

  it("refuses a buffer that is not one w × h BGR frame", () => {
    const { pw, ph } = paddedSize(4, 4)
    expect(() => fillYunetInput(Buffer.alloc(10), 4, 4, pw, ph, new Float32Array(3 * pw * ph))).toThrow(/frame/)
  })
})

describe("decodeYunet", () => {
  const w = 960, h = 540
  const { pw, ph } = paddedSize(w, h)

  it("decodes an anchor into a TOP-LEFT box, as fractions of the display frame", () => {
    const out = emptyOutputs(pw, ph)
    // Stride 8, row 10, col 20; centre offset (0.5, 0.5); size exp(log 4) × 8 = 32 px.
    plant(out, pw, 8, 10, 20, { cls: 0.81, obj: 1 })
    const [face, ...rest] = decodeYunet(asOutputs(out), { pw, ph, width: w, height: h, minScore: 0.5 })
    expect(rest).toEqual([])
    const cx = (20 + 0.5) * 8, cy = (10 + 0.5) * 8
    expect(face!.x).toBeCloseTo((cx - 16) / w, 9)
    expect(face!.y).toBeCloseTo((cy - 16) / h, 9)
    expect(face!.w).toBeCloseTo(32 / w, 9)
    expect(face!.h).toBeCloseTo(32 / h, 9)
    expect(face!.score).toBeCloseTo(0.9, 6) // sqrt(0.81 × 1); the outputs are float32
  })

  it("decodes five landmarks per face, as OpenCV does ((col + k) × stride), as fractions", () => {
    const out = emptyOutputs(pw, ph)
    plant(out, pw, 16, 4, 7, { cls: 1, obj: 1 })
    const [face] = decodeYunet(asOutputs(out), { pw, ph, width: w, height: h, minScore: 0.5 })
    expect(face!.landmarks).toHaveLength(5)
    face!.landmarks.forEach(([lx, ly], k) => {
      const off = 0.1 * (k + 1)
      expect(lx).toBeCloseTo(((7 + off) * 16) / w, 9)
      expect(ly).toBeCloseTo(((4 + off) * 16) / h, 9)
    })
  })

  it("clamps cls and obj to [0, 1] before the geometric mean (raw logits never leak a score > 1)", () => {
    const out = emptyOutputs(pw, ph)
    plant(out, pw, 32, 1, 1, { cls: 1.7, obj: 1.2 })
    const [face] = decodeYunet(asOutputs(out), { pw, ph, width: w, height: h, minScore: 0.5 })
    expect(face!.score).toBe(1)
  })

  it("keeps only faces at or above minScore", () => {
    const out = emptyOutputs(pw, ph)
    plant(out, pw, 8, 0, 0, { cls: 0.49, obj: 1 }) // 0.7 exactly
    plant(out, pw, 8, 20, 50, { cls: 0.4899, obj: 1 }) // just under
    const faces = decodeYunet(asOutputs(out), { pw, ph, width: w, height: h, minScore: 0.7 })
    expect(faces).toHaveLength(1)
    expect(faces[0]!.score).toBeCloseTo(0.7, 6)
  })

  it("suppresses a lower-scored box overlapping a kept one past IoU 0.3 (the probe's greedy NMS)", () => {
    expect(YUNET_NMS_IOU).toBe(0.3)
    const out = emptyOutputs(pw, ph)
    // Two 32 px boxes on neighbouring stride-8 anchors: centres 8 px apart → IoU = 24/40 = 0.6.
    plant(out, pw, 8, 10, 20, { cls: 0.9, obj: 1 })
    plant(out, pw, 8, 10, 21, { cls: 0.8, obj: 1 })
    // A third, far away, survives.
    plant(out, pw, 8, 40, 80, { cls: 0.7, obj: 1 })
    const faces = decodeYunet(asOutputs(out), { pw, ph, width: w, height: h, minScore: 0.5 })
    expect(faces.map((f) => f.score.toFixed(4))).toEqual([Math.sqrt(0.9), Math.sqrt(0.7)].map((s) => s.toFixed(4)))
  })

  it("keeps two boxes whose IoU is at most 0.3", () => {
    const out = emptyOutputs(pw, ph)
    // Centres 32 px apart on a 32 px box: touching, IoU 0.
    plant(out, pw, 8, 10, 20, { cls: 0.9, obj: 1 })
    plant(out, pw, 8, 10, 24, { cls: 0.8, obj: 1 })
    expect(decodeYunet(asOutputs(out), { pw, ph, width: w, height: h, minScore: 0.5 })).toHaveLength(2)
  })

  it("returns faces highest score first", () => {
    const out = emptyOutputs(pw, ph)
    plant(out, pw, 32, 2, 2, { cls: 0.6, obj: 1 })
    plant(out, pw, 16, 20, 40, { cls: 0.95, obj: 1 })
    plant(out, pw, 8, 60, 100, { cls: 0.8, obj: 1 })
    const scores = decodeYunet(asOutputs(out), { pw, ph, width: w, height: h, minScore: 0.5 }).map((f) => f.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(scores).toHaveLength(3)
  })
})

describe("rgbThumb", () => {
  it("box-averages a BGR frame into a tiny RGB thumbnail", () => {
    // 4 × 2 frame: left half pure blue, right half pure red.
    const w = 4, h = 2
    const bgr = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 3
        if (x < 2) bgr[o] = 255 // B
        else bgr[o + 2] = 255 // R
      }
    }
    const t = rgbThumb(bgr, w, h, 2, 1)
    expect([...t]).toEqual([0, 0, 255, 255, 0, 0])
  })
})
