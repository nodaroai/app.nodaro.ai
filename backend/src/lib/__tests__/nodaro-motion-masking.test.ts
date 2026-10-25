import { describe, expect, it } from "vitest"
import { NODARO_MOTION_MASKING_KEY, nodaroMotionMaskingSchema, parseNodaroMotionMasking } from "../nodaro-motion-masking.js"

/**
 * The stored `nodaro_motion_masking` row: read tolerantly (each engine's entry
 * on its own, an invalid one dropped and logged), written strictly (the admin
 * route refuses what the reader would drop).
 */
describe("parseNodaroMotionMasking", () => {
  const collect = () => {
    const warnings: string[] = []
    return { warnings, warn: (m: string) => warnings.push(m) }
  }

  it("is keyed by app_settings row nodaro_motion_masking", () => {
    expect(NODARO_MOTION_MASKING_KEY).toBe("nodaro_motion_masking")
  })

  it("reads no row, or a row that is not an object, as never saved", () => {
    const { warnings, warn } = collect()
    expect(parseNodaroMotionMasking(undefined, warn)).toBeNull()
    expect(parseNodaroMotionMasking(null, warn)).toBeNull()
    expect(warnings).toEqual([])
    for (const v of ["off", 3, [], true]) expect(parseNodaroMotionMasking(v, warn), JSON.stringify(v)).toBeNull()
    expect(warnings).toHaveLength(4)
  })

  it("keeps each valid engine setting as given, zone left out included", () => {
    const value = {
      "motion-pro": { mode: "auto", fill: "depth", minFaceHeightPct: 10, zone: null },
      "motion-lite": { mode: "always", target: "face", blurStrengthPct: 3 },
    }
    const { warnings, warn } = collect()
    expect(parseNodaroMotionMasking(value, warn)).toEqual(value)
    expect(warnings).toEqual([])
    expect(parseNodaroMotionMasking({}, warn)).toEqual({})
  })

  it("drops an invalid engine setting, or an unknown engine, with a warning, and keeps the rest", () => {
    const { warnings, warn } = collect()
    const got = parseNodaroMotionMasking(
      {
        "motion-pro": { mode: "always", threshold: 2 },
        "motion-lite": { mode: "off" },
        "seedance-2-5": { mode: "always" },
        "motion-max": { mode: "always" },
      },
      warn,
    )
    expect(got).toEqual({ "motion-lite": { mode: "off" } })
    expect(warnings).toHaveLength(3)
    expect(warnings.join("\n")).toMatch(/motion-pro/)
    expect(warnings.join("\n")).toMatch(/seedance-2-5/)
  })

  it("refuses a misspelt key inside a setting, as every faceMasking does (strict)", () => {
    const { warn } = collect()
    expect(parseNodaroMotionMasking({ "motion-pro": { mode: "auto", tresh: 0.4 } }, warn)).toEqual({})
  })
})

describe("nodaroMotionMaskingSchema (the admin write)", () => {
  it("takes either engine, both or neither", () => {
    for (const v of [{}, { "motion-pro": { mode: "auto" } }, { "motion-pro": { mode: "off" }, "motion-lite": { mode: "always", fill: "blur" } }]) {
      expect(nodaroMotionMaskingSchema.safeParse(v).success, JSON.stringify(v)).toBe(true)
    }
  })

  it("refuses an unknown engine, an internal id, or a setting out of range", () => {
    for (const v of [
      { "motion-max": { mode: "auto" } },
      { "kling-4": { mode: "auto" } },
      { "motion-pro": { mode: "sometimes" } },
      { "motion-lite": { mode: "auto", minFaceHeightPct: 30, maxFaceHeightPct: 20 } },
      { "motion-pro": { mode: "auto", zone: { leftPct: 50 } } },
      null,
      [],
    ]) {
      expect(nodaroMotionMaskingSchema.safeParse(v).success, JSON.stringify(v)).toBe(false)
    }
  })
})
