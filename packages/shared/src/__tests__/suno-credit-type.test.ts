import { describe, it, expect } from "vitest"
import {
  sunoCreditType,
  SUNO_VERSION_PRICED_OPERATIONS,
  SUNO_SELECT_OPERATIONS,
  SUNO_MODELS,
} from "../index.js"

describe("sunoCreditType — the ONE implementation of the Suno route pricing contract", () => {
  it("prices generate/cover/extend by model version", () => {
    expect(sunoCreditType("V5_5", "suno-generate")).toBe("suno-v5_5")
    expect(sunoCreditType("V5", "suno-cover")).toBe("suno-v5")
    expect(sunoCreditType("V5_5", "suno-extend")).toBe("suno-v5_5")
  })

  it("falls back to the operation key for versions with no dedicated price", () => {
    expect(sunoCreditType("V4", "suno-generate")).toBe("suno-generate")
    expect(sunoCreditType("V4_5ALL", "suno-cover")).toBe("suno-cover")
    expect(sunoCreditType(undefined, "suno-extend")).toBe("suno-extend")
  })

  // The reason this function is gated rather than a bare version map: these four
  // routes charge a FLAT per-operation key no matter which version the node
  // carries (routes/suno.ts:648, :852, :907, :1016). A quote of "suno-v5_5" for
  // one of them is a key the route never charges.
  it.each([
    "suno-mashup",
    "suno-add-instrumental",
    "suno-add-vocals",
    "suno-upload-extend",
  ])("keeps the flat operation key for %s regardless of version", (operation) => {
    for (const model of SUNO_MODELS) {
      expect(sunoCreditType(model, operation)).toBe(operation)
    }
    expect(sunoCreditType(undefined, operation)).toBe(operation)
  })

  it("returns an unknown operation unchanged (never invents a key)", () => {
    expect(sunoCreditType("V5", "suno-voice")).toBe("suno-voice")
    expect(sunoCreditType("V5_5", "not-a-suno-op")).toBe("not-a-suno-op")
  })

  it("exports exactly the three version-priced operations", () => {
    expect([...SUNO_VERSION_PRICED_OPERATIONS]).toEqual([
      "suno-generate",
      "suno-cover",
      "suno-extend",
    ])
  })

  it("exports exactly the seven select operations", () => {
    expect(SUNO_SELECT_OPERATIONS.length).toBe(7)
  })
})
