import { describe, it, expect } from "vitest"
import { routePhotosForAsset, type ReferencePhoto } from "../reference-photo-routing"

const photos: ReferencePhoto[] = [
  { url: "a.png", kind: "front" },
  { url: "b.png", kind: "fullBody" },
  { url: "c.png", kind: "other" },
]

describe("routePhotosForAsset", () => {
  it("portrait returns ALL photos", () => {
    expect(routePhotosForAsset("portrait", photos).map((p) => p.url)).toEqual(["a.png", "b.png", "c.png"])
  })

  it("expressions returns only kind=front", () => {
    expect(routePhotosForAsset("expressions", photos).map((p) => p.url)).toEqual(["a.png"])
  })

  it("expressions falls back to ALL when no kind=front exists", () => {
    const noFront = photos.filter((p) => p.kind !== "front")
    expect(routePhotosForAsset("expressions", noFront).map((p) => p.url)).toEqual(["b.png", "c.png"])
  })

  it("poses returns only kind=fullBody", () => {
    expect(routePhotosForAsset("poses", photos).map((p) => p.url)).toEqual(["b.png"])
  })

  it("motions has the same heuristic as poses", () => {
    expect(routePhotosForAsset("motions", photos)).toEqual(routePhotosForAsset("poses", photos))
  })

  it("returns empty array on empty input", () => {
    expect(routePhotosForAsset("portrait", [])).toEqual([])
  })
})
