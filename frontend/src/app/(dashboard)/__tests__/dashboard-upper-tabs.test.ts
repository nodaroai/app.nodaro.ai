import { describe, it, expect } from "vitest"
import { UPPER_DASHBOARD_TABS, resolveActiveUpperTab } from "../dashboard-upper-tabs"

describe("resolveActiveUpperTab", () => {
  it("returns the requested tab when the profile leaves it visible", () => {
    expect(resolveActiveUpperTab(["statistics", "tutorials"], "tutorials")).toBe("tutorials")
  })
  it("falls back to the first visible tab when the requested one is hidden", () => {
    expect(resolveActiveUpperTab(["statistics", "tutorials"], "apps")).toBe("statistics")
  })
  it("falls back to the first visible tab when none is requested", () => {
    expect(resolveActiveUpperTab(UPPER_DASHBOARD_TABS, null)).toBe("apps")
  })
  it("returns undefined when the profile hides every upper tab", () => {
    expect(resolveActiveUpperTab([], "apps")).toBeUndefined()
  })
})
