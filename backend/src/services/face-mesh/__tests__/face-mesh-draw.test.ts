import { describe, expect, it } from "vitest"
import { FACE_MESH_STYLE, compositeFaceMesh, faceMeshOverlay, lineTone, lumaOf } from "../face-mesh-draw.js"
import { depthColormapTable } from "../depth-colormaps.js"
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

describe("lineTone", () => {
  const { mesh, outline } = FACE_MESH_STYLE

  it("darkens a bright pixel: the wireframe × 0.6, the outlines × 0.35", () => {
    expect(lineTone(200, mesh)).toBeCloseTo(120)
    expect(lineTone(200, outline)).toBeCloseTo(70)
    expect(lineTone(100, mesh)).toBeCloseTo(60)
    expect(lineTone(100, outline)).toBeCloseTo(35)
    expect(lineTone(255, mesh)).toBeCloseTo(153)
  })

  it("keeps a few levels of contrast on a dark gray, never under 0", () => {
    expect(lineTone(40, mesh)).toBeCloseTo(24) // 40 × 0.6 is only 16 below: 16 below instead
    expect(lineTone(40, outline)).toBeCloseTo(8) // 32 below
    for (let l = 0; l <= 255; l++) {
      for (const t of [mesh, outline]) {
        expect(lineTone(l, t)).toBeGreaterThanOrEqual(0)
        expect(lineTone(l, t)).toBeLessThanOrEqual(255)
      }
    }
  })

  it("lightens on near black, where there is nothing to darken", () => {
    expect(lineTone(0, mesh)).toBe(20)
    expect(lineTone(0, outline)).toBe(40)
    expect(lineTone(10, mesh)).toBe(30)
  })

  it("never jumps: a small change of the luminance under a line is a small change of its tone", () => {
    for (const t of [mesh, outline]) {
      for (let l = 0; l < 255; l += 0.25) {
        expect(Math.abs(lineTone(l + 0.25, t) - lineTone(l, t))).toBeLessThan(2)
      }
    }
  })

  it("the outlines are never lighter than the wireframe where both darken", () => {
    for (let l = FACE_MESH_STYLE.darkenAt; l <= 255; l++) expect(lineTone(l, outline)).toBeLessThanOrEqual(lineTone(l, mesh))
  })
})

describe("faceMeshOverlay", () => {
  it("nothing to draw: null", () => {
    expect(faceMeshOverlay([], W, H)).toBeNull()
    expect(faceMeshOverlay([face(2, 2, 0.1, 0.1)], W, H)).toBeNull() // entirely off the frame
  })

  it("two layers, one path per face each, white on transparent: no colour in the SVG", () => {
    const o = faceMeshOverlay([face(0.1, 0.1, 0.2, 0.5)], W, H)!
    expect(o.meshSvg.match(/<path /g)).toHaveLength(1)
    expect(o.outlineSvg.match(/<path /g)).toHaveLength(1)
    for (const svg of [o.meshSvg, o.outlineSvg]) {
      expect(svg.match(/#[0-9A-Fa-f]{6}/g)).toEqual(["#FFFFFF"])
      expect(svg).not.toMatch(/opacity/)
    }
  })

  it("thin lines: 1 px at 720p and the outlines 1.5 px; scaled with the frame, capped by the face", () => {
    // 720p, a face 400 px tall: 1 px (the frame), not 4 (the face).
    const hd = faceMeshOverlay([face(0.3, 0.2, 0.3, 0.55)], 1280, 720)!
    expect(hd.meshSvg).toContain('stroke-width="1"')
    expect(hd.outlineSvg).toContain('stroke-width="1.5"')
    // 1080p, a big face: 1.5 px, the outlines 2.3 px.
    const fhd = faceMeshOverlay([face(0.3, 0.2, 0.3, 0.55)], 1920, 1080)!
    expect(fhd.meshSvg).toContain('stroke-width="1.5"')
    expect(fhd.outlineSvg).toContain('stroke-width="2.3"')
    // 2160p portrait, a face 150 px tall: the face caps it (1.5 px, not 3).
    const small = faceMeshOverlay([face(0.4, 0.4, 0.05, 150 / 3840)], 2160, 3840)!
    expect(small.meshSvg).toContain('stroke-width="1.5"')
    // A tiny face on a small frame: never under 1 px.
    const tiny = faceMeshOverlay([face(0.1, 0.1, 0.2, 0.3)], W, H)!
    expect(tiny.meshSvg).toContain('stroke-width="1"')
  })

  it("covers only the faces' box (widened by the thickest line), clipped to the frame", () => {
    const o = faceMeshOverlay([face(0.25, 0.25, 0.25, 0.5)], W, H)!
    // Points span x 50–100, y 25–75; padding ceil(1 × 1.5) + 1 = 3.
    expect(o.left).toBe(47)
    expect(o.top).toBe(22)
    expect(o.width).toBe(103 - 47)
    expect(o.height).toBe(78 - 22)
    const edge = faceMeshOverlay([face(0, 0, 1, 1)], W, H)!
    expect([edge.left, edge.top, edge.width, edge.height]).toEqual([0, 0, W, H])
  })

  it("draws every face of the frame", () => {
    const o = faceMeshOverlay([face(0.1, 0.1, 0.2, 0.3), face(0.6, 0.5, 0.2, 0.3)], W, H)!
    expect(o.meshSvg.match(/<path /g)).toHaveLength(2)
    expect(o.outlineSvg.match(/<path /g)).toHaveLength(2)
  })
})

/** A packed RGB frame, each pixel `at(x, y)`. */
function frame(w: number, h: number, at: (x: number, y: number) => [number, number, number]): Buffer {
  const out = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out.set(at(x, y), (y * w + x) * 3)
  }
  return out
}

describe("compositeFaceMesh", () => {
  const GW = 400
  const GH = 200
  /** A horizontal gray gradient, black at the start to white at the end. */
  const gradient = () => frame(GW, GH, (x) => {
    const v = Math.round((x / (GW - 1)) * 255)
    return [v, v, v]
  })
  const faceOnGradient = () => faceMeshOverlay([face(0.02, 0.05, 0.96, 0.9)], GW, GH)!

  it("draws the lines on the frame at their place, the rest untouched, same size", async () => {
    const rgb = frame(W, H, () => [128, 128, 128])
    const o = faceMeshOverlay([face(0.3, 0.2, 0.4, 0.6)], W, H)!
    const out = await compositeFaceMesh(rgb, W, H, o)
    expect(out.length).toBe(W * H * 3)
    let changed = 0
    for (let i = 0; i < W * H * 3; i++) if (out[i] !== rgb[i]) changed++
    expect(changed).toBeGreaterThan(300)
    // A corner far from the face is untouched.
    expect([out[0], out[1], out[2]]).toEqual([128, 128, 128])
    expect(rgb.every((v) => v === 128)).toBe(true) // the input is not changed
  })

  it("on a gray background no pixel takes a hue: no blue, no green", async () => {
    const rgb = gradient()
    const out = await compositeFaceMesh(rgb, GW, GH, faceOnGradient())
    let drawn = 0
    for (let i = 0; i < GW * GH; i++) {
      const r = out[3 * i]!, g = out[3 * i + 1]!, b = out[3 * i + 2]!
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBe(0)
      if (r !== rgb[3 * i]) drawn++
    }
    expect(drawn).toBeGreaterThan(1000)
  })

  it("a line pixel's gray tracks the luminance under it along the gradient", async () => {
    const rgb = gradient()
    const out = await compositeFaceMesh(rgb, GW, GH, faceOnGradient())
    // The darkest pixel of each band of columns (an outline's core, fully covered) follows the band's gray.
    const darkest: number[] = []
    for (let band = 0; band < 8; band++) {
      let min = 255
      let bg = 0
      for (let x = band * 50; x < band * 50 + 50; x++) {
        for (let y = 0; y < GH; y++) {
          const v = out[(y * GW + x) * 3]!
          if (v < min) {
            min = v
            bg = rgb[(y * GW + x) * 3]!
          }
        }
      }
      darkest.push(min)
      if (bg >= FACE_MESH_STYLE.darkenAt) {
        // Never darker than the outlines' tone of the pixel under it (± rounding).
        expect(min).toBeGreaterThanOrEqual(Math.floor(lineTone(bg, FACE_MESH_STYLE.outline)) - 1)
        expect(min).toBeLessThan(bg)
      }
    }
    // The bright side's lines are lighter than the dark side's: the tone follows the picture.
    for (let i = 2; i < darkest.length; i++) expect(darkest[i]!).toBeGreaterThanOrEqual(darkest[i - 1]! - 1)
    expect(darkest[7]!).toBeGreaterThan(darkest[2]! + 40)
  })

  it("fully covered pixels are exactly the layer's tone of the pixel under them", async () => {
    const rgb = frame(GW, GH, () => [180, 180, 180])
    const out = await compositeFaceMesh(rgb, GW, GH, faceOnGradient())
    const values = new Set<number>()
    for (let i = 0; i < GW * GH; i++) values.add(out[3 * i]!)
    expect(values.has(Math.round(lineTone(180, FACE_MESH_STYLE.outline)))).toBe(true) // 63
    expect(values.has(Math.round(lineTone(180, FACE_MESH_STYLE.mesh)))).toBe(true) // 108
    expect(Math.min(...values)).toBe(Math.round(lineTone(180, FACE_MESH_STYLE.outline)))
  })

  it("on a blurred skin tone, a fully covered line is a neutral gray darker than the skin", async () => {
    const skin: [number, number, number] = [196, 150, 126]
    const rgb = frame(GW, GH, () => skin)
    const out = await compositeFaceMesh(rgb, GW, GH, faceOnGradient())
    const l = lumaOf(...skin)
    const core = Math.round(lineTone(Math.round(l), FACE_MESH_STYLE.outline))
    let neutral = 0
    for (let i = 0; i < GW * GH; i++) {
      const r = out[3 * i]!, g = out[3 * i + 1]!, b = out[3 * i + 2]!
      if (r === core && g === core && b === core) neutral++
      // Every pixel lies between the skin and a gray: still warm, or neutral — never blue or green.
      expect(b).toBeLessThanOrEqual(r)
      expect(g).toBeLessThanOrEqual(r)
    }
    expect(neutral).toBeGreaterThan(50)
  })

  it("on near black the lines lighten, so they still read", async () => {
    const rgb = frame(GW, GH, () => [4, 4, 4])
    const out = await compositeFaceMesh(rgb, GW, GH, faceOnGradient())
    let max = 0
    for (let i = 0; i < GW * GH * 3; i++) max = Math.max(max, out[i]!)
    expect(max).toBe(Math.round(lineTone(4, FACE_MESH_STYLE.outline))) // 44
  })

  it("refuses a frame of the wrong size", async () => {
    const o = faceMeshOverlay([face(0.3, 0.2, 0.4, 0.6)], W, H)!
    await expect(compositeFaceMesh(Buffer.alloc(10), W, H, o)).rejects.toThrow(/bytes/)
  })
})

describe("compositeFaceMesh on a coloured depth map", () => {
  const GW = 400
  const GH = 200
  const gOf = (x: number) => Math.round((x / (GW - 1)) * 255)
  /** The gray depth render: a horizontal gradient, far (black) to near (white). */
  const grayDepth = () => frame(GW, GH, (x) => [gOf(x), gOf(x), gOf(x)])
  /** The same depth in `table`'s colours, as the provider renders it. */
  const mapped = (table: Uint8Array) => frame(GW, GH, (x) => [table[3 * gOf(x)]!, table[3 * gOf(x) + 1]!, table[3 * gOf(x) + 2]!])
  const overlay = () => faceMeshOverlay([face(0.02, 0.05, 0.96, 0.9)], GW, GH)!
  /** The squared distance from a colour to the nearest colour of the map (between two neighbouring entries). */
  function offMap(table: Uint8Array, r: number, g: number, b: number): number {
    let best = Infinity
    for (let i = 0; i < 255; i++) {
      for (let f = 0; f <= 1; f += 0.125) {
        const c = [0, 1, 2].map((k) => table[3 * i + k]! + (table[3 * (i + 1) + k]! - table[3 * i + k]!) * f)
        best = Math.min(best, (c[0]! - r) ** 2 + (c[1]! - g) ** 2 + (c[2]! - b) ** 2)
      }
    }
    return best
  }

  for (const colormap of ["turbo", "inferno"] as const) {
    it(`${colormap}: a fully covered line pixel is the map at the line's tone of the depth under it, and nothing leaves the map`, async () => {
      const table = depthColormapTable(colormap)
      const rgb = mapped(table)
      const depth = { rgb: grayDepth(), width: GW, height: GH, table }
      const out = await compositeFaceMesh(rgb, GW, GH, overlay(), depth)
      let outlines = 0
      let meshes = 0
      let drawn = 0
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) {
          const i = (y * GW + x) * 3
          const r = out[i]!, g = out[i + 1]!, b = out[i + 2]!
          if (r === rgb[i] && g === rgb[i + 1] && b === rgb[i + 2]) continue
          drawn++
          // Every drawn pixel, its anti-aliased edges included, is a colour of the map (± rounding).
          expect(offMap(table, r, g, b)).toBeLessThanOrEqual(3)
          const d = gOf(x)
          const is = (tone: number) => [0, 1, 2].every((k) => Math.abs(out[i + k]! - table[3 * Math.round(tone) + k]!) <= 3)
          if (d >= FACE_MESH_STYLE.darkenAt && is(lineTone(d, FACE_MESH_STYLE.outline))) outlines++
          if (d >= FACE_MESH_STYLE.darkenAt && is(lineTone(d, FACE_MESH_STYLE.mesh))) meshes++
        }
      }
      expect(drawn).toBeGreaterThan(1000)
      expect(outlines).toBeGreaterThan(20)
      expect(meshes).toBeGreaterThan(100)
    }, 30_000)
  }

  it("the depth is read where the line is, at its own size", async () => {
    const table = depthColormapTable("turbo")
    const rgb = mapped(table)
    // The same depth at full size (in blocks of 2 × 2) and at half size: the same lines.
    const blocky = frame(GW, GH, (x) => {
      const v = gOf(2 * Math.floor(x / 2))
      return [v, v, v]
    })
    const half = frame(GW / 2, GH / 2, (x) => {
      const v = gOf(2 * x)
      return [v, v, v]
    })
    const full = await compositeFaceMesh(rgb, GW, GH, overlay(), { rgb: blocky, width: GW, height: GH, table })
    const small = await compositeFaceMesh(rgb, GW, GH, overlay(), { rgb: half, width: GW / 2, height: GH / 2, table })
    expect(small.equals(full)).toBe(true)
    expect(full.equals(rgb)).toBe(false)
  })

  it("grayscale with the depth render draws exactly what the gray tones draw on the gray depth clip", async () => {
    const rgb = grayDepth()
    const withDepth = await compositeFaceMesh(rgb, GW, GH, overlay(), { rgb: grayDepth(), width: GW, height: GH, table: depthColormapTable("grayscale") })
    const gray = await compositeFaceMesh(rgb, GW, GH, overlay())
    let diff = 0
    for (let i = 0; i < GW * GH * 3; i++) diff = Math.max(diff, Math.abs(withDepth[i]! - gray[i]!))
    expect(diff).toBeLessThanOrEqual(1)
  })

  it("refuses a depth frame of the wrong size", async () => {
    const table = depthColormapTable("turbo")
    await expect(compositeFaceMesh(grayDepth(), GW, GH, overlay(), { rgb: Buffer.alloc(9), width: GW, height: GH, table })).rejects.toThrow(/depth/)
  })
})
