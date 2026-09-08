import { describe, it, expect } from "vitest"
import { isOpenableLink, qrLinkLabel, textLayerLabel } from "../image-overlay-labels"

describe("qrLinkLabel", () => {
  it("shows the host (and path) of a URL, never the scheme", () => {
    expect(qrLinkLabel("https://nodaro.ai")).toBe("nodaro.ai")
    expect(qrLinkLabel("https://nodaro.ai/pricing?x=1")).toBe("nodaro.ai/pricing")
  })
  it("keeps plain text as is, trimmed to the limit", () => {
    expect(qrLinkLabel("  WIFI:S:home;;  ")).toBe("WIFI:S:home;;")
    expect(qrLinkLabel("x".repeat(40), 10)).toBe("xxxxxxxxx…")
    expect(qrLinkLabel(undefined)).toBe("")
  })
})

describe("isOpenableLink", () => {
  it("is true only for http(s) URLs", () => {
    expect(isOpenableLink("https://nodaro.ai")).toBe(true)
    expect(isOpenableLink("mailto:a@b.c")).toBe(false)
    expect(isOpenableLink("hello")).toBe(false)
  })
})

describe("textLayerLabel", () => {
  it("takes the first line", () => {
    expect(textLayerLabel("Big\nsale")).toBe("Big")
  })
})
