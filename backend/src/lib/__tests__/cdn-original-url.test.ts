import { describe, expect, it } from "vitest"
import { originalCdnImageUrl, originalCdnImageUrls, withOriginalVideoImageUrls } from "../cdn-original-url.js"

const ORIGINAL = "https://cdn.nodaro.ai/community/00b192c5-9b27-432c-b7d6-668a8edb5360/ea329b94-b2c4-4653-b7eb-48f5d861730b.png"
const RENDITION =
  "https://cdn.nodaro.ai/cdn-cgi/image/width=1600,quality=80,format=auto/community/00b192c5-9b27-432c-b7d6-668a8edb5360/ea329b94-b2c4-4653-b7eb-48f5d861730b.png"

describe("originalCdnImageUrl", () => {
  it("rewrites a display rendition of our CDN to its original file", () => {
    expect(originalCdnImageUrl(RENDITION)).toBe(ORIGINAL)
  })

  it("reads any option order and the other host our zone serves", () => {
    expect(originalCdnImageUrl("https://cdn.nodaro.ai/cdn-cgi/image/width=480,format=auto,quality=80/uploads/abc.png")).toBe(
      "https://cdn.nodaro.ai/uploads/abc.png",
    )
    expect(originalCdnImageUrl("https://assets.nodaro.ai/cdn-cgi/image/w=200/images/a.jpg")).toBe("https://assets.nodaro.ai/images/a.jpg")
  })

  it("leaves an original untouched", () => {
    expect(originalCdnImageUrl(ORIGINAL)).toBe(ORIGINAL)
    expect(originalCdnImageUrl("https://cdn.nodaro.ai/images/aa704a6f-b5f3-4f85-a7ad-73eda66444ae.png")).toBe(
      "https://cdn.nodaro.ai/images/aa704a6f-b5f3-4f85-a7ad-73eda66444ae.png",
    )
  })

  it("never rewrites another host's /cdn-cgi/image/", () => {
    for (const url of [
      "https://example.com/cdn-cgi/image/width=1600/community/a.png",
      "https://cdn.nodaro.ai.evil.com/cdn-cgi/image/width=1600/community/a.png",
      "https://evilcdn.nodaro.ai/cdn-cgi/image/width=1600/community/a.png",
      "http://cdn.nodaro.ai/cdn-cgi/image/width=1600/community/a.png",
    ]) {
      expect(originalCdnImageUrl(url), url).toBe(url)
    }
  })

  it("never rewrites a media transform (a frame of a video has no image original)", () => {
    const frame = "https://cdn.nodaro.ai/cdn-cgi/media/mode=frame,time=0s,width=480,format=jpg/videos/clip.mp4"
    expect(originalCdnImageUrl(frame)).toBe(frame)
  })

  it("leaves a remote-source rendition and an unreadable one alone", () => {
    for (const url of [
      "https://cdn.nodaro.ai/cdn-cgi/image/width=1600/https://elsewhere.example/a.png",
      "https://cdn.nodaro.ai/cdn-cgi/image/width=1600/https%3A%2F%2Felsewhere.example%2Fa.png",
      "https://cdn.nodaro.ai/cdn-cgi/image/width=1600/",
      "https://cdn.nodaro.ai/cdn-cgi/image/width=1600",
      "https://cdn.nodaro.ai/cdn-cgi/image//images/a.png",
      "https://cdn.nodaro.ai/cdn-cgi/image/width=1600//images/a.png",
      "not a url /cdn-cgi/image/x/y.png",
    ]) {
      expect(originalCdnImageUrl(url), url).toBe(url)
    }
  })

  it("maps a list into a new array", () => {
    const list = [ORIGINAL, RENDITION]
    const out = originalCdnImageUrls(list)
    expect(out).toEqual([ORIGINAL, ORIGINAL])
    expect(list[1]).toBe(RENDITION)
  })
})

describe("withOriginalVideoImageUrls", () => {
  it("rewrites every image input of a video request, as a copy", () => {
    const body = {
      provider: "kling-4",
      imageUrl: RENDITION,
      endFrameUrl: RENDITION,
      last_frame_image: RENDITION,
      referenceImageUrls: [ORIGINAL, RENDITION],
      referenceVideoUrls: ["https://cdn.nodaro.ai/cdn-cgi/media/width=480,mode=video/videos/a.mp4"],
      connectedReferences: [{ id: "a", url: RENDITION, defaultName: "A", source: "upload" }],
      characterReferences: [{ imageUrl: RENDITION, bodyImageUrl: RENDITION, extraImageUrls: [RENDITION], description: "her" }],
    }
    const out = withOriginalVideoImageUrls(body)
    expect(out).toEqual({
      ...body,
      imageUrl: ORIGINAL,
      endFrameUrl: ORIGINAL,
      last_frame_image: ORIGINAL,
      referenceImageUrls: [ORIGINAL, ORIGINAL],
      connectedReferences: [{ id: "a", url: ORIGINAL, defaultName: "A", source: "upload" }],
      characterReferences: [{ imageUrl: ORIGINAL, bodyImageUrl: ORIGINAL, extraImageUrls: [ORIGINAL], description: "her" }],
    })
    expect(body.referenceImageUrls[1]).toBe(RENDITION)
    expect(body.imageUrl).toBe(RENDITION)
  })

  it("adds no field and passes a body that is not an object through", () => {
    expect(withOriginalVideoImageUrls({ prompt: "x" })).toEqual({ prompt: "x" })
    expect(withOriginalVideoImageUrls(undefined)).toBeUndefined()
    expect(withOriginalVideoImageUrls("x")).toBe("x")
    // A field of the wrong shape is left for the route's validation to refuse.
    expect(withOriginalVideoImageUrls({ referenceImageUrls: "nope", imageUrl: 3 })).toEqual({ referenceImageUrls: "nope", imageUrl: 3 })
  })
})
