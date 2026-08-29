import { describe, expect, it } from "vitest"
import { collageLayoutBody, imageCollageBody } from "../image-collage.js"

const base = {
  imageUrls: ["https://media.nodaro.ai/a.png", "https://media.nodaro.ai/b.png"],
}

describe("imageCollageBody attach fields", () => {
  it("accepts a full boards attach request", () => {
    const parsed = imageCollageBody.safeParse({
      ...base,
      attachToCharacterId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      attachToColumn: "boards",
      attachName: "Evening gown",
      attachBoardType: "identity",
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.attachToColumn).toBe("boards")
      expect(parsed.data.attachBoardType).toBe("identity")
    }
  })

  it("still accepts a plain collage request (all attach fields optional)", () => {
    expect(imageCollageBody.safeParse(base).success).toBe(true)
  })

  it("rejects a non-boards attach column", () => {
    expect(
      imageCollageBody.safeParse({ ...base, attachToColumn: "expressions" }).success,
    ).toBe(false)
  })

  it("rejects a non-uuid attach id", () => {
    expect(
      imageCollageBody.safeParse({ ...base, attachToCharacterId: "nope" }).success,
    ).toBe(false)
  })
})

describe("imageCollageBody imageSizes (per-image size hints)", () => {
  it("accepts hints 0–3 aligned with imageUrls", () => {
    const parsed = imageCollageBody.safeParse({ ...base, imageSizes: [1, 3] })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.imageSizes).toEqual([1, 3])
  })

  it("accepts a shorter-than-urls array (missing entries are auto)", () => {
    expect(imageCollageBody.safeParse({ ...base, imageSizes: [2] }).success).toBe(true)
  })

  it("is optional", () => {
    const parsed = imageCollageBody.safeParse(base)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.imageSizes).toBeUndefined()
  })

  it("rejects out-of-range and non-integer hints", () => {
    expect(imageCollageBody.safeParse({ ...base, imageSizes: [4, 0] }).success).toBe(false)
    expect(imageCollageBody.safeParse({ ...base, imageSizes: [-1] }).success).toBe(false)
    expect(imageCollageBody.safeParse({ ...base, imageSizes: [1.5] }).success).toBe(false)
    expect(imageCollageBody.safeParse({ ...base, imageSizes: ["big"] }).success).toBe(false)
  })

  it("rejects more than 30 hints", () => {
    expect(
      imageCollageBody.safeParse({ ...base, imageSizes: new Array(31).fill(0) }).success,
    ).toBe(false)
  })
})

describe("imageCollageBody numbered + imageLabels (storyboard badges)", () => {
  it("accepts a boolean numbered", () => {
    const on = imageCollageBody.safeParse({ ...base, numbered: true })
    expect(on.success).toBe(true)
    if (on.success) expect(on.data.numbered).toBe(true)
    expect(imageCollageBody.safeParse({ ...base, numbered: false }).success).toBe(true)
  })

  it("leaves numbered ABSENT (undefined) when omitted — no default", () => {
    const parsed = imageCollageBody.safeParse(base)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.numbered).toBeUndefined()
  })

  it("rejects a non-boolean numbered", () => {
    expect(imageCollageBody.safeParse({ ...base, numbered: "yes" }).success).toBe(false)
    expect(imageCollageBody.safeParse({ ...base, numbered: 1 }).success).toBe(false)
  })

  it("accepts imageLabels of strings and nulls", () => {
    const parsed = imageCollageBody.safeParse({ ...base, imageLabels: ["Wide", null] })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.imageLabels).toEqual(["Wide", null])
  })

  it("is optional (undefined when omitted)", () => {
    const parsed = imageCollageBody.safeParse(base)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.imageLabels).toBeUndefined()
  })

  it("rejects a label longer than 80 chars, accepts exactly 80", () => {
    expect(
      imageCollageBody.safeParse({ ...base, imageLabels: ["x".repeat(81)] }).success,
    ).toBe(false)
    expect(
      imageCollageBody.safeParse({ ...base, imageLabels: ["x".repeat(80)] }).success,
    ).toBe(true)
  })

  it("rejects more than 30 labels", () => {
    expect(
      imageCollageBody.safeParse({ ...base, imageLabels: new Array(31).fill("a") }).success,
    ).toBe(false)
  })

  it("rejects non-string, non-null label entries", () => {
    expect(imageCollageBody.safeParse({ ...base, imageLabels: [42] }).success).toBe(false)
    expect(imageCollageBody.safeParse({ ...base, imageLabels: [{}] }).success).toBe(false)
  })
})

describe("collageLayoutBody — the free preview", () => {
  const dims = [{ w: 1200, h: 800 }, { w: 800, h: 1200 }]

  it("requires the resolution, unlike its sibling", () => {
    // The renderer defaults 2K, this route's family defaults 4K. A preview
    // built against the wrong canvas is exact for a picture nobody gets, so
    // the caller has to say which one rather than inherit a trap.
    expect(collageLayoutBody.safeParse({ dims }).success).toBe(false)
    expect(collageLayoutBody.safeParse({ dims, resolution: "2K" }).success).toBe(true)
  })

  it("needs two images, because below that there is no collage", () => {
    // And because `computeCollageLayout` throws on an empty array — a 500
    // where this should be a 400.
    expect(collageLayoutBody.safeParse({ dims: [dims[0]], resolution: "2K" }).success).toBe(false)
    expect(collageLayoutBody.safeParse({ dims: [], resolution: "2K" }).success).toBe(false)
  })

  it("bounds the dimensions rather than trusting the body", () => {
    const bad = [
      [{ w: 0, h: 100 }, { w: 100, h: 100 }],
      [{ w: -5, h: 100 }, { w: 100, h: 100 }],
      [{ w: 1.5, h: 100 }, { w: 100, h: 100 }],
      [{ w: 999999, h: 100 }, { w: 100, h: 100 }],
    ]
    for (const d of bad) expect(collageLayoutBody.safeParse({ dims: d, resolution: "2K" }).success).toBe(false)
    expect(collageLayoutBody.safeParse({ dims: Array.from({ length: 31 }, () => dims[0]), resolution: "2K" }).success).toBe(false)
  })

  it("takes the same size-hint range the renderer does", () => {
    expect(collageLayoutBody.safeParse({ dims, resolution: "2K", imageSizes: [1, 3] }).success).toBe(true)
    expect(collageLayoutBody.safeParse({ dims, resolution: "2K", imageSizes: [4] }).success).toBe(false)
    expect(collageLayoutBody.safeParse({ dims, resolution: "2K", imageSizes: [-1] }).success).toBe(false)
  })

  it("carries NO imageUrls — it is handed dimensions, not pictures", () => {
    const parsed = collageLayoutBody.safeParse({ dims, resolution: "2K", imageUrls: ["https://x/a.png"] })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).not.toHaveProperty("imageUrls")
  })
})
