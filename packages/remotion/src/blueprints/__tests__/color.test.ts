import { describe, it, expect } from "vitest"
import { readableTextColor } from "../color"

describe("readableTextColor", () => {
  it("returns light text (#f5f5f7) for a black background", () => {
    expect(readableTextColor("#000000")).toBe("#f5f5f7")
  })

  it("returns light text for a dark background (#1a1a2e)", () => {
    expect(readableTextColor("#1a1a2e")).toBe("#f5f5f7")
  })

  it("returns dark text (#0a0a0a) for a white background", () => {
    expect(readableTextColor("#ffffff")).toBe("#0a0a0a")
  })

  it("returns dark text for a near-white background (#f5f5f7)", () => {
    expect(readableTextColor("#f5f5f7")).toBe("#0a0a0a")
  })

  it("returns light text (safe default) for a non-hex input", () => {
    expect(readableTextColor("not-a-hex")).toBe("#f5f5f7")
    expect(readableTextColor("")).toBe("#f5f5f7")
    expect(readableTextColor("rgb(0,0,0)")).toBe("#f5f5f7")
  })

  it("handles 3-digit hex: #fff → dark text", () => {
    expect(readableTextColor("#fff")).toBe("#0a0a0a")
  })

  it("handles 3-digit hex: #000 → light text", () => {
    expect(readableTextColor("#000")).toBe("#f5f5f7")
  })
})
