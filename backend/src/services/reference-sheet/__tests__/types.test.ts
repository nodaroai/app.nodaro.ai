import { describe, it, expect } from "vitest"
import { SKIN_TOKENS } from "../types.js"

describe("compositor types", () => {
  it("studio skin tokens are defined with the fields the renderer needs", () => {
    const t = SKIN_TOKENS.studio
    expect(t.bg).toMatch(/^#/)
    expect(t.text).toMatch(/^#/)
    expect(t.fontFamily.length).toBeGreaterThan(0)
  })
})
