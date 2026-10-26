import { describe, expect, it } from "vitest"
import { faceMaskingSchema } from "../cast-swap-face-masking.js"
import { NODARO_MOTION_MASKING_KEY, nodaroMotionMaskingSchema, parseNodaroMotionMasking, withEarlierMaskingKeys } from "../nodaro-motion-masking.js"

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
      "motion-prism": { mode: "auto", fill: "depth", minFaceHeightPct: 10, zone: null },
      "motion-pulse": { mode: "always", target: "face", blurStrengthPct: 3 },
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
        "motion-prism": { mode: "always", threshold: 2 },
        "motion-pulse": { mode: "off" },
        "seedance-2-5": { mode: "always" },
        "motion-max": { mode: "always" },
      },
      warn,
    )
    expect(got).toEqual({ "motion-pulse": { mode: "off" } })
    expect(warnings).toHaveLength(3)
    expect(warnings.join("\n")).toMatch(/motion-prism/)
    expect(warnings.join("\n")).toMatch(/seedance-2-5/)
  })

  it("reads a row saved under the earlier ids as the current ones", () => {
    const { warnings, warn } = collect()
    expect(
      parseNodaroMotionMasking({ "motion-pro": { mode: "auto", fill: "blur" }, "motion-lite": { mode: "always", target: "face" } }, warn),
    ).toEqual({ "motion-prism": { mode: "auto", fill: "blur" }, "motion-pulse": { mode: "always", target: "face" } })
    expect(warnings).toEqual([])
  })

  it("keeps the current key's setting when a row has both, whatever their order", () => {
    const { warnings, warn } = collect()
    expect(parseNodaroMotionMasking({ "motion-pro": { mode: "off" }, "motion-prism": { mode: "always" } }, warn)).toEqual({
      "motion-prism": { mode: "always" },
    })
    expect(parseNodaroMotionMasking({ "motion-pulse": { mode: "auto" }, "motion-lite": { mode: "off" } }, warn)).toEqual({
      "motion-pulse": { mode: "auto" },
    })
    expect(warnings).toEqual([])
  })

  it("refuses a misspelt key inside a setting, as every faceMasking does (strict)", () => {
    const { warn } = collect()
    expect(parseNodaroMotionMasking({ "motion-prism": { mode: "auto", tresh: 0.4 } }, warn)).toEqual({})
  })
})

describe("nodaroMotionMaskingSchema (the admin write)", () => {
  it("takes either engine, both or neither", () => {
    for (const v of [{}, { "motion-prism": { mode: "auto" } }, { "motion-prism": { mode: "off" }, "motion-pulse": { mode: "always", fill: "blur" } }]) {
      expect(nodaroMotionMaskingSchema.safeParse(v).success, JSON.stringify(v)).toBe(true)
    }
  })

  it("refuses an unknown engine, an internal or earlier id, or a setting out of range", () => {
    for (const v of [
      { "motion-max": { mode: "auto" } },
      { "kling-4": { mode: "auto" } },
      { "motion-pro": { mode: "auto" } },
      { "motion-prism": { mode: "sometimes" } },
      { "motion-pulse": { mode: "auto", minFaceHeightPct: 30, maxFaceHeightPct: 20 } },
      { "motion-prism": { mode: "auto", zone: { leftPct: 50 } } },
      null,
      [],
    ]) {
      expect(nodaroMotionMaskingSchema.safeParse(v).success, JSON.stringify(v)).toBe(false)
    }
  })
})

describe("withEarlierMaskingKeys (the plugin read's transition shim)", () => {
  it("answers each entry under its current and its earlier key, as separate copies", () => {
    const saved = { "motion-prism": { mode: "auto" as const, zone: { leftPct: 5 } } }
    const got = withEarlierMaskingKeys(saved)
    expect(got).toEqual({ "motion-prism": saved["motion-prism"], "motion-pro": saved["motion-prism"] })
    got["motion-pro"]!.zone!.leftPct = 9
    expect(got["motion-prism"]!.zone!.leftPct).toBe(5)
    expect(saved["motion-prism"].zone.leftPct).toBe(5)
    expect(withEarlierMaskingKeys({})).toEqual({})
  })
})

/**
 * Staging and production share one `nodaro_motion_masking` row while they run
 * apps on both sides of the rename. `PRE_RENAME_PARSE` is the parser of the app
 * before the rename, frozen as it shipped (origin/main, 2026-10-26): it keeps
 * only "motion-pro" / "motion-lite" and drops every other key. A row this app
 * saves must give that app the same settings this one reads.
 */
const PRE_RENAME_ENGINES = ["motion-pro", "motion-lite"] as const
function PRE_RENAME_PARSE(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!(PRE_RENAME_ENGINES as readonly string[]).includes(key)) continue
    const parsed = faceMaskingSchema.safeParse(entry)
    if (parsed.success) out[key] = parsed.data
  }
  return out
}

describe("a saved row, as both apps read it", () => {
  it.each([
    [{ "motion-prism": { mode: "always", fill: "blur", threshold: 0.4 }, "motion-pulse": { mode: "auto", target: "face", zone: null } }],
    [{ "motion-pulse": { mode: "auto" } }],
    [{}],
  ] as const)("%j: the same settings under each app's keys", (saved) => {
    const row = withEarlierMaskingKeys(nodaroMotionMaskingSchema.parse(saved))
    const { warnings, warn } = (() => {
      const w: string[] = []
      return { warnings: w, warn: (m: string) => w.push(m) }
    })()
    expect(parseNodaroMotionMasking(row, warn)).toEqual(saved)
    expect(warnings).toEqual([])
    const before: Record<string, unknown> = {}
    if ("motion-prism" in saved) before["motion-pro"] = saved["motion-prism"]
    if ("motion-pulse" in saved) before["motion-lite"] = saved["motion-pulse"]
    expect(PRE_RENAME_PARSE(row)).toEqual(before)
  })
})
