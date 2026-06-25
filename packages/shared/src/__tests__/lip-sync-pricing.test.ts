import { describe, it, expect } from "vitest"
import {
  pickLipSyncBucket,
  getLipSyncMaxAudioSeconds,
  isPerSecondLipSyncProvider,
  buildLipSyncCreditId,
} from "../lip-sync-pricing.js"

describe("pickLipSyncBucket", () => {
  it("rounds up to the next supported bucket", () => {
    expect(pickLipSyncBucket(1)).toBe(15)
    expect(pickLipSyncBucket(15)).toBe(15)
    expect(pickLipSyncBucket(15.001)).toBe(30)
    expect(pickLipSyncBucket(29)).toBe(30)
    expect(pickLipSyncBucket(30)).toBe(30)
    expect(pickLipSyncBucket(31)).toBe(60)
    expect(pickLipSyncBucket(60)).toBe(60)
    expect(pickLipSyncBucket(61)).toBe(120)
    expect(pickLipSyncBucket(120)).toBe(120)
    expect(pickLipSyncBucket(121)).toBe(300)
    expect(pickLipSyncBucket(300)).toBe(300)
  })

  it("clamps anything above 5min to the 300s bucket", () => {
    expect(pickLipSyncBucket(600)).toBe(300)
  })

  it("falls back to the smallest bucket for non-positive input", () => {
    expect(pickLipSyncBucket(0)).toBe(15)
    expect(pickLipSyncBucket(-5)).toBe(15)
    expect(pickLipSyncBucket(NaN)).toBe(15)
  })
})

describe("getLipSyncMaxAudioSeconds", () => {
  it("reports 5min for Kling AI Avatar 2.0 (post-upgrade)", () => {
    expect(getLipSyncMaxAudioSeconds("kling-avatar")).toBe(300)
    expect(getLipSyncMaxAudioSeconds("kling-avatar-pro")).toBe(300)
  })

  it("keeps InfiniTalk at the 15s upstream cap", () => {
    expect(getLipSyncMaxAudioSeconds("infinitalk")).toBe(15)
  })

  it("reports 5min for the Replicate per-second dubbing models", () => {
    expect(getLipSyncMaxAudioSeconds("heygen-lipsync-precision")).toBe(300)
    expect(getLipSyncMaxAudioSeconds("lipsync-2-pro")).toBe(300)
  })

  it("reports 5min for the fal sync-lipsync-v3 model (NOT the 15s default)", () => {
    expect(getLipSyncMaxAudioSeconds("sync-lipsync-v3")).toBe(300)
  })

  it("reports 5min for the Volcengine dubbing model (NOT the 15s default)", () => {
    expect(getLipSyncMaxAudioSeconds("volcengine-lipsync")).toBe(300)
  })

  it("defaults unknown providers to 15s", () => {
    expect(getLipSyncMaxAudioSeconds("nope")).toBe(15)
  })
})

describe("isPerSecondLipSyncProvider", () => {
  it("flags the Kling Avatar models", () => {
    expect(isPerSecondLipSyncProvider("kling-avatar")).toBe(true)
    expect(isPerSecondLipSyncProvider("kling-avatar-pro")).toBe(true)
  })

  it("flags the Replicate per-second dubbing models", () => {
    expect(isPerSecondLipSyncProvider("heygen-lipsync-precision")).toBe(true)
    expect(isPerSecondLipSyncProvider("lipsync-2-pro")).toBe(true)
  })

  it("flags the fal sync-lipsync-v3 model", () => {
    expect(isPerSecondLipSyncProvider("sync-lipsync-v3")).toBe(true)
  })

  it("flags the Volcengine dubbing model", () => {
    expect(isPerSecondLipSyncProvider("volcengine-lipsync")).toBe(true)
  })

  it("returns false for everything else", () => {
    expect(isPerSecondLipSyncProvider("infinitalk")).toBe(false)
    expect(isPerSecondLipSyncProvider("latentsync")).toBe(false)
  })
})

describe("buildLipSyncCreditId", () => {
  it("emits composite IDs for Kling Avatar models", () => {
    expect(buildLipSyncCreditId("kling-avatar", 10)).toBe("kling-avatar:15s")
    expect(buildLipSyncCreditId("kling-avatar", 45)).toBe("kling-avatar:60s")
    expect(buildLipSyncCreditId("kling-avatar-pro", 200)).toBe("kling-avatar-pro:300s")
  })

  it("falls back to the 5-min ceiling when duration is missing", () => {
    expect(buildLipSyncCreditId("kling-avatar", undefined)).toBe("kling-avatar:300s")
    expect(buildLipSyncCreditId("kling-avatar-pro", undefined)).toBe("kling-avatar-pro:300s")
  })

  it("clamps overly long durations to the 300s bucket", () => {
    expect(buildLipSyncCreditId("kling-avatar", 999)).toBe("kling-avatar:300s")
  })

  it("emits composite IDs for the Replicate per-second dubbing models", () => {
    expect(buildLipSyncCreditId("heygen-lipsync-precision", 12)).toBe("heygen-lipsync-precision:15s")
    expect(buildLipSyncCreditId("heygen-lipsync-precision", 45)).toBe("heygen-lipsync-precision:60s")
    expect(buildLipSyncCreditId("lipsync-2-pro", 200)).toBe("lipsync-2-pro:300s")
    expect(buildLipSyncCreditId("lipsync-2-pro", undefined)).toBe("lipsync-2-pro:300s")
  })

  it("emits composite IDs for the fal sync-lipsync-v3 model", () => {
    expect(buildLipSyncCreditId("sync-lipsync-v3", 12)).toBe("sync-lipsync-v3:15s")
    expect(buildLipSyncCreditId("sync-lipsync-v3", 200)).toBe("sync-lipsync-v3:300s")
    expect(buildLipSyncCreditId("sync-lipsync-v3", undefined)).toBe("sync-lipsync-v3:300s")
  })

  it("emits composite IDs for the Volcengine dubbing model", () => {
    expect(buildLipSyncCreditId("volcengine-lipsync", 12)).toBe("volcengine-lipsync:15s")
    expect(buildLipSyncCreditId("volcengine-lipsync", 45)).toBe("volcengine-lipsync:60s")
    expect(buildLipSyncCreditId("volcengine-lipsync", 200)).toBe("volcengine-lipsync:300s")
    expect(buildLipSyncCreditId("volcengine-lipsync", undefined)).toBe("volcengine-lipsync:300s")
  })

  it("returns the bare provider for non-per-second models", () => {
    expect(buildLipSyncCreditId("infinitalk", 10)).toBe("infinitalk")
    expect(buildLipSyncCreditId("latentsync", undefined)).toBe("latentsync")
  })
})

describe("omnihuman-1-5 (per-second, 60s cap)", () => {
  it("is per-second and capped at 60s", () => {
    expect(isPerSecondLipSyncProvider("omnihuman-1-5")).toBe(true)
    expect(getLipSyncMaxAudioSeconds("omnihuman-1-5")).toBe(60)
  })
  it("buckets to 15/30/60 and clamps anything longer (and missing) to 60", () => {
    expect(buildLipSyncCreditId("omnihuman-1-5", 8)).toBe("omnihuman-1-5:15s")
    expect(buildLipSyncCreditId("omnihuman-1-5", 25)).toBe("omnihuman-1-5:30s")
    expect(buildLipSyncCreditId("omnihuman-1-5", 59)).toBe("omnihuman-1-5:60s")
    expect(buildLipSyncCreditId("omnihuman-1-5", 999)).toBe("omnihuman-1-5:60s")
    expect(buildLipSyncCreditId("omnihuman-1-5", undefined)).toBe("omnihuman-1-5:60s")
  })
})
