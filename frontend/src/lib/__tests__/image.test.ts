import { describe, it, expect } from "vitest"
import { optimizedImageUrl } from "../image"

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
})
