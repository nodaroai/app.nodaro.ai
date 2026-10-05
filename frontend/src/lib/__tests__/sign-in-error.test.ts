import { describe, expect, it } from "vitest"
import { isBlockedCallback, isBlockedSignIn } from "../sign-in-error"

describe("isBlockedSignIn", () => {
  it("is true for GoTrue's user_banned code on the error object", () => {
    expect(isBlockedSignIn(Object.assign(new Error("User is banned"), { code: "user_banned" }))).toBe(true)
    expect(isBlockedSignIn({ code: "user_banned" })).toBe(true)
  })

  it("is false for every other failure", () => {
    expect(isBlockedSignIn(Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials" }))).toBe(
      false,
    )
    // A copy of the message without the code is exactly the bug this guards:
    // the login page could no longer tell a blocked account from a typo.
    expect(isBlockedSignIn(new Error("User is banned"))).toBe(false)
    expect(isBlockedSignIn(null)).toBe(false)
    expect(isBlockedSignIn(undefined)).toBe(false)
    expect(isBlockedSignIn("user_banned")).toBe(false)
  })
})

describe("isBlockedCallback", () => {
  it("reads the code from the query (PKCE flow)", () => {
    expect(isBlockedCallback("?error=access_denied&error_code=user_banned&error_description=User+is+banned", "")).toBe(true)
  })

  it("reads the code from the fragment (implicit flow)", () => {
    expect(isBlockedCallback("", "#error=access_denied&error_code=user_banned")).toBe(true)
  })

  it("ignores other errors and a normal return", () => {
    expect(isBlockedCallback("?error=access_denied&error_code=bad_oauth_state", "")).toBe(false)
    expect(isBlockedCallback("?code=abc", "")).toBe(false)
    expect(isBlockedCallback("", "#access_token=x&refresh_token=y")).toBe(false)
    expect(isBlockedCallback("", "")).toBe(false)
  })
})
