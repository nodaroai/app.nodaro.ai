import { describe, it, expect, beforeEach, vi } from "vitest"
import { issueCode, redeemCode, _resetForTest } from "../oauth-codes.js"

beforeEach(() => {
  _resetForTest()
})

describe("oauth-codes", () => {
  it("issues a code and redeems it once", () => {
    const code = issueCode({
      appId: "app-1",
      userId: "user-1",
      scopes: ["workflows:read"],
      redirectUri: "https://example.com/cb",
    })
    expect(code).toMatch(/^ndr_code_[a-f0-9]{48}$/)
    const grant = redeemCode(code, "https://example.com/cb")
    expect(grant).toEqual({
      appId: "app-1",
      userId: "user-1",
      scopes: ["workflows:read"],
      redirectUri: "https://example.com/cb",
    })
  })

  it("redeem fails on second use (one-shot)", () => {
    const code = issueCode({
      appId: "app-1", userId: "u", scopes: [], redirectUri: "x",
    })
    expect(redeemCode(code, "x")).toBeTruthy()
    expect(redeemCode(code, "x")).toBeNull()
  })

  it("redeem fails when redirectUri does not match", () => {
    const code = issueCode({
      appId: "app-1", userId: "u", scopes: [], redirectUri: "https://a.com",
    })
    expect(redeemCode(code, "https://b.com")).toBeNull()
  })

  it("redeem fails after expiry", () => {
    vi.useFakeTimers()
    const code = issueCode({
      appId: "app-1", userId: "u", scopes: [], redirectUri: "x",
    })
    vi.advanceTimersByTime(11 * 60_000)  // 11 minutes
    expect(redeemCode(code, "x")).toBeNull()
    vi.useRealTimers()
  })

  it("redeem fails for unknown code", () => {
    expect(redeemCode("ndr_code_nonexistent", "x")).toBeNull()
  })
})
