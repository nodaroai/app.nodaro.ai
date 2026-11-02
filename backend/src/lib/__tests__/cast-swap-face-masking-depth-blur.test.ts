import { describe, expect, it } from "vitest"
import {
  depthBlurSent,
  engineBlursDepth,
  engineDrawsFaceMeshParts,
  faceMaskingMotionSchema,
  faceMaskingSchema,
  faceMaskingSent,
  faceMaskingWithMarksSchema,
  faceMeshPartsSent,
  withDepthBlurFor,
  withFaceMeshPartsFor,
  type FaceMasking,
} from "../cast-swap-face-masking.js"

// Nodaro Motion's Motion setting (decided 2026-11-02): a full depth's depth blur and what the face mesh draws — the
// Motion setting's keys alone, normalised so that 0 and the full mesh are no key, and sent only to an engine that
// declares them.

const FD: FaceMasking = { mode: "always", source: "full-depth" }

describe("the schemas", () => {
  it("the Motion setting takes depthBlur (whole, 0–40) and faceMeshParts", () => {
    expect(faceMaskingMotionSchema.parse({ ...FD, depthBlur: 28 })).toEqual({ ...FD, depthBlur: 28 })
    expect(faceMaskingMotionSchema.parse({ ...FD, depthBlur: 0 })).toEqual({ ...FD, depthBlur: 0 })
    expect(faceMaskingMotionSchema.parse({ ...FD, depthBlur: 40 }).depthBlur).toBe(40)
    for (const depthBlur of [41, -1, 28.5, "28"]) expect(faceMaskingMotionSchema.safeParse({ ...FD, depthBlur }).success, String(depthBlur)).toBe(false)
    for (const faceMeshParts of ["full", "features", "mouth"]) expect(faceMaskingMotionSchema.parse({ ...FD, faceMesh: true, faceMeshParts }).faceMeshParts).toBe(faceMeshParts)
    expect(faceMaskingMotionSchema.safeParse({ ...FD, faceMesh: true, faceMeshParts: "eyes" }).success).toBe(false)
    // Never defaulted: a setting without them parses as it did.
    expect(faceMaskingMotionSchema.parse(FD)).toEqual(FD)
  })

  it("the Precise setting and a trend's refuse both keys (strict): they are the Motion setting's alone", () => {
    expect(faceMaskingSchema.safeParse({ mode: "always", faceMesh: true, faceMeshParts: "mouth" }).success).toBe(false)
    expect(faceMaskingSchema.safeParse({ mode: "always", depthBlur: 10 }).success).toBe(false)
    expect(faceMaskingWithMarksSchema.safeParse({ ...FD, depthBlur: 10 }).success).toBe(false)
    expect(faceMaskingWithMarksSchema.safeParse({ ...FD, faceMesh: true, faceMeshParts: "features" }).success).toBe(false)
  })
})

describe("the normalisers", () => {
  it("depthBlurSent: above 0, on, full depth only", () => {
    expect(depthBlurSent({ ...FD, depthBlur: 28 })).toBe(28)
    expect(depthBlurSent({ ...FD, depthBlur: 0 })).toBeUndefined()
    expect(depthBlurSent(FD)).toBeUndefined()
    expect(depthBlurSent({ mode: "always", depthBlur: 28 })).toBeUndefined()
    expect(depthBlurSent({ ...FD, mode: "off", depthBlur: 28 })).toBeUndefined()
    expect(depthBlurSent(undefined)).toBeUndefined()
  })

  it("faceMeshPartsSent: the parts with the mesh on, never the full mesh, never keep people", () => {
    expect(faceMeshPartsSent({ ...FD, faceMesh: true, faceMeshParts: "features" })).toBe("features")
    expect(faceMeshPartsSent({ faceMesh: true, faceMeshParts: "mouth" })).toBe("mouth")
    expect(faceMeshPartsSent({ ...FD, faceMesh: true, faceMeshParts: "full" })).toBeUndefined()
    expect(faceMeshPartsSent({ ...FD, faceMeshParts: "mouth" })).toBeUndefined()
    expect(faceMeshPartsSent({ source: "keep-people", faceMesh: true, faceMeshParts: "mouth" })).toBeUndefined()
  })

  it("an engine's declarations: a blur, and each part it lists", () => {
    expect(engineBlursDepth({ depthBlur: true })).toBe(true)
    expect(engineBlursDepth({})).toBe(false)
    expect(engineBlursDepth(undefined)).toBe(false)
    expect(engineDrawsFaceMeshParts({ faceMeshParts: ["full", "features", "mouth"] }, "mouth")).toBe(true)
    expect(engineDrawsFaceMeshParts({ faceMeshParts: ["full", "features"] }, "mouth")).toBe(false)
    expect(engineDrawsFaceMeshParts(undefined, "features")).toBe(false)
  })

  it("as an engine is sent them: the key only where it changes what is drawn AND the engine declares it; else the setting of before", () => {
    const m: FaceMasking = { ...FD, faceMesh: true, depthBlur: 28, faceMeshParts: "features" }
    const all = { depthBlur: true, faceMeshParts: ["full", "features", "mouth"] as const }
    expect(withFaceMeshPartsFor(withDepthBlurFor(m, all), all)).toEqual(m)
    expect(withFaceMeshPartsFor(withDepthBlurFor(m, {}), {})).toEqual({ ...FD, faceMesh: true })
    expect(withDepthBlurFor({ ...FD, depthBlur: 0 }, all)).toEqual(FD)
    expect(withFaceMeshPartsFor({ ...FD, faceMesh: true, faceMeshParts: "full" }, all)).toEqual({ ...FD, faceMesh: true })
    // The input is not changed.
    expect(m).toEqual({ ...FD, faceMesh: true, depthBlur: 28, faceMeshParts: "features" })
  })

  it("a trend's setting is sent as before: faceMaskingSent names neither key for full depth", () => {
    expect(faceMaskingSent({ ...FD, faceMesh: true })).toEqual({ ...FD, faceMesh: true })
  })
})
