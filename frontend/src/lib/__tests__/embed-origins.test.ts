// @vitest-environment node
import { describe, it, expect } from "vitest"
import { classifyEmbedSessionMessage, isAllowedEmbedParent } from "../embed-origins"

describe("isAllowedEmbedParent", () => {
  it("allows first-party https *.nodaro.ai subdomains (studio + future surfaces)", () => {
    expect(isAllowedEmbedParent("https://studio.nodaro.ai")).toBe(true)
    expect(isAllowedEmbedParent("https://next.studio.nodaro.ai")).toBe(true)
    expect(isAllowedEmbedParent("https://app.nodaro.ai")).toBe(true)
  })

  it("allows the apex https://nodaro.ai", () => {
    expect(isAllowedEmbedParent("https://nodaro.ai")).toBe(true)
  })

  it("rejects http (non-TLS) nodaro.ai to avoid downgrade-injected sessions", () => {
    expect(isAllowedEmbedParent("http://studio.nodaro.ai")).toBe(false)
  })

  it("rejects look-alike domains that merely contain nodaro.ai", () => {
    expect(isAllowedEmbedParent("https://nodaro.ai.evil.com")).toBe(false)
    expect(isAllowedEmbedParent("https://evil-nodaro.ai")).toBe(false)
    expect(isAllowedEmbedParent("https://notnodaro.ai")).toBe(false)
    expect(isAllowedEmbedParent("https://nodaro.ai.attacker.io")).toBe(false)
  })

  it("rejects arbitrary third-party origins", () => {
    expect(isAllowedEmbedParent("https://example.com")).toBe(false)
    expect(isAllowedEmbedParent("null")).toBe(false)
    expect(isAllowedEmbedParent("")).toBe(false)
  })

  // They serve stored files (uploads and run outputs), not a Nodaro surface:
  // a page there is never a parent that may hand over a session.
  it("rejects the hosts that serve stored files, on any port", () => {
    expect(isAllowedEmbedParent("https://cdn.nodaro.ai")).toBe(false)
    expect(isAllowedEmbedParent("https://assets.nodaro.ai")).toBe(false)
    expect(isAllowedEmbedParent("https://cdn.nodaro.ai:8443")).toBe(false)
    expect(isAllowedEmbedParent("https://CDN.nodaro.ai")).toBe(false)
  })

  it("allows localhost only when allowLocalhost is set (dev)", () => {
    expect(isAllowedEmbedParent("http://localhost:5174", { allowLocalhost: true })).toBe(true)
    expect(isAllowedEmbedParent("http://127.0.0.1:3000", { allowLocalhost: true })).toBe(true)
    expect(isAllowedEmbedParent("http://localhost:5174", { allowLocalhost: false })).toBe(false)
  })
})

// A product served from the same site as this app (a white-label deployment
// that serves every product from one host) frames an account page.
describe("isAllowedEmbedParent — this page's own origin", () => {
  const own = { selfOrigin: "https://studio.example.org", allowLocalhost: false }

  it("trusts a parent on this page's own https origin", () => {
    expect(isAllowedEmbedParent("https://studio.example.org", own)).toBe(true)
    expect(isAllowedEmbedParent("https://STUDIO.example.org:443", own)).toBe(true)
  })

  it("trusts no other origin on the same site: another host, port or scheme", () => {
    expect(isAllowedEmbedParent("https://other.example.org", own)).toBe(false)
    expect(isAllowedEmbedParent("https://example.org", own)).toBe(false)
    expect(isAllowedEmbedParent("https://studio.example.org:8443", own)).toBe(false)
    expect(isAllowedEmbedParent("http://studio.example.org", own)).toBe(false)
    expect(isAllowedEmbedParent("https://studio.example.org.evil.com", own)).toBe(false)
  })

  it("never over plain http, whatever this page's own origin", () => {
    expect(isAllowedEmbedParent("http://studio.example.org", { selfOrigin: "http://studio.example.org", allowLocalhost: false })).toBe(false)
  })

  it("leaves Nodaro's rule exactly as it was", () => {
    const fromNodaro = { selfOrigin: "https://app.nodaro.ai", allowLocalhost: false }
    expect(isAllowedEmbedParent("https://studio.nodaro.ai", fromNodaro)).toBe(true)
    expect(isAllowedEmbedParent("https://app.nodaro.ai", fromNodaro)).toBe(true)
    expect(isAllowedEmbedParent("https://example.com", fromNodaro)).toBe(false)
    expect(isAllowedEmbedParent("https://nodaro.ai.evil.com", fromNodaro)).toBe(false)
    expect(isAllowedEmbedParent("http://studio.nodaro.ai", fromNodaro)).toBe(false)
    // A stored-file host stays refused, even as its own page's parent.
    expect(isAllowedEmbedParent("https://cdn.nodaro.ai", { selfOrigin: "https://cdn.nodaro.ai", allowLocalhost: false })).toBe(false)
    expect(isAllowedEmbedParent("https://assets.nodaro.ai", { selfOrigin: "https://assets.nodaro.ai", allowLocalhost: false })).toBe(false)
  })

  it("an opaque or missing own origin trusts nothing more", () => {
    expect(isAllowedEmbedParent("https://studio.example.org", { selfOrigin: "null", allowLocalhost: false })).toBe(false)
    expect(isAllowedEmbedParent("https://studio.example.org", { selfOrigin: "", allowLocalhost: false })).toBe(false)
    expect(isAllowedEmbedParent("null", { selfOrigin: "null", allowLocalhost: false })).toBe(false)
  })

  it("trusts no own origin it was not given (the rule before this clause)", () => {
    expect(isAllowedEmbedParent("https://studio.example.org", { allowLocalhost: false })).toBe(false)
  })

  it("takes the hand-over from the framing page on that origin", () => {
    const parent = { name: "the framing page" }
    const handOver = { type: "nodaro:setSession", access_token: "access-1", refresh_token: "refresh-1" }
    expect(classifyEmbedSessionMessage({ data: handOver, origin: "https://studio.example.org", source: parent }, parent, own)).toEqual({
      kind: "session",
      accessToken: "access-1",
      refreshToken: "refresh-1",
    })
    expect(classifyEmbedSessionMessage({ data: { type: "nodaro:noSession" }, origin: "https://studio.example.org", source: parent }, parent, own)).toEqual({
      kind: "no-session",
    })
    // Still only from the parent itself.
    expect(classifyEmbedSessionMessage({ data: handOver, origin: "https://studio.example.org", source: { name: "a sibling" } }, parent, own)).toEqual({
      kind: "ignore",
    })
  })
})

describe("classifyEmbedSessionMessage", () => {
  const parent = { name: "the framing page" }
  const handOver = { type: "nodaro:setSession", access_token: "access-1", refresh_token: "refresh-1" }
  const from = (data: unknown, source: unknown = parent, origin = "https://studio.nodaro.ai") =>
    classifyEmbedSessionMessage({ data, origin, source }, parent, { allowLocalhost: false })

  it("reads the parent's hand-over and its word that it has no session", () => {
    expect(from(handOver)).toEqual({ kind: "session", accessToken: "access-1", refreshToken: "refresh-1" })
    expect(from({ type: "nodaro:noSession" })).toEqual({ kind: "no-session" })
  })

  it("ignores everything when there is no parent to hear from", () => {
    expect(classifyEmbedSessionMessage({ data: handOver, origin: "https://studio.nodaro.ai", source: null }, null)).toEqual({
      kind: "ignore",
    })
  })

  it("ignores a sibling frame, a stored-file host and an unexpected shape", () => {
    expect(from(handOver, { name: "a sibling frame" })).toEqual({ kind: "ignore" })
    expect(from(handOver, parent, "https://cdn.nodaro.ai")).toEqual({ kind: "ignore" })
    expect(from(["nodaro:setSession"])).toEqual({ kind: "ignore" })
    expect(from({ ...handOver, refresh_token: "" })).toEqual({ kind: "ignore" })
  })
})
