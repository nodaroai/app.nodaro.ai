// @test-units-by-name looks up only the seedance-2-5 4K credit rows it names
import { describe, it, expect } from "vitest"
import { buildVideoCreditModelIdentifier, seedanceExtendRateCreditId } from "@nodaro/shared/credits"
import { STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * Seedance 2.5 at 4K (prices decided 2026-11-22): one row per second 4–30 s,
 * each with its `-ref` twin, by the model's rule `ceil(rate × seconds / 4) × 10`
 * at KIE's 4K rates (251 a second, 155 with a reference video); Extend's 4K
 * row is two seconds at the 4K reference rate.
 */
const rule = (rate: number, sec: number) => Math.ceil((rate * sec) / 4) * 10

describe("seedance-2-5 4K credit rows", () => {
  it("has one plain and one -ref row per second, 4–30 s, by the model's rule", () => {
    for (let sec = 4; sec <= 30; sec++) {
      expect(STATIC_CREDIT_COSTS[`seedance-2-5:${sec}s:4k`], `${sec}s`).toBe(rule(251, sec))
      expect(STATIC_CREDIT_COSTS[`seedance-2-5:${sec}s:4k-ref`], `${sec}s ref`).toBe(rule(155, sec))
    }
  })

  it("matches the decided anchors", () => {
    expect([4, 8, 10, 30].map((s) => STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:4k`])).toEqual([2510, 5020, 6280, 18830])
    expect([4, 8, 10, 30].map((s) => STATIC_CREDIT_COSTS[`seedance-2-5:${s}s:4k-ref`])).toEqual([1550, 3100, 3880, 11630])
  })

  it("a 4K request names its own row at every length, with or without a reference video", () => {
    expect(buildVideoCreditModelIdentifier("seedance-2-5", 4, undefined, undefined, undefined, "4k", false)).toBe("seedance-2-5:4s:4k")
    expect(buildVideoCreditModelIdentifier("seedance-2-5", 17, undefined, undefined, undefined, "4k", true)).toBe("seedance-2-5:17s:4k-ref")
    expect(buildVideoCreditModelIdentifier("seedance-2-5", 30, undefined, undefined, undefined, "4k", false)).toBe("seedance-2-5:30s:4k")
  })

  it("Lip Sync's 8 s 4K row is the plain 8 s row", () => {
    expect(STATIC_CREDIT_COSTS["seedance-2-5:8s:4k"]).toBe(5020)
  })

  it("Extend's 4K row is two seconds at the 4K reference rate", () => {
    expect(seedanceExtendRateCreditId("4k")).toBe("seedance-2-5-extend:4k:per-2s")
    expect(STATIC_CREDIT_COSTS["seedance-2-5-extend:4k:per-2s"]).toBe(775)
    expect(STATIC_CREDIT_COSTS["seedance-2-5-extend:4k:per-2s"]).toBe((STATIC_CREDIT_COSTS["seedance-2-5:8s:4k-ref"]! / 8) * 2)
  })

  it("no other Seedance model gains a 4K row", () => {
    const fourK = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k.startsWith("seedance") && /:4k(-ref)?$|:4k:/.test(k))
    expect(fourK.every((k) => k.startsWith("seedance-2:") || k.startsWith("seedance-2-5:") || k === "seedance-2-5-extend:4k:per-2s"), fourK.join(",")).toBe(true)
  })
})
