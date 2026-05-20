import { describe, it, expect } from "vitest"
import {
  VIDEO_UTIL_PRICING,
  estimateLoopVideoCredits,
  estimateTrimVideoCredits,
  estimateCombineVideosCredits,
} from "../credit-estimators/video-utils.js"
import {
  estimateLoopTrimAddonCredits,
  type LoopTrimEstimatorInput,
} from "../credit-estimators/video-utils.js"

describe("estimateLoopVideoCredits", () => {
  describe("repeat mode", () => {
    it("uses upstream duration when provided", () => {
      // 4× a 5s clip = 20s output → ceil(20/5) = 4
      expect(estimateLoopVideoCredits({ mode: "repeat", repeatCount: 4 }, 5)).toBe(4)
    })

    it("falls back to 8s per repeat when upstream duration is missing", () => {
      // 4 × 8 = 32s → ceil(32/5) = 7
      expect(estimateLoopVideoCredits({ mode: "repeat", repeatCount: 4 })).toBe(7)
    })

    it("defaults repeatCount to 2 when missing", () => {
      // 2 × 8 = 16s → ceil(16/5) = 4
      expect(estimateLoopVideoCredits({ mode: "repeat" })).toBe(4)
    })
  })

  describe("duration mode", () => {
    it("uses targetDuration regardless of upstream", () => {
      // ceil(60/5) = 12
      expect(estimateLoopVideoCredits({ mode: "duration", targetDuration: 60 }, 5)).toBe(12)
    })

    it("defaults targetDuration to fallback when missing", () => {
      // ceil(8/5) = 2
      expect(estimateLoopVideoCredits({ mode: "duration" })).toBe(2)
    })
  })

  describe("smart-loop-cut adder", () => {
    it("adds ceil(lookback/24) when enabled", () => {
      // 30s base = 6, lookback 16 → ceil(16/24) = 1, total 7
      expect(estimateLoopVideoCredits({
        mode: "duration", targetDuration: 30,
        smartLoopCutBeforeRepeat: true, smartLoopCutLookback: 16,
      })).toBe(7)
    })

    it("uses default lookback 16 when smart-cut on but lookback missing", () => {
      // 60s base = 12, default lookback 16 → +1 = 13
      expect(estimateLoopVideoCredits({
        mode: "duration", targetDuration: 60,
        smartLoopCutBeforeRepeat: true,
      })).toBe(13)
    })

    it("max lookback 64 stays within bound", () => {
      // 60s base = 12, lookback 64 → ceil(64/24) = 3, total 15
      expect(estimateLoopVideoCredits({
        mode: "duration", targetDuration: 60,
        smartLoopCutBeforeRepeat: true, smartLoopCutLookback: 64,
      })).toBe(15)
    })

    it("does NOT add when smartLoopCutBeforeRepeat is false", () => {
      expect(estimateLoopVideoCredits({
        mode: "duration", targetDuration: 60,
        smartLoopCutBeforeRepeat: false, smartLoopCutLookback: 64,
      })).toBe(12)
    })
  })

  describe("min-1 floor", () => {
    it("never returns 0 — even for sub-second output", () => {
      expect(estimateLoopVideoCredits({ mode: "duration", targetDuration: 0.5 })).toBe(1)
    })
  })

  describe("constants", () => {
    it("exports the expected pricing constants", () => {
      expect(VIDEO_UTIL_PRICING.CREDITS_PER_5_SEC).toBe(1)
      expect(VIDEO_UTIL_PRICING.FRAMES_PER_CREDIT).toBe(24)
      expect(VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS).toBe(8)
    })
  })
})

describe("estimateTrimVideoCredits", () => {
  describe("time mode (default)", () => {
    it("computes credits from endTime - startTime", () => {
      // 0–10s = 10s → ceil(10/5) = 2
      expect(estimateTrimVideoCredits({ trimMode: "time", startTime: 0, endTime: 10 })).toBe(2)
    })

    it("treats missing trimMode as time mode", () => {
      // ceil(15/5) = 3
      expect(estimateTrimVideoCredits({ startTime: 5, endTime: 20 })).toBe(3)
    })

    it("defaults missing start/end to 0", () => {
      // 0-0 = 0s, but min-1 → 1
      expect(estimateTrimVideoCredits({ trimMode: "time" })).toBe(1)
    })
  })

  describe("frames mode", () => {
    it("subtracts trim frames from upstream duration at 24fps", () => {
      // 10s upstream - 24/24 - 24/24 = 8s → ceil(8/5) = 2
      expect(estimateTrimVideoCredits({
        trimMode: "frames", trimStartFrames: 24, trimEndFrames: 24,
      }, 10)).toBe(2)
    })

    it("uses 8s fallback when upstream missing", () => {
      // 8s - 0 - 0 = 8s → ceil(8/5) = 2
      expect(estimateTrimVideoCredits({ trimMode: "frames" })).toBe(2)
    })

    it("clamps to 0 if frame trim exceeds duration", () => {
      // 5s - 240/24 - 0 = -5 clamped to 0 → max(1, ceil(0)) = 1
      expect(estimateTrimVideoCredits({
        trimMode: "frames", trimStartFrames: 240, trimEndFrames: 0,
      }, 5)).toBe(1)
    })
  })

  describe("smart-loop-cut mode", () => {
    it("upstream-based base + lookback adder", () => {
      // 10s upstream → base 2, lookback 16 → +1 = 3
      expect(estimateTrimVideoCredits({
        trimMode: "smart-loop-cut", smartLoopCutLookback: 16,
      }, 10)).toBe(3)
    })

    it("uses default lookback 16 when missing", () => {
      // 8s upstream → base 2, default 16 → +1 = 3
      expect(estimateTrimVideoCredits({ trimMode: "smart-loop-cut" })).toBe(3)
    })
  })

  describe("seconds mode (relative trim in seconds)", () => {
    it("subtracts trim seconds from upstream duration", () => {
      // 30s - 2 - 3 = 25s → ceil(25/5) = 5
      expect(estimateTrimVideoCredits({
        trimMode: "seconds", trimStartSeconds: 2, trimEndSeconds: 3,
      }, 30)).toBe(5)
    })

    it("clamps to min 1 credit if trim exceeds duration", () => {
      // 5s - 10 - 0 = -5 clamp to 0 → max(1, ceil(0)) = 1
      expect(estimateTrimVideoCredits({
        trimMode: "seconds", trimStartSeconds: 10,
      }, 5)).toBe(1)
    })
  })

  describe("keep-first-seconds mode", () => {
    it("output is min(upstream, keepFirstSeconds)", () => {
      // keepFirst=8, upstream=20 → output 8s → ceil(8/5) = 2
      expect(estimateTrimVideoCredits({
        trimMode: "keep-first-seconds", keepFirstSeconds: 8,
      }, 20)).toBe(2)
    })

    it("clamps to upstream when keep > upstream", () => {
      // keepFirst=30, upstream=5 → output 5s → ceil(5/5) = 1
      expect(estimateTrimVideoCredits({
        trimMode: "keep-first-seconds", keepFirstSeconds: 30,
      }, 5)).toBe(1)
    })
  })

  describe("keep-last-seconds mode", () => {
    it("output is min(upstream, keepLastSeconds)", () => {
      // keepLast=10, upstream=30 → output 10s → ceil(10/5) = 2
      expect(estimateTrimVideoCredits({
        trimMode: "keep-last-seconds", keepLastSeconds: 10,
      }, 30)).toBe(2)
    })

    it("uses 8s fallback when upstream missing", () => {
      // keepLast=10, upstream undefined → upstream=8 → min(8,10)=8 → ceil(8/5)=2
      expect(estimateTrimVideoCredits({
        trimMode: "keep-last-seconds", keepLastSeconds: 10,
      })).toBe(2)
    })
  })
})

describe("estimateCombineVideosCredits", () => {
  it("2 inputs with cut transition", () => {
    // 5+5=10s, cut → 0 transition overlap, 0 frame trim, numInputs-2=0
    // → ceil(10/5) + 0 = 2
    expect(estimateCombineVideosCredits({ transition: "cut" }, [5, 5])).toBe(2)
  })

  it("3 inputs with fade transition (0.5s)", () => {
    // 10+10+10=30s, 2 fades × 0.5 = 1s overlap → 29s → ceil(29/5)=6
    // numInputs-2 = 1 → 6 + 1 = 7
    expect(estimateCombineVideosCredits({
      transition: "fade", transitionDuration: 0.5,
    }, [10, 10, 10])).toBe(7)
  })

  it("5 inputs with dissolve and per-clip frame trim (24+24)", () => {
    // 5×8=40s, 4 transitions × 0.5 = 2s overlap, frame trim 48/24=2s × 5 = 10s
    // → 40 - 2 - 10 = 28s → ceil(28/5) = 6
    // numInputs-2 = 3 → 6 + 3 = 9
    expect(estimateCombineVideosCredits({
      transition: "dissolve",
      transitionDuration: 0.5,
      trimStartFrames: 24,
      trimEndFrames: 24,
    }, [8, 8, 8, 8, 8])).toBe(9)
  })

  it("falls back to 8s per missing upstream entry", () => {
    // [undef, undef, undef] → 3×8=24s, cut → ceil(24/5)=5, +1 (numInputs-2) = 6
    expect(estimateCombineVideosCredits(
      { transition: "cut" },
      [undefined, undefined, undefined],
    )).toBe(6)
  })

  it("treats empty input array as 2-input fallback", () => {
    // numInputs = 0 || 2 = 2; total = 0 → max(1, …) = 1
    expect(estimateCombineVideosCredits({ transition: "cut" }, [])).toBe(1)
  })

  it("min-1 floor when total clamps to 0", () => {
    // 2 × 0s = 0, no overlap, num-2=0 → max(1, ceil(0)) = 1
    expect(estimateCombineVideosCredits({ transition: "cut" }, [0, 0])).toBe(1)
  })

  it("does not subtract transition overlap on cut", () => {
    // [10, 10] cut → ceil(20/5)=4, numInputs-2=0 → 4
    expect(estimateCombineVideosCredits({ transition: "cut", transitionDuration: 999 }, [10, 10])).toBe(4)
  })

  it("uses default transitionDuration 0.5 when missing on a non-cut", () => {
    // [10, 10] fade, no transitionDuration → 20 - 0.5 = 19.5 → ceil(19.5/5)=4
    expect(estimateCombineVideosCredits({ transition: "fade" }, [10, 10])).toBe(4)
  })
})

describe("estimateLoopTrimAddonCredits", () => {
  it("returns 0 when loopTrim is undefined", () => {
    expect(estimateLoopTrimAddonCredits(undefined, 8)).toBe(0)
  })

  it("returns 0 when enabled is false", () => {
    expect(estimateLoopTrimAddonCredits({ enabled: false }, 8)).toBe(0)
  })

  it("computes ceil(duration/5) + ceil(framesToTest/24) when enabled", () => {
    // 8s / 5 = 2 (ceil), 16 / 24 = 1 (ceil) → 3
    expect(estimateLoopTrimAddonCredits({ enabled: true, framesToTest: 16 }, 8)).toBe(3)
  })

  it("uses default framesToTest=16 when omitted", () => {
    // 10s / 5 = 2, 16 / 24 = 1 → 3
    expect(estimateLoopTrimAddonCredits({ enabled: true }, 10)).toBe(3)
  })

  it("clamps framesToTest to 64 max", () => {
    // 8s / 5 = 2, 64 / 24 = 3 → 5
    expect(estimateLoopTrimAddonCredits({ enabled: true, framesToTest: 999 }, 8)).toBe(5)
  })

  it("clamps framesToTest to 1 min", () => {
    // 8s / 5 = 2, 1 / 24 = 1 → 3
    expect(estimateLoopTrimAddonCredits({ enabled: true, framesToTest: 0 }, 8)).toBe(3)
  })

  it("scales with output duration", () => {
    // 60s / 5 = 12, 16 / 24 = 1 → 13
    expect(estimateLoopTrimAddonCredits({ enabled: true, framesToTest: 16 }, 60)).toBe(13)
  })

  it("returns 0 when framesToTest=64 but enabled is false (precedence)", () => {
    expect(estimateLoopTrimAddonCredits({ enabled: false, framesToTest: 64 }, 60)).toBe(0)
  })
})
