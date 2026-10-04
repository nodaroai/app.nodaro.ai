import { describe, it, expect } from "vitest"
import { intersectIntervals, spanIntersect, spanMinus, subtractIntervals, toIntervalSet, unionIntervals } from "../intervals"
import { rngOf } from "./review-fixtures"

const iv = (inMs: number, outMs: number) => ({ inMs, outMs })

describe("interval sets", () => {
  it("canonical form: sorted, empty pieces gone, overlapping AND abutting pieces merged", () => {
    expect(toIntervalSet([iv(50, 60), iv(0, 10), iv(10, 20), iv(15, 30), iv(40, 40), iv(45, 41)])).toEqual([
      iv(0, 30),
      iv(50, 60),
    ])
  })

  it("canonical form copies: the input is never mutated", () => {
    const input = [iv(5, 9), iv(0, 3)]
    const frozen = JSON.stringify(input)
    toIntervalSet(input)
    expect(JSON.stringify(input)).toBe(frozen)
  })

  it("union, difference and intersection", () => {
    const a = toIntervalSet([iv(0, 10), iv(20, 30)])
    const b = toIntervalSet([iv(5, 25)])
    expect(unionIntervals(a, b)).toEqual([iv(0, 30)])
    expect(subtractIntervals(a, b)).toEqual([iv(0, 5), iv(25, 30)])
    expect(intersectIntervals(a, b)).toEqual([iv(5, 10), iv(20, 25)])
  })

  it("a difference that removes a piece exactly leaves nothing behind", () => {
    expect(subtractIntervals([iv(0, 10)], [iv(0, 10)])).toEqual([])
    expect(subtractIntervals([iv(0, 10)], [iv(-5, 20)])).toEqual([])
    expect(subtractIntervals([iv(0, 10)], [])).toEqual([iv(0, 10)])
  })

  it("agree with a point-by-point model on random sets", () => {
    const rng = rngOf(7)
    const randomSet = () =>
      toIntervalSet(Array.from({ length: rng.int(0, 6) }, () => {
        const a = rng.int(0, 60)
        return iv(a, a + rng.int(0, 15))
      }))
    const has = (set: readonly { inMs: number; outMs: number }[], t: number) => set.some((s) => s.inMs <= t && t < s.outMs)
    for (let n = 0; n < 300; n++) {
      const a = randomSet()
      const b = randomSet()
      const u = unionIntervals(a, b)
      const d = subtractIntervals(a, b)
      const x = intersectIntervals(a, b)
      const start = rng.int(0, 60)
      const span = iv(start, start + rng.int(0, 20))
      const inside = spanIntersect(span, b)
      const outside = spanMinus(span, b)
      for (const set of [u, d, x, inside, outside]) expect(toIntervalSet(set)).toEqual(set)
      const inSpan = (t: number) => span.inMs <= t && t < span.outMs
      const wrong: string[] = []
      for (let t = 0; t < 80; t++) {
        if (has(u, t) !== (has(a, t) || has(b, t))) wrong.push(`union at ${t}`)
        if (has(d, t) !== (has(a, t) && !has(b, t))) wrong.push(`difference at ${t}`)
        if (has(x, t) !== (has(a, t) && has(b, t))) wrong.push(`intersection at ${t}`)
        if (has(inside, t) !== (inSpan(t) && has(b, t))) wrong.push(`span ∩ set at ${t}`)
        if (has(outside, t) !== (inSpan(t) && !has(b, t))) wrong.push(`span ∖ set at ${t}`)
      }
      expect(wrong, `case ${n}`).toEqual([])
    }
  })
})
