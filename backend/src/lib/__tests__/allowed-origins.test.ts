import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { computeAllowedOrigins, isOriginAllowed, getPublicAppUrl, requestOrigin, isAllowedRequestOrigin, requestHost } from "../allowed-origins.js"

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

/**
 * WS-D — the header-derived request origin. The hosted lane is fronted by Caddy,
 * which sets both `x-forwarded-proto` and `x-forwarded-host`; these two are pure
 * over headers so they can be unit-tested with hand-built requests (no Fastify).
 */
describe("requestOrigin", () => {
  const req = (headers: Record<string, string | string[] | undefined>) => ({ headers })

  it("builds the origin from the forwarded proto + host", () => {
    expect(requestOrigin(req({ "x-forwarded-proto": "https", "x-forwarded-host": "studio.example.com" })))
      .toBe("https://studio.example.com")
  })

  it("prefers x-forwarded-host over host", () => {
    expect(requestOrigin(req({ "x-forwarded-proto": "http", "x-forwarded-host": "front.example.com", host: "backend:9000" })))
      .toBe("http://front.example.com")
  })

  it("falls back to host when nothing is forwarded", () => {
    expect(requestOrigin(req({ host: "localhost:5173", "x-forwarded-proto": "http" }))).toBe("http://localhost:5173")
  })

  it("defaults the scheme to https when no proto is forwarded", () => {
    expect(requestOrigin(req({ host: "studio.example.com" }))).toBe("https://studio.example.com")
  })

  it("keeps the port — an origin is scheme + host + port", () => {
    expect(requestOrigin(req({ "x-forwarded-proto": "http", "x-forwarded-host": "localhost:5173" })))
      .toBe("http://localhost:5173")
  })

  it("takes the first value of an array header", () => {
    expect(requestOrigin(req({ "x-forwarded-proto": ["https", "http"], "x-forwarded-host": ["a.example.com", "b.example.com"] })))
      .toBe("https://a.example.com")
  })

  it("takes the first entry of a comma-separated forwarded chain", () => {
    expect(requestOrigin(req({ "x-forwarded-proto": "https, http", "x-forwarded-host": "a.example.com, b.example.com" })))
      .toBe("https://a.example.com")
  })

  it("lower-cases scheme and host (DNS is case-insensitive; the allowlist is not)", () => {
    expect(requestOrigin(req({ "x-forwarded-proto": "HTTPS", "x-forwarded-host": "Studio.Example.COM" })))
      .toBe("https://studio.example.com")
  })

  it("returns null when there is no host at all", () => {
    expect(requestOrigin(req({}))).toBeNull()
    expect(requestOrigin(req({ "x-forwarded-proto": "https" }))).toBeNull()
    expect(requestOrigin(req({ "x-forwarded-host": "   " }))).toBeNull()
  })
})

describe("isAllowedRequestOrigin", () => {
  const req = (headers: Record<string, string | string[] | undefined>) => ({ headers })

  it("is true for a host whose derived origin is in the static allowlist", () => {
    // http://localhost:5173 is always in the list (computeAllowedOrigins).
    expect(isAllowedRequestOrigin(req({ "x-forwarded-proto": "http", "x-forwarded-host": "localhost:5173" }))).toBe(true)
  })

  it("is false when the scheme differs (the allowlist matches whole origins)", () => {
    // No forwarded proto ⇒ https://localhost:5173, which is NOT the allow-listed
    // http:// dev origin.
    expect(isAllowedRequestOrigin(req({ host: "localhost:5173" }))).toBe(false)
  })

  it("is false for a foreign host", () => {
    expect(isAllowedRequestOrigin(req({ "x-forwarded-proto": "https", "x-forwarded-host": "evil.example.com" }))).toBe(false)
  })

  it("is false when the request carries no host header", () => {
    expect(isAllowedRequestOrigin(req({}))).toBe(false)
  })
})

describe("requestHost", () => {
  const req = (headers: Record<string, string | string[] | undefined>) => ({ headers })

  it("returns the bare host, lower-cased and without the port", () => {
    expect(requestHost(req({ "x-forwarded-host": "Studio.Example.COM:8443" }))).toBe("studio.example.com")
  })

  it("prefers x-forwarded-host, falls back to host", () => {
    expect(requestHost(req({ host: "localhost:5173" }))).toBe("localhost")
    expect(requestHost(req({ "x-forwarded-host": "front.example.com", host: "backend:9000" }))).toBe("front.example.com")
  })

  it("takes the first value of an array or comma-separated header", () => {
    expect(requestHost(req({ "x-forwarded-host": ["a.example.com", "b.example.com"] }))).toBe("a.example.com")
    expect(requestHost(req({ "x-forwarded-host": "a.example.com, b.example.com" }))).toBe("a.example.com")
  })

  it("keeps a bracketed IPv6 literal whole while dropping its port", () => {
    expect(requestHost(req({ host: "[::1]:3000" }))).toBe("[::1]")
    expect(requestHost(req({ host: "[::1]" }))).toBe("[::1]")
  })

  it("returns null when there is no host", () => {
    expect(requestHost(req({}))).toBeNull()
  })
})
