import { describe, it, expect } from "vitest"
import { isVideoUrl, isImageUrl, isAudioUrl, isMediaUrl } from "../media-type"

describe("isVideoUrl", () => {
  it("matches .mp4", () => {
    expect(isVideoUrl("file.mp4")).toBe(true)
  })

  it("is case insensitive", () => {
    expect(isVideoUrl("file.MP4")).toBe(true)
  })

  it("matches with query params", () => {
    expect(isVideoUrl("file.mp4?v=1")).toBe(true)
  })

  it("rejects non-video extensions", () => {
    expect(isVideoUrl("file.jpg")).toBe(false)
  })
})

describe("isImageUrl", () => {
  it("matches .png", () => {
    expect(isImageUrl("photo.png")).toBe(true)
  })

  it("is case insensitive", () => {
    expect(isImageUrl("photo.WEBP")).toBe(true)
  })

  it("matches .avif", () => {
    expect(isImageUrl("file.avif")).toBe(true)
  })

  it("rejects non-image extensions", () => {
    expect(isImageUrl("file.mp4")).toBe(false)
  })
})

describe("isAudioUrl", () => {
  it("matches .mp3", () => {
    expect(isAudioUrl("song.mp3")).toBe(true)
  })

  it("matches .flac", () => {
    expect(isAudioUrl("file.flac")).toBe(true)
  })

  it("matches .m4a", () => {
    expect(isAudioUrl("file.m4a")).toBe(true)
  })

  it("rejects non-audio extensions", () => {
    expect(isAudioUrl("file.mp4")).toBe(false)
  })
})

describe("isMediaUrl", () => {
  it("matches https URLs", () => {
    expect(isMediaUrl("https://example.com/file")).toBe(true)
  })

  it("matches http URLs", () => {
    expect(isMediaUrl("http://localhost/img")).toBe(true)
  })

  it("matches blob URLs", () => {
    expect(isMediaUrl("blob:abc123")).toBe(true)
  })

  it("rejects local paths", () => {
    expect(isMediaUrl("/local/path")).toBe(false)
  })

  it("rejects empty strings", () => {
    expect(isMediaUrl("")).toBe(false)
  })
})
