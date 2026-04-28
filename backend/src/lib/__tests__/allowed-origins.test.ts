import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { computeAllowedOrigins, isOriginAllowed, getPublicAppUrl } from "../allowed-origins.js"

describe("computeAllowedOrigins", () => {
  it("returns localhost dev origins by default", () => {
    const origins = computeAllowedOrigins({ corsOrigin: "", publicUrl: "" })
    expect(origins).toContain("http://localhost:3000")
    expect(origins).toContain("http://localhost:5173")
  })

  it("includes PUBLIC_URL when set", () => {
    const origins = computeAllowedOrigins({
      corsOrigin: "",
      publicUrl: "https://my-instance.example.com",
    })
    expect(origins).toContain("https://my-instance.example.com")
  })

  it("merges CORS_ORIGIN comma-separated values", () => {
    const origins = computeAllowedOrigins({
      corsOrigin: "https://a.com, https://b.com",
      publicUrl: "",
    })
    expect(origins).toContain("https://a.com")
    expect(origins).toContain("https://b.com")
  })

  it("trims whitespace and ignores empty entries", () => {
    const origins = computeAllowedOrigins({
      corsOrigin: " https://a.com , , https://b.com ",
      publicUrl: "",
    })
    expect(origins).toContain("https://a.com")
    expect(origins).toContain("https://b.com")
    expect(origins.length).toBeGreaterThan(0)
  })

  it("does NOT contain hardcoded nodaro.ai", () => {
    const origins = computeAllowedOrigins({ corsOrigin: "", publicUrl: "" })
    for (const o of origins) expect(o).not.toMatch(/nodaro\.ai/)
  })
})

describe("isOriginAllowed", () => {
  it("returns true for an allowed origin", () => {
    expect(isOriginAllowed("https://a.com", ["https://a.com", "https://b.com"])).toBe(true)
  })

  it("returns false for a non-allowed origin", () => {
    expect(isOriginAllowed("https://evil.com", ["https://a.com"])).toBe(false)
  })

  it("returns false for undefined origin", () => {
    expect(isOriginAllowed(undefined, ["https://a.com"])).toBe(false)
  })
})

describe("getPublicAppUrl", () => {
  it("returns PUBLIC_URL when set", () => {
    expect(getPublicAppUrl({ publicUrl: "https://my.example.com", corsOrigin: "" }))
      .toBe("https://my.example.com")
  })

  it("falls back to first CORS_ORIGIN entry if PUBLIC_URL is empty", () => {
    expect(getPublicAppUrl({ publicUrl: "", corsOrigin: "https://a.com,https://b.com" }))
      .toBe("https://a.com")
  })

  it("falls back to localhost dev URL if both empty", () => {
    expect(getPublicAppUrl({ publicUrl: "", corsOrigin: "" })).toBe("http://localhost:3000")
  })

  it("never returns nodaro.ai", () => {
    const url = getPublicAppUrl({ publicUrl: "", corsOrigin: "" })
    expect(url).not.toMatch(/nodaro\.ai/)
  })
})
