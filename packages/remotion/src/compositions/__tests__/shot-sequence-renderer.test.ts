import { describe, it, expect } from "vitest"
import { computeRevealOpacity } from "../shot-sequence-renderer.js"

describe("computeRevealOpacity", () => {
  it("multiplies base × enter × exit", () => {
    expect(computeRevealOpacity(0.8, 0.5, 1)).toBeCloseTo(0.4)
  })
  it("defaults base to 1 when undefined", () => {
    expect(computeRevealOpacity(undefined, 0.5, 1)).toBeCloseTo(0.5)
  })
  it("a fully exited reveal is invisible", () => {
    expect(computeRevealOpacity(1, 1, 0)).toBe(0)
  })
})
