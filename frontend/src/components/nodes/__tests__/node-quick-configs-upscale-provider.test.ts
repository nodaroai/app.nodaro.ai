/**
 * The Upscale Image quick-strip model pill writes the model AND the same factor
 * patch the config panel writes (`upscaleFactorSnapPatch`): a factor the new
 * model does not take snaps to the one its run renders, and an 8 (only the
 * house model takes it) is cleared from a model with no factor list (Recraft)
 * — so a stale 8 can never reach a run — while any other factor stands. The
 * fail-safe snap calls `write` without data and writes the model alone.
 */
import { describe, it, expect } from "vitest"
import { getQuickConfigs } from "../node-quick-configs"

const control = getQuickConfigs("upscale-image").find((c) => c.field === "provider")!

describe("upscale-image quick-strip model pill", () => {
  it("a Nodaro Image Upscale 8x switched to Recraft keeps no factor", () => {
    const patch = control.write!("recraft-upscale", { provider: "nodaro-image-upscale", upscaleFactor: "8" })
    expect(patch).toEqual({ provider: "recraft-upscale", upscaleFactor: undefined })
    expect("upscaleFactor" in patch).toBe(true)
  })

  it("a Nodaro Image Upscale 8x switched to Topaz snaps to 2", () => {
    expect(control.write!("topaz-image-upscale", { provider: "nodaro-image-upscale", upscaleFactor: "8" })).toStrictEqual({
      provider: "topaz-image-upscale",
      upscaleFactor: "2",
    })
  })

  it("a Recraft node's own 4, moved between models with no factor list, is written as it is: the model alone", () => {
    expect(control.write!("recraft-upscale", { provider: "recraft-upscale", upscaleFactor: "4" })).toStrictEqual({ provider: "recraft-upscale" })
  })

  it("a factor the new model takes, or none stored, writes the model alone", () => {
    expect(control.write!("nodaro-image-upscale", { provider: "topaz-image-upscale", upscaleFactor: "4" })).toStrictEqual({ provider: "nodaro-image-upscale" })
    expect(control.write!("recraft-upscale", { provider: "topaz-image-upscale" })).toStrictEqual({ provider: "recraft-upscale" })
    // The fail-safe snap passes no data.
    expect(control.write!("recraft-upscale")).toStrictEqual({ provider: "recraft-upscale" })
  })
})
