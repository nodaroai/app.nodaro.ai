import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { armAngle, nextCorner, RunMarshal } from "../panel/run-marshal"

describe("the marshal who walks the panel while a run works", () => {
  it("walks the edge of the panel, corner after corner, and back to the start", () => {
    expect(nextCorner("top-start")).toBe("top-end")
    expect(nextCorner("top-end")).toBe("bottom-end")
    expect(nextCorner("bottom-end")).toBe("bottom-start")
    expect(nextCorner("bottom-start")).toBe("top-start")
  })

  it("points the same way when drawn facing left", () => {
    expect(armAngle(35)).toBe(35)
    expect(armAngle(145)).toBe(35)
    expect(armAngle(-145)).toBe(-35)
  })

  it("is only a picture: hidden from readers and never takes the pointer", () => {
    const { container } = render(<RunMarshal />)
    const marshal = container.querySelector("[data-marshal]")
    expect(marshal?.getAttribute("aria-hidden")).toBe("true")
    expect(marshal?.className).toContain("pointer-events-none")
  })
})
