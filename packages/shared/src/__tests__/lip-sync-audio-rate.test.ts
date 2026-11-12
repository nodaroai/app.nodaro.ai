import { describe, it, expect } from "vitest"
import {
  LIP_SYNC_AUDIO_RATES,
  LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS,
  OMNIHUMAN_2_0_PER_SECOND_CREDIT_ID,
  buildLipSyncCreditId,
  getLipSyncMaxAudioSeconds,
  isPerSecondLipSyncProvider,
  lipSyncAudioRateOf,
  lipSyncBilledSeconds,
  lipSyncEstimateSeconds,
  lipSyncFifteenSecondCreditId,
} from "../lip-sync-pricing.js"
import { LIP_SYNC_PROVIDERS } from "../model-constants.js"
import { MODEL_CATALOG } from "../model-catalog.js"

const rate = LIP_SYNC_AUDIO_RATES["omnihuman-2-0"]!

describe("OmniHuman 2.0 — charged per second of its audio at one rate (decided 2026-11-11)", () => {
  it("is a lip-sync model beside 1.5, with its one-second row", () => {
    expect(LIP_SYNC_PROVIDERS).toContain("omnihuman-2-0")
    expect(LIP_SYNC_PROVIDERS).toContain("omnihuman-1-5")
    expect(lipSyncAudioRateOf("omnihuman-2-0")).toEqual({ rateId: OMNIHUMAN_2_0_PER_SECOND_CREDIT_ID, minSeconds: 4, maxSeconds: 300 })
    expect(OMNIHUMAN_2_0_PER_SECOND_CREDIT_ID).toBe("omnihuman-2-0:per-second")
  })

  it("is never bucketed: no caller that branches on the bucket set can give it :15s/:30s ids", () => {
    expect(isPerSecondLipSyncProvider("omnihuman-2-0")).toBe(false)
    expect(buildLipSyncCreditId("omnihuman-2-0", 10)).toBe("omnihuman-2-0")
    for (const provider of Object.keys(LIP_SYNC_AUDIO_RATES)) expect(isPerSecondLipSyncProvider(provider), provider).toBe(false)
  })

  it("takes up to 300 s of audio (refused past it, never trimmed to the 15 s default cap)", () => {
    expect(getLipSyncMaxAudioSeconds("omnihuman-2-0")).toBe(300)
  })

  it.each([
    [3.2, 4],
    [0.4, 4],
    [4, 4],
    [10, 10],
    [10.04, 11],
    [15, 15],
    [59.999, 60],
    [60, 60],
    [300, 300],
  ])("audio of %s s is billed %s s (rounded up, at least 4)", (sec, billed) => {
    expect(lipSyncBilledSeconds(rate, sec)).toBe(billed)
  })

  it("an estimate quotes the billed seconds when the length is known, else the maximum (or the caller's default)", () => {
    expect(lipSyncEstimateSeconds(rate, 10.04)).toBe(11)
    expect(lipSyncEstimateSeconds(rate, 2)).toBe(4)
    expect(lipSyncEstimateSeconds(rate, 900)).toBe(300)
    expect(lipSyncEstimateSeconds(rate, undefined)).toBe(300)
    expect(lipSyncEstimateSeconds(rate, undefined, LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS)).toBe(15)
  })

  it("a menu prices it from its 15-second quote; bucketed models keep their :15s row; flat models have none", () => {
    expect(lipSyncFifteenSecondCreditId("omnihuman-2-0")).toBe("omnihuman-2-0:per-second:15u")
    expect(lipSyncFifteenSecondCreditId("omnihuman-1-5")).toBe("omnihuman-1-5:15s")
    expect(lipSyncFifteenSecondCreditId("kling-avatar")).toBe("kling-avatar:15s")
    expect(lipSyncFifteenSecondCreditId("infinitalk")).toBeUndefined()
  })

  it("the catalog lists its one row and none of 1.5's levers", () => {
    const entry = MODEL_CATALOG["omnihuman-2-0"]!
    expect(entry.modes).toEqual(["lip-sync"])
    expect(entry.pricing.map((p) => p.identifier)).toEqual([OMNIHUMAN_2_0_PER_SECOND_CREDIT_ID])
    expect(entry.resolutions).toBeUndefined()
    // 1.5 is unchanged.
    expect(MODEL_CATALOG["omnihuman-1-5"]!.resolutions).toEqual(["720p", "1080p"])
  })
})
