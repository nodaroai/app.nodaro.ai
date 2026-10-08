/**
 * The job-only face descriptor (P3.2b round 3, decided 2026-10-08): a small
 * landmark-aligned luma crop plus a colour histogram of the face and the region
 * just below it, from the 540p proxy frame. Pure — synthetic frames here; the
 * real decode path is `detect-faces.parity.test.ts`.
 */
import { describe, it, expect } from "vitest"
import {
  FACE_DESCRIPTOR_HIST_BINS,
  FACE_DESCRIPTOR_LUMA_SIDE,
  FACE_DESCRIPTOR_VERSION,
  faceDescriptor,
  readFaceDescriptor,
} from "../face-descriptor.js"
import type { YunetFace } from "../yunet-decode.js"

const W = 960
const H = 540

/** A grey BGR frame. */
function frame(fill = 90): Uint8Array {
  return new Uint8Array(W * H * 3).fill(fill)
}

function setPx(bgr: Uint8Array, x: number, y: number, [b, g, r]: readonly [number, number, number]): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const o = (y * W + x) * 3
  bgr[o] = b
  bgr[o + 1] = g
  bgr[o + 2] = r
}

interface Painted {
  readonly face: YunetFace
}

/**
 * Paint a face-like pattern whose features sit on its landmarks: a skin oval,
 * dark eyes, a nose shadow, a mouth, a coloured shirt below. `s` is the
 * inter-eye distance in pixels; (cx, cy) the eyes' midpoint. `variant` changes
 * the feature layout (another face), `shirt` the colour below.
 */
function paintFace(
  bgr: Uint8Array,
  cx: number,
  cy: number,
  s: number,
  opts: { variant?: 0 | 1; shirt?: readonly [number, number, number]; skin?: readonly [number, number, number]; gain?: number } = {},
): Painted {
  const variant = opts.variant ?? 0
  const gain = opts.gain ?? 1
  const g = (c: readonly [number, number, number]) => c.map((v) => Math.min(255, Math.round(v * gain))) as unknown as readonly [number, number, number]
  const skin = g(opts.skin ?? [120, 150, 200])
  const dark = g([30, 30, 40])
  const shirt = g(opts.shirt ?? [200, 60, 40])
  const faceW = 2.2 * s
  const faceH = 2.8 * s
  const top = cy - 1.1 * s
  for (let y = Math.floor(top); y < top + faceH; y++) {
    for (let x = Math.floor(cx - faceW / 2); x < cx + faceW / 2; x++) {
      const nx = (x - cx) / (faceW / 2)
      const ny = (y - (top + faceH / 2)) / (faceH / 2)
      if (nx * nx + ny * ny <= 1) setPx(bgr, x, y, skin)
    }
  }
  // Below the chin: the shirt, one face height down, 1.5 face widths across.
  for (let y = Math.floor(top + faceH); y < top + 2 * faceH; y++) {
    for (let x = Math.floor(cx - 0.75 * faceW); x < cx + 0.75 * faceW; x++) setPx(bgr, x, y, shirt)
  }
  const blob = (bx: number, by: number, rx: number, ry: number) => {
    for (let y = Math.floor(by - ry); y <= by + ry; y++) {
      for (let x = Math.floor(bx - rx); x <= bx + rx; x++) {
        if (((x - bx) / rx) ** 2 + ((y - by) / ry) ** 2 <= 1) setPx(bgr, x, y, dark)
      }
    }
  }
  const eyeL = [cx - s / 2, cy] as const
  const eyeR = [cx + s / 2, cy] as const
  const nose = [cx, cy + 0.55 * s] as const
  const mouthL = [cx - 0.4 * s, cy + 1.0 * s] as const
  const mouthR = [cx + 0.4 * s, cy + 1.0 * s] as const
  if (variant === 0) {
    blob(eyeL[0], eyeL[1], 0.18 * s, 0.1 * s)
    blob(eyeR[0], eyeR[1], 0.18 * s, 0.1 * s)
    blob(nose[0], nose[1], 0.08 * s, 0.15 * s)
    blob(cx, mouthL[1], 0.4 * s, 0.07 * s)
  } else {
    // Another face: heavy brows and a beard instead of a thin mouth.
    blob(eyeL[0], eyeL[1] - 0.25 * s, 0.3 * s, 0.07 * s)
    blob(eyeR[0], eyeR[1] - 0.25 * s, 0.3 * s, 0.07 * s)
    blob(cx, cy + 1.25 * s, 0.75 * s, 0.4 * s)
  }
  const frac = ([x, y]: readonly [number, number]) => [x / W, y / H] as const
  return {
    face: {
      x: (cx - faceW / 2) / W,
      y: top / H,
      w: faceW / W,
      h: faceH / H,
      score: 0.9,
      // YuNet's order: right eye, left eye (the subject's; image-left first), nose, right and left mouth corners.
      landmarks: [frac(eyeL), frac(eyeR), frac(nose), frac(mouthL), frac(mouthR)],
    },
  }
}

const cosine = (a: Int8Array, b: Int8Array) => {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    d += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na > 0 && nb > 0 ? d / Math.sqrt(na * nb) : 0
}

const intersection = (a: Uint8Array, b: Uint8Array) => {
  let s = 0, ta = 0, tb = 0
  for (let i = 0; i < a.length; i++) {
    s += Math.min(a[i]!, b[i]!)
    ta += a[i]!
    tb += b[i]!
  }
  return ta > 0 && tb > 0 ? s / Math.min(ta, tb) : 0
}

describe("the face descriptor", () => {
  it("is a versioned pair of small byte strings: an 8×8 luma crop and two 64-bin RGB histograms", () => {
    const bgr = frame()
    const { face } = paintFace(bgr, 300, 200, 40)
    const d = faceDescriptor(bgr, W, H, face)
    expect(d.version).toBe(FACE_DESCRIPTOR_VERSION)
    const r = readFaceDescriptor(d)
    expect(FACE_DESCRIPTOR_LUMA_SIDE).toBe(8)
    expect(r.luma).toHaveLength(64)
    expect(FACE_DESCRIPTOR_HIST_BINS).toBe(64)
    expect(r.face).toHaveLength(64)
    expect(r.below).toHaveLength(64)
    // Base64 of 64 + 128 bytes: a few hundred characters per box, never pixels.
    expect(d.luma.length + d.hist.length).toBeLessThan(300)
  })

  it("is deterministic", () => {
    const bgr = frame()
    const { face } = paintFace(bgr, 300, 200, 40)
    expect(faceDescriptor(bgr, W, H, face)).toEqual(faceDescriptor(bgr, W, H, face))
  })

  it("the luma crop is aligned on the landmarks: the same face elsewhere, at another size, reads the same", () => {
    const a = frame()
    const b = frame()
    const fa = paintFace(a, 250, 180, 30).face
    const fb = paintFace(b, 700, 300, 60).face
    const la = readFaceDescriptor(faceDescriptor(a, W, H, fa)).luma
    const lb = readFaceDescriptor(faceDescriptor(b, W, H, fb)).luma
    expect(cosine(la, lb)).toBeGreaterThan(0.9)
  })

  it("is zero-mean and unit-scaled: a brighter exposure of the same face reads the same", () => {
    const a = frame(60)
    const b = frame(60)
    const fa = paintFace(a, 400, 220, 40).face
    const fb = paintFace(b, 400, 220, 40, { gain: 1.25 }).face
    const la = readFaceDescriptor(faceDescriptor(a, W, H, fa)).luma
    const lb = readFaceDescriptor(faceDescriptor(b, W, H, fb)).luma
    expect(cosine(la, lb)).toBeGreaterThan(0.95)
  })

  it("another face reads differently", () => {
    const a = frame()
    const b = frame()
    const fa = paintFace(a, 400, 220, 40, { variant: 0 }).face
    const fb = paintFace(b, 400, 220, 40, { variant: 1 }).face
    const la = readFaceDescriptor(faceDescriptor(a, W, H, fa)).luma
    const lb = readFaceDescriptor(faceDescriptor(b, W, H, fb)).luma
    expect(cosine(la, lb)).toBeLessThan(0.8)
  })

  it("the region below the face carries the clothing colour", () => {
    const a = frame()
    const b = frame()
    const c = frame()
    const fa = paintFace(a, 400, 150, 40, { shirt: [200, 60, 40] }).face
    const fb = paintFace(b, 600, 160, 45, { shirt: [200, 60, 40] }).face
    const fc = paintFace(c, 400, 150, 40, { shirt: [30, 200, 220] }).face
    const ra = readFaceDescriptor(faceDescriptor(a, W, H, fa))
    const rb = readFaceDescriptor(faceDescriptor(b, W, H, fb))
    const rc = readFaceDescriptor(faceDescriptor(c, W, H, fc))
    expect(intersection(ra.below, rb.below)).toBeGreaterThan(0.8)
    expect(intersection(ra.below, rc.below)).toBeLessThan(0.5)
    // The face histograms agree: same skin.
    expect(intersection(ra.face, rc.face)).toBeGreaterThan(0.8)
  })

  it("a region mostly outside the frame is all zeros (absent), never a histogram of a sliver", () => {
    const bgr = frame()
    // A face at the bottom edge: nothing below it is in the frame.
    const { face } = paintFace(bgr, 400, H - 40, 20)
    const r = readFaceDescriptor(faceDescriptor(bgr, W, H, face))
    expect(r.below.every((v) => v === 0)).toBe(true)
    expect(r.face.some((v) => v > 0)).toBe(true)
  })

  it("a flat crop has no luma pattern: all zeros, which compares as nothing", () => {
    const bgr = frame(128)
    const face: YunetFace = {
      x: 0.4, y: 0.3, w: 0.1, h: 0.2, score: 0.9,
      landmarks: [[0.43, 0.38], [0.47, 0.38], [0.45, 0.42], [0.435, 0.46], [0.465, 0.46]],
    }
    expect(readFaceDescriptor(faceDescriptor(bgr, W, H, face)).luma.every((v) => v === 0)).toBe(true)
  })

  it("refuses a buffer that is not one frame of the stated size", () => {
    const { face } = paintFace(frame(), 300, 200, 40)
    expect(() => faceDescriptor(new Uint8Array(10), W, H, face)).toThrow(/not one/)
  })
})
