import { describe, it, expect, beforeEach, vi } from "vitest"
import { getStickyPersonPickerMode, setStickyPersonPickerMode } from "../parameter-node-prefs"

describe("sticky person-picker mode", () => {
  beforeEach(() => { try { window.localStorage.clear() } catch { /* ignore */ } })

  it("defaults to compact when unset", () => {
    expect(getStickyPersonPickerMode()).toBe("compact")
  })
  it("round-trips detailed", () => {
    setStickyPersonPickerMode("detailed")
    expect(getStickyPersonPickerMode()).toBe("detailed")
  })
  it("returns compact for an unknown stored value", () => {
    window.localStorage.setItem("nodaro:person-picker-mode", "garbage")
    expect(getStickyPersonPickerMode()).toBe("compact")
  })
  it("swallows a throwing localStorage and returns the default", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError") })
    expect(getStickyPersonPickerMode()).toBe("compact")
    spy.mockRestore()
  })
  it("swallows a throwing setItem (no throw)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SecurityError") })
    expect(() => setStickyPersonPickerMode("detailed")).not.toThrow()
    spy.mockRestore()
  })
})
