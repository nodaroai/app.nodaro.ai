// @vitest-environment node
import { describe, it, expect } from "vitest"
import { optimizedImageUrl, imageDownloadExtension } from "../image"

describe("optimizedImageUrl", () => {
  it("transforms a cdn.nodaro.ai URL with defaults", () => {
    const url = "https://cdn.nodaro.ai/uploads/abc.png"
    const result = optimizedImageUrl(url)
    expect(result).toBe(
      "https://cdn.nodaro.ai/cdn-cgi/image/width=480,format=auto,quality=80/uploads/abc.png"
    )
  })

  it("uses custom width and quality", () => {
    const url = "https://cdn.nodaro.ai/uploads/abc.png"
    const result = optimizedImageUrl(url, { width: 1024, quality: 90 })
    expect(result).toContain("width=1024")
    expect(result).toContain("quality=90")
  })

  it("returns non-CDN URLs unchanged", () => {
    const url = "https://example.com/photo.jpg"
    expect(optimizedImageUrl(url)).toBe(url)
  })

  it("returns empty string unchanged", () => {
    expect(optimizedImageUrl("")).toBe("")
  })

  it("does not double-wrap already transformed URLs", () => {
    const url = "https://cdn.nodaro.ai/cdn-cgi/image/width=200,format=auto,quality=80/uploads/abc.png"
    expect(optimizedImageUrl(url)).toBe(url)
  })

  it("preserves the full pathname", () => {
    const url = "https://cdn.nodaro.ai/users/123/images/photo.jpg"
    const result = optimizedImageUrl(url)
    expect(result).toContain("/users/123/images/photo.jpg")
  })

  it("uses default width=480 when not specified", () => {
    const url = "https://cdn.nodaro.ai/img.png"
    const result = optimizedImageUrl(url, { quality: 50 })
    expect(result).toContain("width=480")
    expect(result).toContain("quality=50")
  })

  it("uses default quality=80 when not specified", () => {
    const url = "https://cdn.nodaro.ai/img.png"
    const result = optimizedImageUrl(url, { width: 200 })
    expect(result).toContain("width=200")
    expect(result).toContain("quality=80")
  })

  it("leaves a GIF (its animation) and an SVG (a vector) untouched", () => {
    for (const url of [
      "https://cdn.nodaro.ai/users/1/images/spin.gif",
      "https://cdn.nodaro.ai/users/1/images/logo.svg",
      "https://assets.nodaro.ai/users/1/images/LOGO.SVG?v=2",
      "https://cdn.nodaro.ai/users/1/images/spin.GIF",
    ]) {
      expect(optimizedImageUrl(url)).toBe(url)
      expect(optimizedImageUrl(url, { width: 1024 })).toBe(url)
    }
  })

  it("still resizes JPEG and WebP results", () => {
    expect(optimizedImageUrl("https://cdn.nodaro.ai/a.jpg")).toContain("/cdn-cgi/image/")
    expect(optimizedImageUrl("https://cdn.nodaro.ai/a.webp")).toContain("/cdn-cgi/image/")
    // ".gif" only as part of a folder name is no GIF.
    expect(optimizedImageUrl("https://cdn.nodaro.ai/x.gif/a.png")).toContain("/cdn-cgi/image/")
  })
})

describe("imageDownloadExtension", () => {
  it("keeps the format the result is", () => {
    expect(imageDownloadExtension("https://cdn.nodaro.ai/u/a.gif")).toBe("gif")
    expect(imageDownloadExtension("https://cdn.nodaro.ai/u/a.svg?x=1")).toBe("svg")
    expect(imageDownloadExtension("https://cdn.nodaro.ai/u/a.JPG")).toBe("jpg")
    expect(imageDownloadExtension("https://cdn.nodaro.ai/u/a.jpeg")).toBe("jpeg")
    expect(imageDownloadExtension("https://cdn.nodaro.ai/u/a.webp#t")).toBe("webp")
    expect(imageDownloadExtension("/v1/media/a.png")).toBe("png")
  })

  it("falls back to PNG", () => {
    expect(imageDownloadExtension("https://cdn.nodaro.ai/u/a")).toBe("png")
    expect(imageDownloadExtension("https://cdn.nodaro.ai/u/a.mp4")).toBe("png")
    expect(imageDownloadExtension(undefined)).toBe("png")
    expect(imageDownloadExtension("")).toBe("png")
  })
})
