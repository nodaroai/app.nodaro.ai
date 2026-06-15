import { describe, it, expect } from "vitest"
import { buildPersonHints } from "../person.js"

/**
 * Body proportion axes — Frame / Body Mass / Bust / Waist / Hips / Silhouette —
 * replaced the old coarse Build + Body Proportions pickers. These tests pin the
 * prompt-token composition (the part that actually drives generation), the
 * "neutral emits nothing" contract, and the independent-axes guarantee the split
 * exists to provide ("slim frame + full bust" was inexpressible before).
 */
describe("buildPersonHints — body proportion axes", () => {
  it("composes the target example (slim woman, full bust)", () => {
    const hints = buildPersonHints({
      frame: "frame-slim",
      bodyMass: "mass-lean",
      bust: "bust-full",
      waist: "waist-defined",
      silhouette: "silhouette-hourglass",
    })
    expect(hints.join(", ")).toBe(
      "slim, lean build, full bust, defined waist, hourglass silhouette",
    )
  })

  it("emits every axis in canonical order (frame, mass, bust, waist, hips, silhouette)", () => {
    const joined = buildPersonHints({
      frame: "frame-broad",
      bodyMass: "mass-heavy",
      bust: "bust-small",
      waist: "waist-straight",
      hips: "hips-wide",
      silhouette: "silhouette-pear",
    }).join(", ")
    expect(joined).toBe(
      "broad-framed, heavy-set build, small bust, straight waistline, wide hips, pear-shaped silhouette",
    )
  })

  it("neutral values (Average / Balanced) contribute nothing", () => {
    expect(
      buildPersonHints({
        frame: "frame-average",
        bodyMass: "mass-average",
        bust: "bust-average",
        waist: "waist-average",
        hips: "hips-balanced",
      }),
    ).toEqual([])
  })

  it("axes are independent — a slim frame pairs with a full bust (the bug the split fixes)", () => {
    expect(buildPersonHints({ frame: "frame-slim", bust: "bust-full" })).toEqual([
      "slim",
      "full bust",
    ])
  })

  it("Bust:Very Full emits the distinct very-full token", () => {
    expect(buildPersonHints({ bust: "bust-very-full" })).toEqual(["very full bust"])
  })

  it("ignores stored values for the retired Build / Body Proportions keys (no migration)", () => {
    // Old saved workflow data may still carry these now-removed fields; no
    // dimension reads them, so they emit nothing and never crash the picker.
    expect(buildPersonHints({ build: "voluptuous", bodyProportions: "proportions-hourglass" })).toEqual([])
  })
})
