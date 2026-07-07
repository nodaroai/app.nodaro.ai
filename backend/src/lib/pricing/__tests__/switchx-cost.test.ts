import { describe, it, expect } from "vitest"
import { switchXHoldCredits } from "../switchx-cost.js"

describe("switchXHoldCredits", () => {
  it("holds at-cost block credits: 15/block @1080p, 5/block @720p", () => {
    expect(switchXHoldCredits(30, 1080)).toBe(15) // 1 block
    expect(switchXHoldCredits(30, 720)).toBe(5)
    expect(switchXHoldCredits(150, 1080)).toBe(75) // 5 blocks (a ~5s clip)
    expect(switchXHoldCredits(240, 1080)).toBe(120) // 8 blocks (worst case)
    expect(switchXHoldCredits(240, 720)).toBe(40)
  })
  it("hold credits are monotonic in frames and resolution", () => {
    expect(switchXHoldCredits(48, 1080)).toBeGreaterThan(switchXHoldCredits(48, 720))
    expect(switchXHoldCredits(240, 1080)).toBeGreaterThan(switchXHoldCredits(48, 1080))
  })
})
