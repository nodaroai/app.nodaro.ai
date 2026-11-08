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
