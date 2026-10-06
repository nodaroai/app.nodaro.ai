import { describe, it, expect, vi, beforeEach } from "vitest"

const prepareVideoFrames = vi.fn()
vi.mock("../video-frame-fit.js", () => ({
  prepareVideoFrames: (...args: unknown[]) => prepareVideoFrames(...args),
}))

const { applyFrameFitAndDelivery } = await import("../video-frame-dispatch.js")

/** The fit is exercised in its own suite; here it is a pass-through by default. */
beforeEach(() => {
  prepareVideoFrames.mockReset()
  prepareVideoFrames.mockImplementation(async (args: { imageUrl?: string; endFrameUrl?: string }) => ({
    imageUrl: args.imageUrl,
    endFrameUrl: args.endFrameUrl,
    applied: [],
  }))
})

describe("applyFrameFitAndDelivery — frameless requests (the characterReferences lane)", () => {
  it("hands the options through untouched when there is no frame, so characterReferences survive the router hop", async () => {
    const characterReferences = [{ imageUrl: "https://cdn.example/a.png", description: "A woman with silver hair" }]
    const options = { characterReferences, aspectRatio: "16:9" as const }
    const out = await applyFrameFitAndDelivery({
      model: "gemini-omni-video", imageUrl: undefined, endFrameUrl: undefined, prompt: "she speaks", options,
    })
    expect(prepareVideoFrames).not.toHaveBeenCalled()
    expect(out.imageUrl).toBeUndefined()
    expect(out.options?.characterReferences).toEqual(characterReferences)
  })
})

describe("applyFrameFitAndDelivery — fit", () => {
  it("asks for the fit with the request's own provider, resolution and aspect", async () => {
    await applyFrameFitAndDelivery({
      model: "seedance-2-5",
      imageUrl: "https://cdn.example/start.png",
      endFrameUrl: "https://cdn.example/end.png",
      prompt: "a walk",
      options: { resolution: "720p", aspectRatio: "9:16" },
    })
    expect(prepareVideoFrames).toHaveBeenCalledWith({
      provider: "seedance-2-5",
      resolution: "720p",
      aspectRatio: "9:16",
      imageUrl: "https://cdn.example/start.png",
      endFrameUrl: "https://cdn.example/end.png",
      fit: undefined,
    })
  })

  it("passes the fitted urls on to the provider", async () => {
    prepareVideoFrames.mockResolvedValue({
      imageUrl: "https://cdn.example/fitted-start.jpg",
      endFrameUrl: "https://cdn.example/fitted-end.jpg",
      applied: [{ role: "start", from: { width: 940, height: 1672 }, to: { width: 720, height: 1280 }, cropped: false, reason: "resolution", url: "https://cdn.example/fitted-start.jpg" }],
    })
    const out = await applyFrameFitAndDelivery({
      model: "seedance-2-5",
      imageUrl: "https://cdn.example/start.png",
      endFrameUrl: "https://cdn.example/end.png",
      options: { resolution: "720p", aspectRatio: "9:16" },
    })
    expect(out.imageUrl).toBe("https://cdn.example/fitted-start.jpg")
    expect(out.endFrameUrl).toBe("https://cdn.example/fitted-end.jpg")
    expect(out.applied).toHaveLength(1)
  })

  it("skips the fit entirely when there are no frames", async () => {
    const out = await applyFrameFitAndDelivery({ model: "seedance-2-5", prompt: "text to video" })
    expect(prepareVideoFrames).not.toHaveBeenCalled()
    expect(out.applied).toEqual([])
  })
})

describe("applyFrameFitAndDelivery — delivery", () => {
  const start = "https://cdn.example/start.png"

  it("keeps a frame as a frame on a model whose frame mode measured fine", async () => {
    const out = await applyFrameFitAndDelivery({ model: "seedance-2-5", imageUrl: start, prompt: "a walk" })
    expect(out.delivery).toBe("frame")
    expect(out.imageUrl).toBe(start)
    expect(out.options?.referenceImageUrls).toBeUndefined()
    expect(out.prompt).toBe("a walk")
  })

  it("sends the Seedance 2.0 family as a bound reference instead", async () => {
    const out = await applyFrameFitAndDelivery({ model: "seedance-2-fast", imageUrl: start, prompt: "a walk" })
    expect(out.delivery).toBe("reference")
    expect(out.imageUrl).toBeUndefined()
    expect(out.options?.referenceImageUrls).toEqual([start])
    expect(out.prompt).toBe("a walk\nUse @image_1 as the opening (first) frame of the video.")
  })

  it("appends the frames AFTER the user's own references so their ordinals hold", async () => {
    const out = await applyFrameFitAndDelivery({
      model: "seedance-2-fast",
      imageUrl: start,
      endFrameUrl: "https://cdn.example/end.png",
      prompt: "the {image:1} turns",
      options: { referenceImageUrls: ["https://cdn.example/ref-a.png", "https://cdn.example/ref-b.png"] },
    })
    expect(out.options?.referenceImageUrls).toEqual([
      "https://cdn.example/ref-a.png",
      "https://cdn.example/ref-b.png",
      start,
      "https://cdn.example/end.png",
    ])
    expect(out.prompt).toContain("@image_3 as the opening (first) frame")
    expect(out.prompt).toContain("@image_4 as the closing (last) frame")
  })

  it("does not add a second opening-frame sentence when the prompt already binds one", async () => {
    const prompt = "Use @image_1 as the first frame, it is the last keyframe of @video_1"
    const out = await applyFrameFitAndDelivery({ model: "seedance-2-fast", imageUrl: start, prompt })
    expect(out.prompt).toBe(prompt)
    expect(out.options?.referenceImageUrls).toEqual([start])
  })

  it("honours an explicit frame request on a model that would otherwise switch", async () => {
    const out = await applyFrameFitAndDelivery({
      model: "seedance-2-fast", imageUrl: start, options: { frameDelivery: "frame" },
    })
    expect(out.delivery).toBe("frame")
    expect(out.imageUrl).toBe(start)
  })

  it("stays in frame mode on a model that takes no reference images", async () => {
    const out = await applyFrameFitAndDelivery({
      model: "wan-i2v", imageUrl: start, options: { frameDelivery: "reference" },
    })
    expect(out.delivery).toBe("frame")
    expect(out.imageUrl).toBe(start)
  })

  it("keeps frame mode rather than dropping a user's reference to fit the cap", async () => {
    // seedance-2-fast carries 9 images; 9 user refs + 1 frame is one too many.
    const refs = Array.from({ length: 9 }, (_, i) => `https://cdn.example/ref-${i}.png`)
    const out = await applyFrameFitAndDelivery({
      model: "seedance-2-fast", imageUrl: start, options: { referenceImageUrls: refs },
    })
    expect(out.delivery).toBe("frame")
    expect(out.imageUrl).toBe(start)
    expect(out.options?.referenceImageUrls).toEqual(refs)
  })
})
