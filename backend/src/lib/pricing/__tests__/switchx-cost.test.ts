import { describe, it, expect } from "vitest"
import { SWITCHX_BLOCK_FRAMES, usdToCredits } from "@nodaro/shared"
import { switchXHoldCredits, SWITCHX_BLOCK_USD } from "../switchx-cost.js"

describe("switchXHoldCredits", () => {
  it("holds base block credits: 15/block @1080p, 5/block @720p", () => {
    expect(switchXHoldCredits(30, 1080)).toBe(150) // 1 block
    expect(switchXHoldCredits(30, 720)).toBe(50)
    expect(switchXHoldCredits(150, 1080)).toBe(750) // 5 blocks (a ~5s clip)
    expect(switchXHoldCredits(240, 1080)).toBe(1200) // 8 blocks (worst case)
    expect(switchXHoldCredits(240, 720)).toBe(400)
  })
  it("hold credits are monotonic in frames and resolution", () => {
    expect(switchXHoldCredits(48, 1080)).toBeGreaterThan(switchXHoldCredits(48, 720))
    expect(switchXHoldCredits(240, 1080)).toBeGreaterThan(switchXHoldCredits(48, 1080))
  })
})

describe("switchXHoldCredits — derived from the recorded $/block rate", () => {
  it("exposes the Beeble $/block rate the credits derive from", () => {
    expect(SWITCHX_BLOCK_USD[720]).toBeCloseTo(0.10, 10)
    expect(SWITCHX_BLOCK_USD[1080]).toBeCloseTo(0.30, 10)
  })

  it("reproduces the shipped per-block credit values from the USD rate", () => {
    // Guards the re-denomination: if the $/block rate and CREDIT_BASE_USD ever
    // disagree with the shipped credit values, this fails rather than silently
    // repricing the provider.
    expect(switchXHoldCredits(SWITCHX_BLOCK_FRAMES, 720)).toBe(usdToCredits(SWITCHX_BLOCK_USD[720]))
    expect(switchXHoldCredits(SWITCHX_BLOCK_FRAMES, 1080)).toBe(usdToCredits(SWITCHX_BLOCK_USD[1080]))
  })

  it("scales linearly across every frame tier", () => {
    let compared = 0
    for (const blocks of [1, 2, 3, 4, 5, 8]) {
      const frames = blocks * SWITCHX_BLOCK_FRAMES
      for (const res of [720, 1080] as const) {
        expect(switchXHoldCredits(frames, res)).toBe(usdToCredits(blocks * SWITCHX_BLOCK_USD[res]))
        compared++
      }
    }
    expect(compared).toBe(12)
  })
})
