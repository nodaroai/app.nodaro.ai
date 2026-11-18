import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { ConfettiBurst, makePieces } from "../confetti-burst"

describe("the confetti burst", () => {
  it("starts every piece above the page, around its middle", () => {
    const pieces = makePieces(1000, () => 0.5)
    expect(pieces.length).toBeGreaterThan(50)
    expect(pieces.every((p) => p.y < 0 && p.x === 500)).toBe(true)
  })

  it("draws on a canvas that never takes the pointer", () => {
    render(<ConfettiBurst fire={null} />)
    const canvas = document.body.querySelector("canvas")
    expect(canvas?.className).toContain("pointer-events-none")
    expect(canvas?.getAttribute("aria-hidden")).toBe("true")
  })
})
