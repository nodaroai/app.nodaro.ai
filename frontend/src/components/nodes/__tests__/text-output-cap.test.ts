import { describe, it, expect } from "vitest"
import { MAX_OUTPUT_HEIGHT, MAX_OUTPUT_LINES, shouldCapOutput } from "../text-output-cap"

describe("text-output-cap", () => {
  it("derives the cap height from the line count (≈10 lines)", () => {
    expect(MAX_OUTPUT_LINES).toBe(10)
    // ~22.75px/line (text-sm × leading-relaxed) + ~14px block padding.
    expect(MAX_OUTPUT_HEIGHT).toBeGreaterThan(220)
    expect(MAX_OUTPUT_HEIGHT).toBeLessThan(260)
  })

  describe("shouldCapOutput", () => {
    it("caps in auto mode once content exceeds the max (→ scroll instead of grow)", () => {
      expect(shouldCapOutput(MAX_OUTPUT_HEIGHT + 50, false)).toBe(true)
    })

    it("does NOT cap in auto mode while content still fits (→ grow to fit)", () => {
      expect(shouldCapOutput(MAX_OUTPUT_HEIGHT - 50, false)).toBe(false)
    })

    it("treats exactly-at-max as fitting (no cap)", () => {
      expect(shouldCapOutput(MAX_OUTPUT_HEIGHT, false)).toBe(false)
    })

    it("never caps once the user has manually resized — they own the height", () => {
      expect(shouldCapOutput(MAX_OUTPUT_HEIGHT + 9999, true)).toBe(false)
    })

    it("honors a custom max", () => {
      expect(shouldCapOutput(120, false, 100)).toBe(true)
      expect(shouldCapOutput(80, false, 100)).toBe(false)
    })
  })
})
