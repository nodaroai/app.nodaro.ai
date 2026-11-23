/**
 * The Precise setting's face grow: its own row (`nodaro_motion_face_grow`,
 * nodaro-motion-face-grow-setting.ts), never a key of the masking row, merged
 * in only where an engine is answered (`withFaceGrowMerged`), sent only where
 * it grows (`faceGrowSent`, `withFaceGrowFor`). And a masking row written by
 * a newer build stays readable here: an unknown key is stripped with a
 * warning, never the whole entry dropped (`parseByEngine`).
 */
import { describe, expect, it } from "vitest"
import { faceGrowSent, faceMaskingSchema, withFaceGrowFor, type FaceMasking } from "../cast-swap-face-masking.js"
import { parseNodaroMotionMasking } from "../nodaro-motion-masking.js"
import { nodaroMotionFaceGrowSchema, parseNodaroMotionFaceGrow, withFaceGrowMerged, withoutDefaultFaceGrow } from "../nodaro-motion-face-grow-setting.js"

const face: FaceMasking = { mode: "always", target: "face", fill: "blur", growPct: 18 }

describe("the face grow's own row", () => {
  it("takes 0–40 in whole steps per engine, strict; 0 is never stored", () => {
    expect(nodaroMotionFaceGrowSchema.safeParse({ "nodaro-prism": 18, "nodaro-pulse": 0 }).success).toBe(true)
    for (const v of [-1, 41, 7.5, "18"]) expect(nodaroMotionFaceGrowSchema.safeParse({ "nodaro-prism": v }).success, String(v)).toBe(false)
    expect(nodaroMotionFaceGrowSchema.safeParse({ "nodaro-x": 5 }).success).toBe(false)
    expect(withoutDefaultFaceGrow({ "nodaro-prism": 18, "nodaro-pulse": 0 })).toEqual({ "nodaro-prism": 18 })
  })

  it("reads tolerantly: earlier engine keys as the current ones, an invalid entry dropped with a warning, never saved as null", () => {
    const warns: string[] = []
    expect(parseNodaroMotionFaceGrow({ "motion-pro": 12, "nodaro-pulse": 99 }, (w) => warns.push(w))).toEqual({ "nodaro-prism": 12 })
    expect(warns).toHaveLength(1)
    expect(parseNodaroMotionFaceGrow(null)).toBeNull()
  })

  it("is merged into each engine's masking as growPct only where both exist; a stale growPct is replaced; inputs unchanged", () => {
    const masking = { "nodaro-prism": { mode: "always" as const, target: "face" as const }, "nodaro-pulse": { mode: "auto" as const, growPct: 9 } }
    const merged = withFaceGrowMerged(masking, { "nodaro-prism": 18 })
    expect(merged).toEqual({ "nodaro-prism": { mode: "always", target: "face", growPct: 18 }, "nodaro-pulse": { mode: "auto" } })
    expect(masking["nodaro-prism"]).not.toHaveProperty("growPct")
    expect(withFaceGrowMerged(masking, null)["nodaro-prism"]).toEqual({ mode: "always", target: "face" })
  })
})

describe("the masking row never carries it, and an older reader keeps the entry", () => {
  it("the Precise masking schema refuses growPct (it is never stored there)", () => {
    expect(faceMaskingSchema.safeParse(face).success).toBe(false)
    const { growPct: _g, ...stored } = face
    expect(faceMaskingSchema.safeParse(stored).success).toBe(true)
  })

  it("a row written by a newer build (a key this build does not know) keeps the engine's entry, the key stripped with a warning", () => {
    const warns: string[] = []
    const read = parseNodaroMotionMasking({ "nodaro-prism": { mode: "always", target: "face", someFutureKey: 3, zone: { leftPct: 5, alsoNew: true } } }, (w) => warns.push(w))
    expect(read).toEqual({ "nodaro-prism": { mode: "always", target: "face", zone: { leftPct: 5 } } })
    expect(warns.join(" ")).toMatch(/someFutureKey/)
    expect(warns.join(" ")).toMatch(/zone\.alsoNew/)
  })

  it("any other invalid value still drops the entry (only unknown keys are read past)", () => {
    const warns: string[] = []
    expect(parseNodaroMotionMasking({ "nodaro-prism": { mode: "sometimes", extra: 1 } }, (w) => warns.push(w))).toEqual({})
  })
})

describe("faceGrowSent / withFaceGrowFor", () => {
  it("is the grow on a face target with a blur (default) or depth fill, above 0", () => {
    expect(faceGrowSent(face)).toBe(18)
    expect(faceGrowSent({ mode: "auto", target: "face", growPct: 5 })).toBe(5)
    expect(faceGrowSent({ ...face, fill: "depth" })).toBe(18)
  })

  it("is undefined wherever it would change nothing: off, 0, a head or body target, the fill none, no key", () => {
    expect(faceGrowSent({ ...face, mode: "off" })).toBeUndefined()
    expect(faceGrowSent({ ...face, growPct: 0 })).toBeUndefined()
    expect(faceGrowSent({ ...face, target: "head" })).toBeUndefined()
    expect(faceGrowSent({ ...face, target: undefined })).toBeUndefined()
    expect(faceGrowSent({ ...face, target: "body" })).toBeUndefined()
    expect(faceGrowSent({ ...face, fill: "none" })).toBeUndefined()
    expect(faceGrowSent({ mode: "always", target: "face" })).toBeUndefined()
    expect(faceGrowSent(undefined)).toBeUndefined()
  })

  it("keeps the key only where it grows and only for an engine that declares castSwap.faceGrow; a new object", () => {
    const sent = withFaceGrowFor(face, { faceGrow: true })
    expect(sent).toEqual(face)
    expect(sent).not.toBe(face)
    expect(withFaceGrowFor(face, {})).toEqual({ mode: "always", target: "face", fill: "blur" })
    expect(withFaceGrowFor({ ...face, target: "head" }, { faceGrow: true })).toEqual({ mode: "always", target: "head", fill: "blur" })
    const m: FaceMasking = { mode: "always", target: "face" }
    expect(JSON.stringify(withFaceGrowFor(m, { faceGrow: true }))).toBe(JSON.stringify(m))
  })
})
