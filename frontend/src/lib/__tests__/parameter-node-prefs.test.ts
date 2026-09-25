import { describe, it, expect, beforeEach, vi } from "vitest"
import { getStickyPersonPickerMode, setStickyPersonPickerMode } from "../parameter-node-prefs"

describe("sticky person-picker mode", () => {
  beforeEach(() => { try { window.localStorage.clear() } catch { /* ignore */ } })

  it("defaults to detailed (the open view) when unset", () => {
    expect(getStickyPersonPickerMode()).toBe("detailed")
  })
  it("round-trips compact", () => {
    setStickyPersonPickerMode("compact")
    expect(getStickyPersonPickerMode()).toBe("compact")
  })
  it("returns detailed for an unknown stored value", () => {
    window.localStorage.setItem("nodaro:person-picker-view", "garbage")
    expect(getStickyPersonPickerMode()).toBe("detailed")
  })
  it("ignores the retired key, so a device that stored compact there opens on detailed", () => {
    window.localStorage.setItem("nodaro:person-picker-mode", "compact")
    expect(getStickyPersonPickerMode()).toBe("detailed")
  })
  it("swallows a throwing localStorage and returns the default", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError") })
    expect(getStickyPersonPickerMode()).toBe("detailed")
    spy.mockRestore()
  })
  it("swallows a throwing setItem (no throw)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SecurityError") })
    expect(() => setStickyPersonPickerMode("detailed")).not.toThrow()
    spy.mockRestore()
  })
})
