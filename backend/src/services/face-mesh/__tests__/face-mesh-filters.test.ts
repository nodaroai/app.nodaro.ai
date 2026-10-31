import { describe, expect, it } from "vitest"
import { centreInMask, faceGetsMesh, passesFaceSize, passesZone, type MaskFrame } from "../face-mesh-filters.js"

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })
const off = { minFaceHeightPct: 0, maxFaceHeightPct: 0, zone: null }

describe("passesFaceSize", () => {
  it("off draws every face", () => {
    expect(passesFaceSize(box(0, 0, 0.01, 0.01), off)).toBe(true)
  })
  it("keeps min ≤ height ≤ max (max 0 = no cap)", () => {
    const b = box(0.4, 0.4, 0.1, 0.1) // 10 % tall
    expect(passesFaceSize(b, { minFaceHeightPct: 10, maxFaceHeightPct: 0 })).toBe(true)
    expect(passesFaceSize(b, { minFaceHeightPct: 11, maxFaceHeightPct: 0 })).toBe(false)
    expect(passesFaceSize(b, { minFaceHeightPct: 0, maxFaceHeightPct: 10 })).toBe(true)
    expect(passesFaceSize(b, { minFaceHeightPct: 0, maxFaceHeightPct: 9 })).toBe(false)
  })
})

describe("passesZone", () => {
  const zone = { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 20 }
  it("no zone: anywhere", () => {
    expect(passesZone(box(0, 0, 0.02, 0.02), null)).toBe(true)
  })
  it("reads the box CENTRE against the margins", () => {
    expect(passesZone(box(0.4, 0.4, 0.2, 0.2), zone)).toBe(true) // centre 0.5, 0.5
    expect(passesZone(box(0.0, 0.4, 0.1, 0.1), zone)).toBe(false) // centre x 0.05 < 0.1
    expect(passesZone(box(0.0, 0.4, 0.3, 0.1), zone)).toBe(true) // centre x 0.15: the box reaches the margin, its centre is inside
    expect(passesZone(box(0.85, 0.4, 0.1, 0.1), zone)).toBe(true) // centre x 0.9: on the margin's edge, inside
    expect(passesZone(box(0.88, 0.4, 0.1, 0.1), zone)).toBe(false) // centre x 0.93 > 0.9
    expect(passesZone(box(0.4, 0.8, 0.1, 0.1), zone)).toBe(false) // centre y 0.85 > 0.8
  })
})

describe("centreInMask", () => {
  // A 10 × 10 mask, the right half covered.
  const gray = new Uint8Array(100)
  for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) gray[y * 10 + x] = 255
  const mask: MaskFrame = { gray, width: 10, height: 10 }

  it("draws a face whose centre lies on a covered pixel, and not one beside it", () => {
    expect(centreInMask(box(0.6, 0.2, 0.2, 0.2), mask)).toBe(true)
    expect(centreInMask(box(0.1, 0.2, 0.2, 0.2), mask)).toBe(false)
  })
  it("a covered pixel is above 127 (an encoder's grey edge is not covered)", () => {
    const soft: MaskFrame = { gray: new Uint8Array(100).fill(127), width: 10, height: 10 }
    expect(centreInMask(box(0.4, 0.4, 0.2, 0.2), soft)).toBe(false)
    expect(centreInMask(box(0.4, 0.4, 0.2, 0.2), { ...soft, gray: new Uint8Array(100).fill(128) })).toBe(true)
  })
  it("reads the mask at its own size (fractions), a centre off the frame clamped onto its edge", () => {
    expect(centreInMask(box(0.95, 0.5, 0.2, 0.2), mask)).toBe(true)
    expect(centreInMask(box(-0.3, 0.5, 0.2, 0.2), mask)).toBe(false)
  })
})

describe("faceGetsMesh", () => {
  const gray = new Uint8Array(100).fill(255)
  const mask: MaskFrame = { gray, width: 10, height: 10 }
  it("needs every filter: size, zone and the mask", () => {
    const b = box(0.4, 0.4, 0.2, 0.2)
    expect(faceGetsMesh(b, off, undefined)).toBe(true)
    expect(faceGetsMesh(b, off, mask)).toBe(true)
    expect(faceGetsMesh(b, off, { ...mask, gray: new Uint8Array(100) })).toBe(false)
    expect(faceGetsMesh(b, { ...off, minFaceHeightPct: 30 }, mask)).toBe(false)
    expect(faceGetsMesh(box(0.1, 0.4, 0.2, 0.2), { ...off, zone: { leftPct: 49, rightPct: 0, topPct: 0, bottomPct: 0 } }, mask)).toBe(false)
  })
})
