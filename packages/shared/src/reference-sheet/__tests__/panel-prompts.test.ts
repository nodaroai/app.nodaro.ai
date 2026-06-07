import { describe, it, expect } from "vitest"
import { buildPanelPrompt } from "../panel-prompts.js"

describe("buildPanelPrompt", () => {
  it("builds a detail close-up prompt for a character eye variant", () => {
    const p = buildPanelPrompt("character", "detail", "eyes", "Kaia")
    expect(p.toLowerCase()).toContain("close-up")
    expect(p).toContain("eyes")
  })
  it("builds a wardrobe prompt for a character outfit variant", () => {
    const p = buildPanelPrompt("character", "wardrobe", "sporty", "Kaia")
    expect(p.toLowerCase()).toContain("outfit")
  })
  it("returns a generic prompt for unknown board (custom passthrough)", () => {
    expect(buildPanelPrompt("character", "detail", "left ear", "Kaia")).toContain("left ear")
  })
})
