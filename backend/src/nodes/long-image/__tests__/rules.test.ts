import { describe, it, expect } from "vitest"
import {
  longImageCreditId,
  longImageInputImages,
  longImageProblem,
  longImageRun,
  longImageRunCreditId,
  longImageSentProducts,
  longImageWiredCreditId,
  longImageWiredPictures,
} from "@nodaro/render-rules"

/**
 * Long Image's run rules (@nodaro/render-rules long-image.ts), the ones the
 * route, the workflow payload, the worker and the editor all read: a run keeps
 * only its mode's own fields, its product pictures keep their places, and it
 * is priced on the pictures it sends.
 */
const A = "https://r2/a.png"
const B = "https://r2/b.png"

describe("longImageRun", () => {
  it("a webpage design keeps its pictures and never a product field", () => {
    expect(longImageRun({ prompt: " p ", styleImageUrl: A, productImageUrls: [B], length: "long" })).toEqual({ mode: "webpage", resolution: "2K", prompt: "p", styleImageUrl: A })
  })

  it("a product page keeps its places and its length, and never a webpage field", () => {
    expect(longImageRun({ mode: "ecommerce", prompt: "p", resolution: "1k", length: "short", productImageUrls: [A, "", B, "https://r2/fourth.png"], subjectImageUrl: A }))
      .toEqual({ mode: "ecommerce", resolution: "1K", length: "short", prompt: "p", productImageUrls: [A, null, B] })
    // Empty places at the end are dropped; the numbering of the ones before them stands.
    expect(longImageRun({ mode: "ecommerce", prompt: "p", productImageUrls: [null, A, null, null] }).productImageUrls).toEqual([null, A])
  })

  it("settles junk to the defaults", () => {
    expect(longImageRun({ mode: "poster", resolution: "4K", prompt: 3 })).toEqual({ mode: "webpage", resolution: "2K", prompt: "" })
    expect(longImageRun(undefined)).toEqual({ mode: "webpage", resolution: "2K", prompt: "" })
    expect(longImageRun({ mode: "ecommerce", length: "huge" }).length).toBe("medium")
  })
})

describe("the pictures a run sends", () => {
  it("a product picture given twice is sent, and priced, once", () => {
    const run = longImageRun({ mode: "ecommerce", prompt: "p", productImageUrls: [A, null, A] })
    expect(longImageSentProducts(run)).toEqual([A])
    expect(longImageInputImages(run)).toBe(1)
    expect(longImageRunCreditId("long-image", run)).toBe("long-image:ecommerce:medium:2K:1ref")
  })

  it("a webpage design counts its style and subject pictures", () => {
    expect(longImageInputImages(longImageRun({ prompt: "p" }))).toBe(0)
    expect(longImageInputImages(longImageRun({ prompt: "p", subjectImageUrl: A }))).toBe(1)
    expect(longImageRunCreditId("long-image", longImageRun({ prompt: "p", resolution: "1K", styleImageUrl: A, subjectImageUrl: B }))).toBe("long-image:webpage:1K:2ref")
  })

  it("credit ids hold a count to the mode's range", () => {
    expect(longImageCreditId("long-image", "webpage", "2K", "medium", 0)).toBe("long-image:webpage:2K")
    expect(longImageCreditId("long-image", "webpage", "2K", "medium", 5)).toBe("long-image:webpage:2K:2ref")
    expect(longImageCreditId("long-image", "ecommerce", "1K", "long", 0)).toBe("long-image:ecommerce:long:1K:1ref")
    expect(longImageCreditId("long-image", "ecommerce", "1K", "long", 7)).toBe("long-image:ecommerce:long:1K:3ref")
  })
})

describe("longImageProblem", () => {
  it("a prompt, under 20,000 characters, and a product page's product picture", () => {
    expect(longImageProblem(longImageRun({ prompt: "p" }))).toBeUndefined()
    expect(longImageProblem(longImageRun({ prompt: "  " }))).toMatch(/needs a prompt/)
    expect(longImageProblem(longImageRun({ prompt: "x".repeat(20001) }))).toMatch(/up to 20,000 characters \(this one has 20,001\)/)
    expect(longImageProblem(longImageRun({ mode: "ecommerce", prompt: "p", productImageUrls: [null] }))).toMatch(/one to three product pictures/)
    expect(longImageProblem(longImageRun({ mode: "ecommerce", prompt: "p", productImageUrls: [null, A] }))).toBeUndefined()
  })
})

describe("longImageWiredPictures", () => {
  it("reads only the mode's own inputs, each picture by its input", () => {
    const lanes = { productImage1: A, productImage3: B, styleImage: A, subjectImage: B }
    expect(longImageWiredPictures(lanes, "ecommerce")).toEqual({ pictures: { productImageUrls: [A, null, B] } })
    expect(longImageWiredPictures(lanes, "webpage")).toEqual({ pictures: { styleImageUrl: A, subjectImageUrl: B } })
    expect(longImageWiredPictures(undefined, "webpage")).toEqual({ pictures: {} })
  })

  it("a wired input that holds no picture, or something that is not a picture, is a problem; the other mode's never is", () => {
    expect(longImageWiredPictures({ productImage2: "" }, "ecommerce").problem).toBe("Product image 2 is wired, but its input made no picture.")
    expect(longImageWiredPictures({ subjectImage: "a caption" }, "webpage").problem).toBe("Subject image is wired to something that is not a picture.")
    expect(longImageWiredPictures({ productImage2: "" }, "webpage").problem).toBeUndefined()
    expect(longImageWiredPictures({ styleImage: "" }, "ecommerce").problem).toBeUndefined()
  })
})

describe("longImageWiredCreditId (the editor's price, with the canvas's wires)", () => {
  it("each wired picture input of the mode counts as one picture; the other mode's never", () => {
    expect(longImageWiredCreditId("long-image", { mode: "webpage" }, new Set(["prompt"]))).toBe("long-image:webpage:2K")
    expect(longImageWiredCreditId("long-image", { mode: "webpage", resolution: "1K" }, new Set(["styleImage", "productImage1"]))).toBe("long-image:webpage:1K:1ref")
    expect(longImageWiredCreditId("long-image", { mode: "ecommerce", length: "short" }, new Set(["productImage1", "productImage3", "subjectImage"]))).toBe("long-image:ecommerce:short:2K:2ref")
    // A product page with nothing wired is priced at its first row (the run itself is refused).
    expect(longImageWiredCreditId("long-image", { mode: "ecommerce" }, new Set())).toBe("long-image:ecommerce:medium:2K:1ref")
  })
})
