import { describe, it, expect } from "vitest"
import { validateFile, detectCategory, getExtensionFromMime, getSizeLimit } from "../file-validation.js"

describe("detectCategory", () => {
  it("detects image types", () => {
    expect(detectCategory("image/png")).toBe("image")
    expect(detectCategory("image/jpeg")).toBe("image")
    expect(detectCategory("image/webp")).toBe("image")
    expect(detectCategory("image/gif")).toBe("image")
  })

  it("detects video types", () => {
    expect(detectCategory("video/mp4")).toBe("video")
    expect(detectCategory("video/webm")).toBe("video")
    expect(detectCategory("video/quicktime")).toBe("video")
  })

  it("detects audio types", () => {
    expect(detectCategory("audio/mpeg")).toBe("audio")
    expect(detectCategory("audio/wav")).toBe("audio")
    expect(detectCategory("audio/ogg")).toBe("audio")
  })

  it("returns null for unknown types", () => {
    expect(detectCategory("application/json")).toBeNull()
    expect(detectCategory("text/html")).toBeNull()
  })
})

describe("getExtensionFromMime", () => {
  it("maps common types to extensions", () => {
    expect(getExtensionFromMime("image/png")).toBe("png")
    expect(getExtensionFromMime("image/jpeg")).toBe("jpg")
    expect(getExtensionFromMime("video/mp4")).toBe("mp4")
    expect(getExtensionFromMime("audio/mpeg")).toBe("mp3")
    expect(getExtensionFromMime("video/quicktime")).toBe("mov")
  })

  it("returns bin for unknown types", () => {
    expect(getExtensionFromMime("application/octet-stream")).toBe("bin")
  })
})

describe("getSizeLimit", () => {
  it("returns 25MB for images", () => {
    expect(getSizeLimit("image")).toBe(25 * 1024 * 1024)
  })

  it("returns 500MB for videos", () => {
    expect(getSizeLimit("video")).toBe(500 * 1024 * 1024)
  })

  it("returns 50MB for audio", () => {
    expect(getSizeLimit("audio")).toBe(50 * 1024 * 1024)
  })
})

describe("validateFile", () => {
  it("accepts valid image files", () => {
    const result = validateFile("image/png", 1024 * 1024)
    expect(result.valid).toBe(true)
    expect(result.category).toBe("image")
  })

  it("accepts valid video files", () => {
    const result = validateFile("video/mp4", 50 * 1024 * 1024)
    expect(result.valid).toBe(true)
    expect(result.category).toBe("video")
  })

  it("accepts valid audio files", () => {
    const result = validateFile("audio/mpeg", 5 * 1024 * 1024)
    expect(result.valid).toBe(true)
    expect(result.category).toBe("audio")
  })

  it("rejects unsupported MIME types", () => {
    const result = validateFile("application/json", 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Unsupported file type")
  })

  it("rejects images exceeding 25MB", () => {
    const result = validateFile("image/png", 30 * 1024 * 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("File too large")
    expect(result.category).toBe("image")
  })

  it("rejects videos exceeding 500MB", () => {
    const result = validateFile("video/mp4", 600 * 1024 * 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("File too large")
  })

  it("rejects audio exceeding 50MB", () => {
    const result = validateFile("audio/wav", 60 * 1024 * 1024)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("File too large")
  })
})
