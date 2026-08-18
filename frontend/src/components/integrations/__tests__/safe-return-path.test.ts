import { describe, it, expect } from "vitest"
import { isSafeReturnPath } from "../nodaro-cloud-card"

/**
 * The post-connect destination is read back out of localStorage and handed to
 * `location.replace`. Anything that can leave the origin is an open redirect,
 * so the guard is the security boundary — not a formatting nicety (#771 review).
 */
describe("isSafeReturnPath", () => {
  it("accepts an in-app path", () => {
    expect(isSafeReturnPath("/projects/abc/workflows/def")).toBe(true)
  })

  it("accepts a path with a query string", () => {
    expect(isSafeReturnPath("/projects/abc?tab=editor")).toBe(true)
  })

  it("rejects the backslash spelling of protocol-relative — browsers normalize \\ to /", () => {
    expect(isSafeReturnPath("/\\evil.example")).toBe(false)
    expect(isSafeReturnPath("/\\/evil.example")).toBe(false)
  })

  it("rejects a protocol-relative URL — location.replace would leave the origin", () => {
    expect(isSafeReturnPath("//evil.example")).toBe(false)
  })

  it("rejects an absolute URL", () => {
    expect(isSafeReturnPath("https://evil.example/steal")).toBe(false)
  })

  it("rejects a scheme-bearing value that is not http", () => {
    expect(isSafeReturnPath("javascript:alert(1)")).toBe(false)
  })

  it("rejects a bare relative path with no leading slash", () => {
    expect(isSafeReturnPath("projects/abc")).toBe(false)
  })

  it("rejects null and empty", () => {
    expect(isSafeReturnPath(null)).toBe(false)
    expect(isSafeReturnPath("")).toBe(false)
  })
})
