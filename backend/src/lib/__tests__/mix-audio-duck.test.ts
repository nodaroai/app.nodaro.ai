import { describe, it, expect } from "vitest"
import {
  DUCK_DEFAULT_AMOUNT,
  DUCK_DEFAULTS,
  duckSchema,
  duckRatioFromAmount,
  resolveDuck,
} from "../mix-audio-duck.js"

describe("duckRatioFromAmount", () => {
  it("makes `amount` the share of the key's excess removed: ratio = 1 / (1 − amount/100)", () => {
    expect(duckRatioFromAmount(0)).toBe(1)
    expect(duckRatioFromAmount(50)).toBe(2)
    expect(duckRatioFromAmount(75)).toBe(4)
    expect(duckRatioFromAmount(90)).toBe(10)
    expect(duckRatioFromAmount(25)).toBe(1.33)
  })

  it("caps at ffmpeg's maximum ratio of 20 (amount 95 and above)", () => {
    expect(duckRatioFromAmount(95)).toBe(20)
    expect(duckRatioFromAmount(100)).toBe(20)
  })

  it("is monotonic over the whole slider", () => {
    let last = 0
    for (let a = 0; a <= 100; a += 5) {
      const r = duckRatioFromAmount(a)
      expect(r).toBeGreaterThanOrEqual(last)
      last = r
    }
  })

  it("clamps out-of-range input instead of producing a ratio ffmpeg rejects", () => {
    expect(duckRatioFromAmount(-30)).toBe(1)
    expect(duckRatioFromAmount(400)).toBe(20)
  })
})

describe("resolveDuck", () => {
  it("fills every lever from the defaults when only `under` is given", () => {
    expect(resolveDuck({ under: 0 })).toEqual({
      under: 0,
      thresholdDb: DUCK_DEFAULTS.thresholdDb,
      ratio: duckRatioFromAmount(DUCK_DEFAULT_AMOUNT),
      attackMs: DUCK_DEFAULTS.attackMs,
      releaseMs: DUCK_DEFAULTS.releaseMs,
    })
  })

  it("derives the ratio from `amount`", () => {
    expect(resolveDuck({ under: 1, amount: 100 }).ratio).toBe(20)
    expect(resolveDuck({ under: 1, amount: 0 }).ratio).toBe(1)
  })

  it("an explicit `ratio` beats `amount`", () => {
    expect(resolveDuck({ under: 1, amount: 100, ratio: 3 }).ratio).toBe(3)
  })

  it("keeps explicit threshold, attack and release", () => {
    expect(resolveDuck({ under: 2, thresholdDb: -40, attackMs: 5, releaseMs: 900 })).toMatchObject({
      under: 2, thresholdDb: -40, attackMs: 5, releaseMs: 900,
    })
  })
})

describe("duckSchema", () => {
  it("accepts the minimal shape", () => {
    expect(duckSchema.safeParse({ under: 0 }).success).toBe(true)
  })

  it.each([
    [{ under: -1 }],
    [{ under: 1.5 }],
    [{ under: 20 }],
    [{ under: 0, amount: 101 }],
    [{ under: 0, thresholdDb: 1 }],
    [{ under: 0, thresholdDb: -61 }],
    [{ under: 0, ratio: 0.5 }],
    [{ under: 0, ratio: 21 }],
    [{ under: 0, attackMs: 0 }],
    [{ under: 0, attackMs: 2001 }],
    [{ under: 0, releaseMs: 9 }],
    [{ under: 0, releaseMs: 9001 }],
  ])("rejects out-of-range %j", (bad) => {
    expect(duckSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects a misspelt lever rather than silently ignoring it", () => {
    expect(duckSchema.safeParse({ under: 0, thresholdDB: -20 }).success).toBe(false)
  })

  it("requires `under`", () => {
    expect(duckSchema.safeParse({ amount: 50 }).success).toBe(false)
  })
})
