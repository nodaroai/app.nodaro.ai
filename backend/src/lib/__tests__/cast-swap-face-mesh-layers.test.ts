import { describe, expect, it } from "vitest"
import {
  engineDrawsFaceMeshLayers,
  faceMeshLayersSent,
  faceMeshPartsOfLayers,
  withCanonicalFaceMeshLayers,
  withFaceMeshLayersFor,
} from "../cast-swap-face-mesh-layers.js"
import { faceMaskingMotionSchema, faceMaskingSchema, type FaceMasking } from "../cast-swap-face-masking.js"

const ON: FaceMasking = { mode: "always", source: "full-depth", faceMesh: true }
const PARTS = ["full", "features", "mouth"] as const

describe("faceMeshPartsOfLayers", () => {
  it("names the masking's parts values only (the contours are the routed setting's)", () => {
    expect(faceMeshPartsOfLayers({ wireframe: true, eyes: true, lips: true })).toBe("full")
    expect(faceMeshPartsOfLayers({ eyes: true, lips: true })).toBe("features")
    expect(faceMeshPartsOfLayers({ lips: true })).toBe("mouth")
    expect(faceMeshPartsOfLayers({ eyes: true, lips: true, contours: true })).toBeUndefined()
    expect(faceMeshPartsOfLayers(undefined)).toBeUndefined()
  })
})

describe("faceMeshLayersSent", () => {
  it("only with the mesh on, a set that draws, and one no parts value names", () => {
    expect(faceMeshLayersSent({ ...ON, faceMeshLayers: { irises: true, eyes: false } })).toEqual({ irises: true })
    expect(faceMeshLayersSent({ ...ON, faceMeshLayers: { eyes: true, lips: true } })).toBeUndefined()
    expect(faceMeshLayersSent({ ...ON, faceMeshLayers: { bold: true } })).toBeUndefined()
    expect(faceMeshLayersSent({ mode: "always", source: "full-depth", faceMeshLayers: { irises: true } })).toBeUndefined()
    expect(faceMeshLayersSent(undefined)).toBeUndefined()
  })
})

describe("withCanonicalFaceMeshLayers", () => {
  it("saves a parts value's set as the value (the full mesh as neither key), any other with its layers on alone", () => {
    expect(withCanonicalFaceMeshLayers({ ...ON, faceMeshLayers: { wireframe: true, eyes: true, lips: true } })).toEqual(ON)
    expect(withCanonicalFaceMeshLayers({ ...ON, faceMeshLayers: { lips: true, bold: false } })).toEqual({ ...ON, faceMeshParts: "mouth" })
    expect(withCanonicalFaceMeshLayers({ ...ON, faceMeshLayers: { contours: true, irises: true, eyes: false } })).toEqual({ ...ON, faceMeshLayers: { contours: true, irises: true } })
    const same = { ...ON, faceMeshParts: "features" as const }
    expect(withCanonicalFaceMeshLayers(same)).toBe(same)
  })

  it("never changes what it is given", () => {
    const given: FaceMasking = { ...ON, faceMeshLayers: { eyes: true, lips: true } }
    withCanonicalFaceMeshLayers(given)
    expect(given).toEqual({ ...ON, faceMeshLayers: { eyes: true, lips: true } })
  })
})

describe("withFaceMeshLayersFor", () => {
  const LAYERED = { faceMeshParts: [...PARTS], faceMeshLayers: true }
  it("sends layers only to an engine that declares them", () => {
    expect(engineDrawsFaceMeshLayers(LAYERED)).toBe(true)
    const partsOnly: { faceMeshLayers?: boolean; faceMeshParts: string[] } = { faceMeshParts: [...PARTS] }
    expect(engineDrawsFaceMeshLayers(partsOnly)).toBe(false)
    const m = { ...ON, faceMeshLayers: { wireframe: true, contours: true } }
    expect(withFaceMeshLayersFor(m, LAYERED)).toEqual(m)
    expect(withFaceMeshLayersFor(m, { faceMeshParts: [...PARTS] })).toEqual(ON)
    expect(withFaceMeshLayersFor(m, undefined)).toEqual(ON)
  })

  it("a parts value's set goes as that value, where the engine draws it", () => {
    const m = { ...ON, faceMeshLayers: { eyes: true, lips: true } }
    expect(withFaceMeshLayersFor(m, LAYERED)).toEqual({ ...ON, faceMeshParts: "features" })
    expect(withFaceMeshLayersFor(m, { faceMeshParts: ["full"] })).toEqual(ON)
    expect(withFaceMeshLayersFor({ ...ON, faceMeshLayers: { wireframe: true, eyes: true, lips: true } }, LAYERED)).toEqual(ON)
  })

  it("a setting without layers comes back as it was", () => {
    expect(withFaceMeshLayersFor({ ...ON, faceMeshParts: "mouth" }, LAYERED)).toEqual({ ...ON, faceMeshParts: "mouth" })
  })
})

describe("the schemas", () => {
  it("the Motion masking takes layers; the Precise masking (faces hidden) does not", () => {
    expect(faceMaskingMotionSchema.safeParse({ ...ON, faceMeshLayers: { irises: true } }).success).toBe(true)
    expect(faceMaskingSchema.safeParse({ mode: "always", faceMesh: true, faceMeshLayers: { irises: true } }).success).toBe(false)
  })

  it("never beside parts, never a set that draws nothing, never an unknown layer", () => {
    for (const bad of [
      { ...ON, faceMeshParts: "mouth", faceMeshLayers: { eyes: true } },
      { ...ON, faceMeshLayers: { bold: true } },
      { ...ON, faceMeshLayers: { nose: true } },
    ]) expect(faceMaskingMotionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
  })
})
