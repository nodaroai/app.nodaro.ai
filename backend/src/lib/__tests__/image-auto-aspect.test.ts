import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, defaultImageModel } from "@nodaro/shared/model-catalog"
import { MODIFY_IMAGE_PROVIDERS } from "@nodaro/shared/models"
import { resolveNormalizedImageGen } from "@nodaro/shared/credits"
import {
  UNSET_RATIO_IS_AUTO_EDIT_MODELS,
  aspectRatioForLoraModel,
  imageJobPhotoUrl,
  imageToImageAspectRatio,
} from "../image-auto-aspect.js"

const LISTED = [...UNSET_RATIO_IS_AUTO_EDIT_MODELS]

describe("imageToImageAspectRatio — no ratio on a GPT Image 2, 2.5 or 2.6 edit is 'auto'", () => {
  it("lists exactly the GPT Image 2, 2.5 and 2.6 edit models and MiniMax H3 Image's edit", () => {
    expect(LISTED.sort()).toEqual([
      "gpt-image-2-5-flare-i2i",
      "gpt-image-2-5-sunburst-i2i",
      "gpt-image-2-6-economy-i2i",
      "gpt-image-2-6-flare-i2i",
      "gpt-image-2-6-sunburst-i2i",
      "gpt-image-2-i2i",
      "minimax-h3-image-i2i",
    ])
    // The platform's edit default is one of them, so a request naming neither
    // a model nor a ratio is covered.
    expect(UNSET_RATIO_IS_AUTO_EDIT_MODELS.has(defaultImageModel("edit"))).toBe(true)
  })

  it.each(LISTED)("%s: a request naming no ratio asks for 'auto'", (provider) => {
    expect(imageToImageAspectRatio(provider, undefined)).toBe("auto")
    expect(imageToImageAspectRatio(provider, null)).toBe("auto")
    expect(imageToImageAspectRatio(provider, "")).toBe("auto")
  })

  it.each(LISTED)("%s: a named ratio is kept as it is", (provider) => {
    expect(imageToImageAspectRatio(provider, "1:1")).toBe("1:1")
    expect(imageToImageAspectRatio(provider, "16:9")).toBe("16:9")
    expect(imageToImageAspectRatio(provider, "auto")).toBe("auto")
  })

  it("GPT Image 2's edit keeps its own auto: no source-photo ratio is read for it", () => {
    // Its native auto keeps the photo's shape; only GPT Image 2.6's goes square.
    expect(imageToImageAspectRatio("gpt-image-2-i2i", undefined)).toBe("auto")
    expect(MODEL_CATALOG["gpt-image-2-i2i"]?.autoAspectFromSourceImage).toBeUndefined()
  })

  it("leaves every other model's unset ratio unset", () => {
    expect(imageToImageAspectRatio("nano-banana-edit", undefined)).toBeUndefined()
    expect(imageToImageAspectRatio("flux-kontext", undefined)).toBeUndefined()
    // The text-to-image ids are not image-to-image models.
    expect(imageToImageAspectRatio("gpt-image-2-6-flare", undefined)).toBeUndefined()
    expect(imageToImageAspectRatio(undefined, undefined)).toBeUndefined()
  })

  it.each(LISTED)("%s is an image-to-image model the route runs, with a native 'auto'", (provider) => {
    const entry = MODEL_CATALOG[provider]
    expect(entry, provider).toBeDefined()
    expect(entry!.modes).toContain("i2i")
    // "auto" stays on offer on every one of them (2.6 resolves it from the
    // photo, `autoAspectFromSourceImage`; 2.5 sends its own).
    expect(entry!.aspectRatios).toContain("auto")
    expect(MODIFY_IMAGE_PROVIDERS as readonly string[]).toContain(provider)
  })

  // The quote is priced before the photo is read and the charge after; the
  // default must not move the price between them, or away from the price of
  // the same request naming "auto".
  it.each(LISTED)("%s: 'auto' prices exactly as no ratio, at every quality, size and input-image count", (provider) => {
    const entry = MODEL_CATALOG[provider]!
    const qualities: (string | undefined)[] = [...(entry.qualities ?? []), undefined]
    const resolutions: (string | undefined)[] = [...(entry.resolutions ?? []), undefined]
    const backgrounds: (string | undefined)[] = [...(entry.backgrounds ?? []), undefined]
    let cases = 0
    for (const quality of qualities) {
      for (const resolution of resolutions) {
        for (const background of backgrounds) {
          for (let refCount = 1; refCount <= 16; refCount++) {
            const base = { provider, quality, resolution, background, refCount, swapToI2i: false }
            const unset = resolveNormalizedImageGen({ ...base, aspectRatio: undefined })
            const auto = resolveNormalizedImageGen({ ...base, aspectRatio: "auto" })
            expect(auto.identifier, `${provider} ${quality}/${resolution}/${background}/${refCount}`).toBe(unset.identifier)
            expect(auto.resolution).toBe(unset.resolution)
            expect(auto.quality).toBe(unset.quality)
            expect(auto.aspectRatio).toBe("auto")
            // "auto" itself is never corrected on these models.
            expect(auto.adjustments.filter((a) => a.field === "aspectRatio")).toEqual([])
            cases++
          }
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(16)
  })
})

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
