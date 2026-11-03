import { describe, expect, it } from "vitest"
import {
  FILL_NONE_NEEDS_FACE_MESH,
  depthBlurKindOf,
  depthBlurSent,
  depthColormapSent,
  depthModelSizeSent,
  engineBlursDepthFill,
  engineDrawsFillNone,
  faceMaskingMotionSchema,
  faceMaskingSchema,
  faceMaskingWithMarksSchema,
  fillNoneOn,
  withDepthBlurFor,
  withDepthModelSizeFor,
  withFillNoneFor,
  withResolvedZone,
  type FaceMasking,
} from "../cast-swap-face-masking.js"

// The Nodaro Motion settings (decided 2026-11-02): a third Faces hidden fill, "none" (the faces found but kept as
// filmed, only the face mesh drawn on them), and the depth blur on a Faces hidden depth fill. A trend's setting takes
// neither; every setting without them validates and is sent exactly as before.

const NONE: FaceMasking = { mode: "always", fill: "none", faceMesh: true }
const FILL: FaceMasking = { mode: "always", fill: "depth" }
const FD: FaceMasking = { mode: "always", source: "full-depth" }

describe("the schemas", () => {
  it("Precise and Motion take the fill none with the face mesh on, any target and mode; a trend's refuses it", () => {
    for (const schema of [faceMaskingSchema, faceMaskingMotionSchema]) {
      expect(schema.parse(NONE)).toEqual(NONE)
      for (const target of ["face", "head", "body"]) expect(schema.safeParse({ ...NONE, target }).success, target).toBe(true)
      for (const mode of ["always", "auto", "off"]) expect(schema.safeParse({ ...NONE, mode }).success, mode).toBe(true)
      expect(schema.safeParse({ ...NONE, faceMesh: true, faceMeshParts: "mouth" }).success).toBe(true)
    }
    expect(faceMaskingWithMarksSchema.safeParse(NONE).success).toBe(false)
  })

  it("refuses the fill none without the face mesh (fill_none_needs_face_mesh)", () => {
    for (const schema of [faceMaskingSchema, faceMaskingMotionSchema]) {
      for (const m of [{ mode: "always", fill: "none" }, { mode: "always", fill: "none", faceMesh: false }]) {
        const r = schema.safeParse(m)
        expect(r.success, JSON.stringify(m)).toBe(false)
        expect(r.error!.issues.some((i) => (i as { params?: { code?: string } }).params?.code === FILL_NONE_NEEDS_FACE_MESH)).toBe(true)
      }
    }
    // A "none" left over from Faces hidden under Full depth is not read there: not refused.
    expect(faceMaskingMotionSchema.safeParse({ ...FD, fill: "none" }).success).toBe(true)
  })

  it("Precise takes the depth blur on the depth fill only; Motion on Full depth and the depth fill; a trend's on neither", () => {
    expect(faceMaskingSchema.parse({ ...FILL, depthBlur: 12 })).toEqual({ ...FILL, depthBlur: 12 })
    for (const fill of [undefined, "blur", "none"]) {
      expect(faceMaskingSchema.safeParse({ mode: "always", faceMesh: true, ...(fill ? { fill } : {}), depthBlur: 12 }).success, String(fill)).toBe(false)
    }
    for (const depthBlur of [41, -1, 1.5]) expect(faceMaskingSchema.safeParse({ ...FILL, depthBlur }).success, String(depthBlur)).toBe(false)
    expect(faceMaskingMotionSchema.parse({ ...FILL, depthBlur: 12 })).toEqual({ ...FILL, depthBlur: 12 })
    expect(faceMaskingWithMarksSchema.safeParse({ ...FILL, depthBlur: 12 }).success).toBe(false)
  })

  it("every setting without them parses exactly as before", () => {
    for (const m of [{ mode: "always" }, { mode: "auto", fill: "blur", faceMesh: true }, FILL, { mode: "off" }, { ...FILL, depthColormap: "inferno" }]) {
      expect(faceMaskingSchema.parse(m)).toEqual(m)
      expect(faceMaskingMotionSchema.parse(m)).toEqual(m)
    }
  })
})

describe("the normalisers", () => {
  it("depthBlurKindOf: Full depth, a Faces hidden depth fill, else none", () => {
    expect(depthBlurKindOf(FD)).toBe("full-depth")
    expect(depthBlurKindOf(FILL)).toBe("depth-fill")
    expect(depthBlurKindOf({})).toBeNull()
    expect(depthBlurKindOf({ fill: "blur" })).toBeNull()
    expect(depthBlurKindOf({ fill: "none" })).toBeNull()
    expect(depthBlurKindOf({ source: "keep-people", fill: "depth" })).toBeNull()
  })

  it("depthBlurSent: a depth fill's blur above 0 when on; never a blur fill's, a none fill's or an off setting's", () => {
    expect(depthBlurSent({ ...FILL, depthBlur: 12 })).toBe(12)
    expect(depthBlurSent({ ...FILL, depthBlur: 0 })).toBeUndefined()
    expect(depthBlurSent({ ...FILL, mode: "off", depthBlur: 12 })).toBeUndefined()
    expect(depthBlurSent({ mode: "always", fill: "blur", depthBlur: 12 })).toBeUndefined()
    expect(depthBlurSent({ ...NONE, depthBlur: 12 })).toBeUndefined()
    // Full depth as before.
    expect(depthBlurSent({ ...FD, depthBlur: 28 })).toBe(28)
  })

  it("the fill none draws no depth: no colormap, no depth model size (never sent nor hashed)", () => {
    expect(depthColormapSent({ ...NONE, depthColormap: "inferno" })).toBeUndefined()
    expect(depthModelSizeSent({ ...NONE, depthModelSize: "small" })).toBeUndefined()
    expect(withDepthModelSizeFor({ ...NONE, depthModelSize: "small" }, { depthModelSizes: ["small", "base", "large"] })).toEqual(NONE)
    expect(withResolvedZone({ ...NONE, depthModelSize: "base" })).not.toHaveProperty("depthModelSize")
    // A depth fill keeps it beside its blur.
    const depthFill: FaceMasking = { ...FILL, depthModelSize: "small", depthBlur: 12 }
    expect(depthModelSizeSent(depthFill)).toBe("small")
    expect(depthBlurSent(depthFill)).toBe(12)
    expect(fillNoneOn(NONE)).toBe(true)
    expect(fillNoneOn({ ...NONE, mode: "off" })).toBe(false)
    expect(fillNoneOn({ ...FD, fill: "none" })).toBe(false)
    expect(fillNoneOn(FILL)).toBe(false)
  })

  it("the declarations: each its own key", () => {
    expect(engineDrawsFillNone({ maskFillNone: true })).toBe(true)
    expect(engineDrawsFillNone({})).toBe(false)
    expect(engineDrawsFillNone(undefined)).toBe(false)
    expect(engineBlursDepthFill({ depthFillBlur: true })).toBe(true)
    const fullDepthOnly: { depthBlur: boolean; depthFillBlur?: boolean } = { depthBlur: true }
    expect(engineBlursDepthFill(fullDepthOnly)).toBe(false)
  })
})

describe("as an engine is sent them", () => {
  it("the depth blur: Full depth by castSwap.depthBlur, a depth fill by castSwap.depthFillBlur, never the other", () => {
    expect(withDepthBlurFor({ ...FILL, depthBlur: 12 }, { depthFillBlur: true })).toEqual({ ...FILL, depthBlur: 12 })
    expect(withDepthBlurFor({ ...FILL, depthBlur: 12 }, { depthBlur: true })).toEqual(FILL)
    expect(withDepthBlurFor({ ...FILL, depthBlur: 12 }, undefined)).toEqual(FILL)
    expect(withDepthBlurFor({ ...FD, depthBlur: 28 }, { depthFillBlur: true })).toEqual(FD)
    expect(withDepthBlurFor({ ...FD, depthBlur: 28 }, { depthBlur: true })).toEqual({ ...FD, depthBlur: 28 })
    // A blur fill's or a none fill's blur is never sent.
    expect(withDepthBlurFor({ mode: "always", fill: "blur", depthBlur: 12 }, { depthBlur: true, depthFillBlur: true })).toEqual({ mode: "always", fill: "blur" })
    expect(withDepthBlurFor({ ...NONE, depthBlur: 12 }, { depthBlur: true, depthFillBlur: true })).toEqual(NONE)
  })

  it("the fill none: as it is to an engine that draws it and the mesh; the whole entry off to any other, never a blur", () => {
    const m: FaceMasking = { ...NONE, target: "face", threshold: 0.4 }
    expect(withFillNoneFor(m, { maskFillNone: true }, true)).toEqual(m)
    expect(withFillNoneFor(m, {}, true)).toEqual({ mode: "off" })
    expect(withFillNoneFor(m, undefined, true)).toEqual({ mode: "off" })
    expect(withFillNoneFor(m, { maskFillNone: true }, false)).toEqual({ mode: "off" })
    // A "none" that is not read (off, Full depth) is dropped, the rest kept.
    expect(withFillNoneFor({ ...m, mode: "off" }, {}, true)).toEqual({ mode: "off", faceMesh: true, target: "face", threshold: 0.4 })
    expect(withFillNoneFor({ ...FD, fill: "none", faceMesh: true }, { maskFillNone: true }, true)).toEqual({ ...FD, faceMesh: true })
    // The input is not changed.
    expect(m).toEqual({ ...NONE, target: "face", threshold: 0.4 })
  })

  it("absent = before: a setting without the fill none is returned as it is, whatever the engine", () => {
    for (const s of [{ mode: "always" }, FILL, { mode: "auto", fill: "blur", faceMesh: true }, { ...FD, depthBlur: 28 }, { mode: "off" }] as FaceMasking[]) {
      for (const cs of [undefined, {}, { maskFillNone: true }]) expect(withFillNoneFor(s, cs, true)).toBe(s)
    }
  })
})
