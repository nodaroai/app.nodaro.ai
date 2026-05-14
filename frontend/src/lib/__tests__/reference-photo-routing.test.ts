import { describe, it, expect } from "vitest"
import { routePhotosForAsset, type ReferencePhoto } from "../reference-photo-routing"

const photos: ReferencePhoto[] = [
  { url: "a.png", kind: "frontFace" },
  { url: "b.png", kind: "frontBody" },
  { url: "c.png", kind: "other" },
]

describe("routePhotosForAsset", () => {
  it("portrait returns ALL photos", () => {
    expect(routePhotosForAsset("portrait", photos).map((p) => p.url)).toEqual(["a.png", "b.png", "c.png"])
  })

  it("expressions returns only kind=frontFace", () => {
    expect(routePhotosForAsset("expressions", photos).map((p) => p.url)).toEqual(["a.png"])
  })

  it("expressions falls back to ALL when no kind=frontFace exists", () => {
    const noFront = photos.filter((p) => p.kind !== "frontFace")
    expect(routePhotosForAsset("expressions", noFront).map((p) => p.url)).toEqual(["b.png", "c.png"])
  })

  it("poses returns only kind=frontBody", () => {
    expect(routePhotosForAsset("poses", photos).map((p) => p.url)).toEqual(["b.png"])
  })

  it("motions has the same heuristic as poses", () => {
    expect(routePhotosForAsset("motions", photos)).toEqual(routePhotosForAsset("poses", photos))
  })

  it("returns empty array on empty input", () => {
    expect(routePhotosForAsset("portrait", [])).toEqual([])
  })

  it("headAngles prefers frontFace + side/3-quarter refs over `other`", () => {
    const mix: ReferencePhoto[] = [
      { url: "ff.png", kind: "frontFace" },
      { url: "sl.png", kind: "sideLeft" },
      { url: "o.png", kind: "other" },
    ]
    expect(routePhotosForAsset("headAngles", mix).map((p) => p.url)).toEqual(["ff.png", "sl.png"])
  })

  it("bodyAngles prefers frontBody over everything else", () => {
    const mix: ReferencePhoto[] = [
      { url: "ff.png", kind: "frontFace" },
      { url: "fb.png", kind: "frontBody" },
      { url: "o.png", kind: "other" },
    ]
    expect(routePhotosForAsset("bodyAngles", mix).map((p) => p.url)).toEqual(["fb.png"])
  })

  it("angles (legacy alias) routes the same as headAngles", () => {
    expect(routePhotosForAsset("angles", photos)).toEqual(routePhotosForAsset("headAngles", photos))
  })
})
