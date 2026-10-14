import { describe, it, expect } from "vitest"
import { usdToCredits } from "@nodaro/shared/credits"

/**
 * Characterizes WHY `usdToCredits` carries a milli-credit rounding guard, and
 * why that guard must survive any change to CREDIT_BASE_USD.
 *
 * Lives in backend/ rather than packages/shared/ because it reasons about
 * candidate credit bases — pricing strategy, which must not ship inside a
 * published npm artifact (`tools/check-pricing-leaks.mjs` enforces that).
 */
const bare = (u: number, base: number) => Math.ceil(u / base)
const guarded = (u: number, base: number) => Math.ceil(Math.round((u / base) * 1000) / 1000)

function countDivergences(base: number, maxUsd: number): number {
  let n = 0
  for (let i = 1; i <= maxUsd * 1000; i++) {
    const u = i / 1000
    if (bare(u, base) !== guarded(u, base)) n++
  }
  return n
}

describe("credit base float safety", () => {
  it("diverges at the current base — the guard is doing work today", () => {
    expect(countDivergences(0.02, 5)).toBe(10)
    expect(usdToCredits(0.14)).toBe(70)
    expect(bare(0.14, 0.02)).toBe(8) // what an unguarded conversion would charge
  })

  it("a finer base does not remove the problem, it relocates it", () => {
    // The pitfall this test exists to prevent: a narrow sweep concluding a
    // finer base is "strictly safer" and the guard therefore removable. A
    // 10x-finer base is clean below ~$8 and then diverges above it.
    const finer = 0.002
    expect(countDivergences(finer, 5)).toBe(0)
    expect(countDivergences(finer, 10)).toBeGreaterThan(0)
    expect(countDivergences(finer, 20)).toBeGreaterThan(countDivergences(0.02, 20))
  })

  it("never charges more than an exact conversion would", () => {
    for (const base of [0.02, 0.002]) {
      for (let i = 1; i <= 5000; i++) {
        const u = i / 1000
        expect(guarded(u, base)).toBeLessThanOrEqual(bare(u, base))
      }
    }
  })
})
