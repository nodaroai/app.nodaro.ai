// @vitest-environment node
import { describe, expect, it } from "vitest"
import { jobPreview } from "@/lib/job-preview"

describe("jobPreview", () => {
  it("shows the image an image job made", () => {
    expect(jobPreview({ output_data: { imageUrl: "https://cdn/i.png" } })).toEqual({ kind: "image", url: "https://cdn/i.png" })
  })

  it("prefers the video over its thumbnail and the audio", () => {
    expect(jobPreview({ output_data: { videoUrl: "https://cdn/v.mp4", imageUrl: "https://cdn/t.png", audioUrl: "https://cdn/a.mp3" } })).toEqual({
      kind: "video",
      url: "https://cdn/v.mp4",
      posterUrl: "https://cdn/t.png",
    })
  })

  it("shows the audio an audio job made", () => {
    expect(jobPreview({ output_data: { audioUrl: "https://cdn/a.mp3" } })).toEqual({ kind: "audio", url: "https://cdn/a.mp3" })
  })

  it("reads the first of a list of images", () => {
    expect(jobPreview({ output_data: { imageUrls: ["https://cdn/1.png", "https://cdn/2.png"] } })).toEqual({ kind: "image", url: "https://cdn/1.png" })
  })

  it("is none for a job with no media yet, or none at all", () => {
    expect(jobPreview({})).toEqual({ kind: "none" })
    expect(jobPreview({ output_data: { script: "x", imageUrl: "" } })).toEqual({ kind: "none" })
  })

  it("never offers a url that is not http(s)", () => {
    expect(jobPreview({ output_data: { imageUrl: "javascript:alert(1)" } })).toEqual({ kind: "none" })
  })
})
