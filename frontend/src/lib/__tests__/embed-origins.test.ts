import { describe, it, expect } from "vitest"
import { isAllowedEmbedParent } from "../embed-origins"

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

  it("allows localhost only when allowLocalhost is set (dev)", () => {
    expect(isAllowedEmbedParent("http://localhost:5174", { allowLocalhost: true })).toBe(true)
    expect(isAllowedEmbedParent("http://127.0.0.1:3000", { allowLocalhost: true })).toBe(true)
    expect(isAllowedEmbedParent("http://localhost:5174", { allowLocalhost: false })).toBe(false)
  })
})
