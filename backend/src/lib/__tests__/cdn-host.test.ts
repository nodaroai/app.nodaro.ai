import { describe, it, expect } from "vitest"
import { isOurCdnUrl } from "../cdn-host.js"

const PUB = "https://pub-abc.r2.dev"
const FALLBACK = "assets.example.com"

describe("isOurCdnUrl", () => {
  it("accepts a URL on the R2_PUBLIC_URL origin", () => {
    expect(isOurCdnUrl("https://pub-abc.r2.dev/logos/x.png", PUB, "")).toBe(true)
  })
  it("accepts a URL on the exact fallback host", () => {
    expect(isOurCdnUrl("https://assets.example.com/x.png", "", FALLBACK)).toBe(true)
  })
  it("rejects an external host", () => {
    expect(isOurCdnUrl("https://evil.com/x.png", PUB, FALLBACK)).toBe(false)
  })
  it("rejects a prefix-spoof subdomain", () => {
    expect(isOurCdnUrl("https://pub-abc.r2.dev.evil.com/x.png", PUB, "")).toBe(false)
  })
  it("rejects a userinfo spoof", () => {
    expect(isOurCdnUrl("https://pub-abc.r2.dev@evil.com/x.png", PUB, "")).toBe(false)
  })
  it("rejects non-https (origin includes scheme)", () => {
    expect(isOurCdnUrl("http://pub-abc.r2.dev/x.png", PUB, "")).toBe(false)
  })
  it("rejects a bare r2.dev bucket that is not ours (exact host, not suffix)", () => {
    expect(isOurCdnUrl("https://pub-evil.r2.dev/x.png", PUB, "")).toBe(false)
  })
  it("rejects everything when config is unset", () => {
    expect(isOurCdnUrl("https://pub-abc.r2.dev/x.png", "", "")).toBe(false)
  })
  it("rejects a non-URL string", () => {
    expect(isOurCdnUrl("not a url", PUB, "")).toBe(false)
  })
})
