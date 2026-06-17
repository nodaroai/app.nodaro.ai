// frontend/src/lib/__tests__/bool-pref.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { makeBoolPref } from "../bool-pref"

describe("makeBoolPref", () => {
  beforeEach(() => localStorage.clear())

  it("returns the default when the key is unset", () => {
    expect(makeBoolPref("k:on", true).get()).toBe(true)
    expect(makeBoolPref("k:off", false).get()).toBe(false)
  })

  it("reads '1' as true and '0' as false", () => {
    const pref = makeBoolPref("k:x", false)
    pref.set(true)
    expect(localStorage.getItem("k:x")).toBe("1")
    expect(pref.get()).toBe(true)
    pref.set(false)
    expect(localStorage.getItem("k:x")).toBe("0")
    expect(pref.get()).toBe(false)
  })

  it("treats any non-'1' stored value as false", () => {
    localStorage.setItem("k:y", "true")
    expect(makeBoolPref("k:y", true).get()).toBe(false)
  })
})
