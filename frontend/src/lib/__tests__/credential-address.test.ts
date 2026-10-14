// @vitest-environment node
import { describe, it, expect } from "vitest"
import { bindingAddressKey, sameBindingAddress } from "../credential-address"

describe("credential-address — the client's copy of what a lock covers", () => {
  it("a lock is origin + path: query, fragment, host case and the default port do not matter", () => {
    expect(sameBindingAddress("https://hooks.example.com/in?token=abc#x", "https://hooks.example.com/in")).toBe(true)
    expect(sameBindingAddress("https://HOOKS.example.com:443/in", "https://hooks.example.com/in")).toBe(true)
    expect(sameBindingAddress("https://hooks.example.com", "https://hooks.example.com/")).toBe(true)
  })

  it("a different path, host, port or scheme is a different address", () => {
    expect(sameBindingAddress("https://hooks.example.com/in/", "https://hooks.example.com/in")).toBe(false)
    expect(sameBindingAddress("https://hooks.example.com/other", "https://hooks.example.com/in")).toBe(false)
    expect(sameBindingAddress("https://hooks.example.com:8443/in", "https://hooks.example.com/in")).toBe(false)
    expect(sameBindingAddress("http://hooks.example.com/in", "https://hooks.example.com/in")).toBe(false)
  })

  it("what the server refuses outright is never 'the same' — userinfo, an encoded separator, a percent sign in the path", () => {
    expect(sameBindingAddress("https://u:p@hooks.example.com/in", "https://hooks.example.com/in")).toBe(false)
    expect(sameBindingAddress("https://hooks.example.com/in/..%2fadmin", "https://hooks.example.com/in/..%2fadmin")).toBe(false)
    expect(sameBindingAddress("https://hooks.example.com/100%25off", "https://hooks.example.com/100%25off")).toBe(false)
    expect(bindingAddressKey("https://user@hooks.example.com/in")).toBeNull()
  })

  it("garbage is never the same as anything, not even itself", () => {
    expect(bindingAddressKey("not a url")).toBeNull()
    expect(bindingAddressKey("")).toBeNull()
    expect(sameBindingAddress("not a url", "not a url")).toBe(false)
  })
})
