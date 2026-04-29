import { describe, it, expect } from "vitest"
import { buildCompositePrompt } from "../prompt-builder-bridge.js"

describe("buildCompositePrompt", () => {
  it("returns prompt as-is when no structured fields", () => {
    expect(buildCompositePrompt("a knight on a beach", undefined)).toBe("a knight on a beach")
    expect(buildCompositePrompt("a knight on a beach", {})).toBe("a knight on a beach")
  })

  it("appends structured fields to the prompt", () => {
    const out = buildCompositePrompt("a knight", { mood: "epic" })
    expect(out).toBe("a knight Mood: epic.")
  })
})
