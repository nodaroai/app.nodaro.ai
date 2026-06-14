import { describe, it, expect } from "vitest"
import { VIEW_MODES, ALL_VIEW_MODES } from "../view-mode-selector"

describe("view-mode registry", () => {
  it("includes chat in the union-derived list and registry", () => {
    expect(ALL_VIEW_MODES).toContain("chat")
    expect(VIEW_MODES.find((m) => m.mode === "chat")?.label).toBeTruthy()
  })
})
