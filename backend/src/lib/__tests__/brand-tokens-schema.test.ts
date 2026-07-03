import { describe, it, expect } from "vitest"
import { brandTokensSchema } from "../plan-schemas.js"
import { BRAND_PRESETS } from "@nodaro/shared"

describe("brandTokensSchema", () => {
  it("accepts a full preset", () => {
    expect(brandTokensSchema.safeParse(BRAND_PRESETS["midnight-violet"]).success).toBe(true)
  })

  it("accepts the minimal shape (palette bg/text/accent + fonts)", () => {
    const min = { palette: { bg: "#000", text: "#fff", accent: "#f00" }, fonts: { heading: "Anton", body: "Inter" } }
    expect(brandTokensSchema.safeParse(min).success).toBe(true)
  })

  it("rejects an unsupported font", () => {
    const bad = { palette: { bg: "#000", text: "#fff", accent: "#f00" }, fonts: { heading: "Comic Sans", body: "Inter" } }
    expect(brandTokensSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects a non-hex palette color", () => {
    const bad = { palette: { bg: "rgb(0,0,0)", text: "#fff", accent: "#f00" }, fonts: { heading: "Anton", body: "Inter" } }
    expect(brandTokensSchema.safeParse(bad).success).toBe(false)
  })
})
