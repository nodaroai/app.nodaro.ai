import { describe, it, expect, beforeEach } from "vitest"
import { getAutoConnectPref, setAutoConnectPref, AUTO_CONNECT_KEY } from "../auto-connect-pref"

describe("auto-connect-pref", () => {
  beforeEach(() => localStorage.clear())

  it("defaults to ON when unset", () => {
    expect(getAutoConnectPref()).toBe(true)
  })

  it("round-trips false", () => {
    setAutoConnectPref(false)
    expect(getAutoConnectPref()).toBe(false)
    expect(localStorage.getItem(AUTO_CONNECT_KEY)).toBe("0")
  })

  it("round-trips true", () => {
    setAutoConnectPref(false)
    setAutoConnectPref(true)
    expect(getAutoConnectPref()).toBe(true)
    expect(localStorage.getItem(AUTO_CONNECT_KEY)).toBe("1")
  })
})
