import { describe, it, expect } from "vitest"
import { sunoCreditType } from "../suno-client.js"

describe("sunoCreditType — the single credit-key source shared by route + worker", () => {
  it("maps versions and falls back", () => {
    expect(sunoCreditType("V6", "suno-generate")).toBe("suno-v6")
    expect(sunoCreditType("V6_WILD", "suno-cover")).toBe("suno-v6_wild")
    expect(sunoCreditType("V6_MINI", "suno-extend")).toBe("suno-v6_mini")
    expect(sunoCreditType("V5_5", "suno-generate")).toBe("suno-v5_5")
    expect(sunoCreditType("V5", "suno-cover")).toBe("suno-v5")
    expect(sunoCreditType(undefined, "suno-extend")).toBe("suno-extend")
    expect(sunoCreditType("V4", "suno-generate")).toBe("suno-generate")
  })
})
