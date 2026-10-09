import { describe, it, expect } from "vitest"
import { aspectRatioForLoraModel, imageJobPhotoUrl } from "../image-auto-aspect.js"

describe("imageJobPhotoUrl — the first image a generate-image job sends its provider", () => {
  it("is the inpaint / refine base when there is one", () => {
    expect(imageJobPhotoUrl({ baseImageUrl: "https://cdn.example.com/base.png", referenceImageUrls: ["https://cdn.example.com/ref.png"] })).toBe(
      "https://cdn.example.com/base.png",
    )
  })

  it("is otherwise the first reference", () => {
    expect(imageJobPhotoUrl({ referenceImageUrls: ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"] })).toBe("https://cdn.example.com/a.png")
    // An empty base is no base — the worker runs it as plain references.
    expect(imageJobPhotoUrl({ baseImageUrl: "", referenceImageUrls: ["https://cdn.example.com/a.png"] })).toBe("https://cdn.example.com/a.png")
  })

  it("is nothing when the job sends no image", () => {
    expect(imageJobPhotoUrl({})).toBeUndefined()
    expect(imageJobPhotoUrl({ referenceImageUrls: [] })).toBeUndefined()
    expect(imageJobPhotoUrl({ referenceImageUrls: [""] })).toBeUndefined()
    expect(imageJobPhotoUrl({ baseImageUrl: 42, referenceImageUrls: "https://cdn.example.com/a.png" })).toBeUndefined()
  })
})

describe("aspectRatioForLoraModel — a trained character model takes no 'auto'", () => {
  it("omits 'auto' so the model draws its own default", () => {
    expect(aspectRatioForLoraModel("auto")).toBeUndefined()
    expect(aspectRatioForLoraModel(" Auto ")).toBeUndefined()
  })

  it("passes every other value through unchanged", () => {
    expect(aspectRatioForLoraModel("16:9")).toBe("16:9")
    expect(aspectRatioForLoraModel(undefined)).toBeUndefined()
  })
})
