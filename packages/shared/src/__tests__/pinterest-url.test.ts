import { describe, it, expect } from "vitest"
import { normalizePinterestUrl } from "../pinterest-url.js"

describe("normalizePinterestUrl", () => {
  it.each([
    ["/236x/", "https://i.pinimg.com/236x/ab/cd/ef/abcdef1234.jpg"],
    ["/474x/", "https://i.pinimg.com/474x/ab/cd/ef/abcdef1234.jpg"],
    ["/564x/", "https://i.pinimg.com/564x/ab/cd/ef/abcdef1234.jpg"],
    ["/736x/", "https://i.pinimg.com/736x/ab/cd/ef/abcdef1234.jpg"],
    ["/1200x/", "https://i.pinimg.com/1200x/ab/cd/ef/abcdef1234.jpg"],
  ])("rewrites %s to /originals/", (_, input) => {
    const out = normalizePinterestUrl(input)
    expect(out).toBe("https://i.pinimg.com/originals/ab/cd/ef/abcdef1234.jpg")
  })

  it("is a no-op when the URL is already /originals/", () => {
    const url = "https://i.pinimg.com/originals/ab/cd/ef/abcdef1234.jpg"
    expect(normalizePinterestUrl(url)).toBe(url)
  })

  it("preserves query string and fragment", () => {
    const out = normalizePinterestUrl("https://i.pinimg.com/236x/ab/cd/ef/x.jpg?v=1#hash")
    expect(out).toBe("https://i.pinimg.com/originals/ab/cd/ef/x.jpg?v=1#hash")
  })

  it.each([
    "https://example.com/foo.jpg",
    "https://www.pinterest.com/pin/123456/",
    "https://i.pinimg.com/avatars/some-user/abc.jpg",
    "not-a-url",
    "",
  ])("passes through %s unchanged", (input) => {
    expect(normalizePinterestUrl(input)).toBe(input)
  })
})
