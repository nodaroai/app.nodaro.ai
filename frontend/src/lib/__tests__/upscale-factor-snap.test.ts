import { describe, it, expect } from "vitest"
import { upscaleFactorSnapPatch } from "../upscale-factor-snap"

describe("upscaleFactorSnapPatch — what an Upscale Image model switch writes besides the model", () => {
  it("clears an 8 (only the house model takes it) from a model with no factor list (Recraft, or no model, which runs as Recraft)", () => {
    expect(upscaleFactorSnapPatch("recraft-upscale", { upscaleFactor: "8" })).toEqual({ upscaleFactor: undefined })
    expect(upscaleFactorSnapPatch(undefined, { upscaleFactor: "8" })).toEqual({ upscaleFactor: undefined })
  })

  it("leaves a saved Recraft node's own 1/2/4 alone, as it always did", () => {
    for (const f of ["1", "2", "4"]) expect(upscaleFactorSnapPatch("recraft-upscale", { upscaleFactor: f }), f).toBeUndefined()
  })

  it("snaps a factor the model does not take to the one its run renders", () => {
    expect(upscaleFactorSnapPatch("topaz-image-upscale", { upscaleFactor: "8" })).toEqual({ upscaleFactor: "2" })
  })

  it("leaves a factor the model takes, or no factor, alone", () => {
    expect(upscaleFactorSnapPatch("nodaro-image-upscale", { upscaleFactor: "8" })).toBeUndefined()
    expect(upscaleFactorSnapPatch("topaz-image-upscale", { upscaleFactor: "1" })).toBeUndefined()
    expect(upscaleFactorSnapPatch("recraft-upscale", {})).toBeUndefined()
  })
})
