import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// A fixed CORS_ORIGIN for the whole file: getStaticAllowedOrigins() memoises on
// first use, so the allowlist the host predicate reads is
// [http://localhost:3000, http://localhost:5173, https://studio.example.com]
// no matter which test runs first.
vi.mock("../config.js", async (orig) => {
  const actual = await orig<typeof import("../config.js")>()
  return { ...actual, config: { ...actual.config, CORS_ORIGIN: "https://studio.example.com", PUBLIC_URL: "" } }
})
import { computeAllowedOrigins, isOriginAllowed, getPublicAppUrl, requestHost, requestHostname, isAllowedRequestHost } from "../allowed-origins.js"

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
 * WS-D — the header-derived request host. Pure over headers, so these are
 * unit-tested with hand-built requests (no Fastify).
 *
 * `x-forwarded-proto` is deliberately NOT read: the edge proxy owns the scheme
 * and rewrites the header (Caddy replaces it with the scheme IT received unless
 * the peer is a trusted proxy), so behind a TLS-terminating platform edge it
 * says `http` for an `https` request. The one decision these drive — redirect
 * relative — never needs a scheme.
 */
describe("requestHost", () => {
  const req = (headers: Record<string, string | string[] | undefined>) => ({ headers })

  it("prefers x-forwarded-host over host", () => {
    expect(requestHost(req({ "x-forwarded-host": "front.example.com", host: "backend:9000" }))).toBe("front.example.com")
  })

  it("falls back to host when nothing is forwarded", () => {
    expect(requestHost(req({ host: "localhost:5173" }))).toBe("localhost:5173")
  })

  it("keeps the port — this is a URL `host`, not a hostname", () => {
    expect(requestHost(req({ "x-forwarded-host": "studio.example.com:8443" }))).toBe("studio.example.com:8443")
  })

  it("lower-cases (DNS is case-insensitive; string equality is not)", () => {
    expect(requestHost(req({ "x-forwarded-host": "Studio.Example.COM" }))).toBe("studio.example.com")
  })

  it("takes the first value of an array header", () => {
    expect(requestHost(req({ "x-forwarded-host": ["a.example.com", "b.example.com"] }))).toBe("a.example.com")
  })

  it("takes the first entry of a comma-separated forwarded chain", () => {
    expect(requestHost(req({ "x-forwarded-host": "a.example.com, b.example.com" }))).toBe("a.example.com")
  })

  it("returns null when there is no host at all", () => {
    expect(requestHost(req({}))).toBeNull()
    expect(requestHost(req({ "x-forwarded-host": "   " }))).toBeNull()
  })
})

describe("requestHostname", () => {
  const req = (headers: Record<string, string | string[] | undefined>) => ({ headers })

  it("is requestHost with the port stripped (the per-host map key is port-agnostic)", () => {
    expect(requestHostname(req({ "x-forwarded-host": "Studio.Example.COM:8443" }))).toBe("studio.example.com")
    expect(requestHostname(req({ host: "localhost:5173" }))).toBe("localhost")
  })

  it("keeps a bracketed IPv6 literal whole while dropping its port", () => {
    expect(requestHostname(req({ host: "[::1]:3000" }))).toBe("[::1]")
    expect(requestHostname(req({ host: "[::1]" }))).toBe("[::1]")
  })

  it("returns null when there is no host", () => {
    expect(requestHostname(req({}))).toBeNull()
  })
})

describe("isAllowedRequestHost", () => {
  const req = (headers: Record<string, string | string[] | undefined>) => ({ headers })

  // The static allowlist always carries http://localhost:3000 and
  // http://localhost:5173 (computeAllowedOrigins), whose `host` parts are
  // localhost:3000 and localhost:5173 — distinct entries, both allowed.
  it("is true for a host in the static allowlist, port and all", () => {
    expect(isAllowedRequestHost(req({ "x-forwarded-host": "localhost:5173" }))).toBe(true)
    expect(isAllowedRequestHost(req({ host: "localhost:3000" }))).toBe(true)
  })

  it("is false when the port differs from the allow-listed one", () => {
    expect(isAllowedRequestHost(req({ host: "localhost:9999" }))).toBe(false)
    expect(isAllowedRequestHost(req({ host: "localhost" }))).toBe(false)
  })

  it("is false for a foreign host", () => {
    expect(isAllowedRequestHost(req({ "x-forwarded-host": "evil.example.com" }))).toBe(false)
  })

  it("is false when the request carries no host header", () => {
    expect(isAllowedRequestHost(req({}))).toBe(false)
  })

  it("takes the first entry of a comma-separated x-forwarded-host", () => {
    expect(isAllowedRequestHost(req({ "x-forwarded-host": "localhost:5173, evil.example.com" }))).toBe(true)
    expect(isAllowedRequestHost(req({ "x-forwarded-host": "evil.example.com, localhost:5173" }))).toBe(false)
  })
})

/**
 * The shape the hosted lane actually produces: a platform edge terminates TLS
 * and speaks plain HTTP to the container, and Caddy — which does not trust the
 * peer by default — rewrites `x-forwarded-proto` to its own `http`. The
 * allow-list entry is the https origin the operator configured
 * (CORS_ORIGIN, mocked at the top of this file).
 *
 * A host-based predicate matches. An origin-based one never would, and the
 * feature it gates would be a silent no-op in production.
 */
describe("isAllowedRequestHost behind a TLS-terminating edge", () => {
  const req = (headers: Record<string, string | string[] | undefined>) => ({ headers })

  it('allows the https allow-list entry when the proxy stamped proto "http"', () => {
    expect(isAllowedRequestHost(req({ "x-forwarded-host": "studio.example.com", "x-forwarded-proto": "http" }))).toBe(true)
  })

  it("allows it when there is no proto header at all", () => {
    expect(isAllowedRequestHost(req({ "x-forwarded-host": "studio.example.com" }))).toBe(true)
  })

  it("allows it through the Host header alone (no proxy in front)", () => {
    expect(isAllowedRequestHost(req({ host: "studio.example.com" }))).toBe(true)
  })

  it("still refuses a foreign host however the proto is stamped", () => {
    expect(isAllowedRequestHost(req({ "x-forwarded-host": "evil.example.com", "x-forwarded-proto": "https" }))).toBe(false)
  })
})
