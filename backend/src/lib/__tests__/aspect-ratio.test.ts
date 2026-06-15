import { describe, it, expect } from "vitest"
import { clampAspectRatioToModel } from "../aspect-ratio.js"

// Character/entity smart-defaults pick framing by asset type (portrait → "3:4",
// poses → "9:16", …) without knowing which model will run. Not every model
// supports every ratio: Grok exposes ["1:1","16:9","9:16","3:2","2:3"] and has
// NO "3:4", so an un-clamped "3:4" gets silently dropped/defaulted by KIE.
// clampAspectRatioToModel maps the desired ratio to the catalog-nearest one the
// model actually supports — data-driven, so it stays correct for any model.

describe("clampAspectRatioToModel", () => {
  it("clamps an unsupported ratio to the catalog-nearest one (Grok: 3:4 → 2:3)", () => {
    // 3:4 = 0.75. Grok's nearest is 2:3 (0.667, Δ0.083) — closer than 9:16
    // (0.5625, Δ0.188) or 1:1 (1.0, Δ0.25).
    expect(clampAspectRatioToModel("3:4", "grok")).toBe("2:3")
  })

  it("clamps for any model missing the ratio, not just Grok (gpt-image: 3:4 → 2:3)", () => {
    // gpt-image supports only ["1:1","3:2","2:3"] — proves the fix is
    // capability-driven, not a hardcoded Grok special-case.
    expect(clampAspectRatioToModel("3:4", "gpt-image")).toBe("2:3")
  })

  it("leaves a supported ratio unchanged (Flux supports 3:4)", () => {
    expect(clampAspectRatioToModel("3:4", "flux")).toBe("3:4")
  })

  it("leaves the default character model's portrait ratio unchanged (nano-banana supports 3:4)", () => {
    // nano-banana is the route default — the common path must stay a no-op.
    expect(clampAspectRatioToModel("3:4", "nano-banana")).toBe("3:4")
  })

  it("returns ratios Grok already supports verbatim", () => {
    expect(clampAspectRatioToModel("1:1", "grok")).toBe("1:1")
    expect(clampAspectRatioToModel("9:16", "grok")).toBe("9:16")
    expect(clampAspectRatioToModel("16:9", "grok")).toBe("16:9")
  })

  it("leaves the ratio unchanged for an unknown model id", () => {
    expect(clampAspectRatioToModel("3:4", "does-not-exist")).toBe("3:4")
  })

  it("leaves the ratio unchanged when no model id is given", () => {
    expect(clampAspectRatioToModel("3:4", undefined)).toBe("3:4")
  })

  it("passes through undefined / empty ratio without crashing", () => {
    expect(clampAspectRatioToModel(undefined, "grok")).toBeUndefined()
    expect(clampAspectRatioToModel("", "grok")).toBe("")
  })
})
