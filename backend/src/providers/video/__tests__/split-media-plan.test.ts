/**
 * Split into Chunks — the pure plan: integer unit math, the partition with its
 * minimum, the cap and its refusal messages, the keyframe list, the sound
 * samples under each picture part, and the liveness budget.
 */
import { describe, it, expect } from "vitest"
import { SPLIT_MEDIA_MAX_PARTS } from "@nodaro/render-rules"
import {
  formatLength,
  maxSourceSecFor,
  maxSourceUnits,
  sourceTooLongMessage,
  SPLIT_MEDIA_MAX_SOURCE_SEC,
  AAC_FRAME_SAMPLES,
  aacWholeFrameSamples,
  audioSamplesForFrames,
  cutPointsOf,
  forcedKeyframeTimes,
  frameStartMicros,
  keyframeCandidates,
  maxPartMsOf,
  minPartMsOf,
  minPartSecForCap,
  planSplit,
  planSplitParts,
  splitEncodeTimeoutMs,
  splitMediaJobBudgetMs,
  splitPartTimeoutMs,
  splitCopyTimeoutMs,
  splitSettingsOf,
  unitRate,
  unitsAtLeast,
  unitsAtMost,
  unitsNearest,
  unitsToSec,
} from "../split-media-plan.js"
import { DOWNLOAD_MAX_MS, FFPROBE_TIMEOUT_MS } from "../ffmpeg-timeouts.js"
import { LIVENESS_CANVAS } from "../apply-edl-budget.js"

const NTSC = unitRate(30000, 1001)
const P30 = unitRate(30)
const P25 = unitRate(25)

describe("frames per part — integer math, never Math.round(seconds · fps)", () => {
  it("x = 10 s: 299 frames at 30000/1001, 300 at 30, 250 at 25", () => {
    expect(unitsAtMost(maxPartMsOf(10), NTSC)).toBe(299)
    expect(unitsAtMost(maxPartMsOf(10), P30)).toBe(300)
    expect(unitsAtMost(maxPartMsOf(10), P25)).toBe(250)
  })

  it("fractional x is floored to whole ms, then to whole frames (never over x)", () => {
    expect(maxPartMsOf(2.3)).toBe(2300) // 2.3 · 1000 = 2299.9999…
    expect(maxPartMsOf(2.0005)).toBe(2000) // never rounded UP past x
    expect(unitsAtMost(maxPartMsOf(1.5), NTSC)).toBe(44) // 44.955 → 44
    for (const x of [1, 1.5, 2.3, 7, 10, 59.94, 3600]) {
      for (const rate of [NTSC, P30, P25, unitRate(24000, 1001), unitRate(60000, 1001)]) {
        const k = unitsAtMost(maxPartMsOf(x), rate)
        expect(unitsToSec(k, rate)).toBeLessThanOrEqual(x + 1e-9)
        expect(unitsToSec(k + 1, rate)).toBeGreaterThan(x)
      }
    }
  })

  it("the minimum rounds UP: a part of minUnits is never shorter than the minimum", () => {
    expect(minPartMsOf(4)).toBe(4000)
    expect(unitsAtLeast(minPartMsOf(4), NTSC)).toBe(120) // 119.88 → 120
    expect(unitsAtLeast(minPartMsOf(4), P25)).toBe(100)
    expect(unitsToSec(unitsAtLeast(minPartMsOf(4), NTSC), NTSC)).toBeGreaterThanOrEqual(4)
  })

  it("samples per part: ⌊xMs · sr / 1000⌋", () => {
    expect(unitsAtMost(maxPartMsOf(10), unitRate(44100))).toBe(441000)
    expect(unitsAtMost(maxPartMsOf(0.0001 + 1), unitRate(48000))).toBe(48000)
  })

  it("estimates round half up in integers", () => {
    expect(unitsNearest(65_000, NTSC)).toBe(1948) // 1948.05
    expect(unitsNearest(60_000, NTSC)).toBe(1798) // 1798.2
  })
})

describe("planSplitParts — fewest parts, each in [min, max]", () => {
  it("the brief's example: 1798 frames, max 299, min 120 → 299 × 5, 152, 151", () => {
    expect(planSplitParts(1798, 299, 120)).toEqual([299, 299, 299, 299, 299, 152, 151])
  })

  it("a remainder already ≥ min stays as the last part", () => {
    expect(planSplitParts(1948, 299, 120)).toEqual([299, 299, 299, 299, 299, 299, 154])
  })

  it("an exact multiple makes equal parts", () => {
    expect(planSplitParts(1500, 250, 100)).toEqual([250, 250, 250, 250, 250, 250])
  })

  it("min 0 never rebalances (a 1-unit tail stays)", () => {
    expect(planSplitParts(601, 300, 0)).toEqual([300, 300, 1])
  })

  it("rebalances more than two parts when two cannot reach the minimum", () => {
    // 4 × 100 + 1: two parts share 101 → 50 < 90; three share 201 → 67 < 90 …
    // all five share 401 → 80 < 90 → infeasible; with min 80 five work.
    expect(planSplitParts(401, 100, 90)).toBeNull()
    expect(planSplitParts(401, 100, 80)).toEqual([81, 80, 80, 80, 80])
    // 3 × 100 + 10, min 60: j = 2 → 110/2 = 55 < 60; j = 3 → 210/3 = 70 ✓
    expect(planSplitParts(310, 100, 60)).toEqual([100, 70, 70, 70])
  })

  it("larger parts come first, sizes differ by at most one, every part in [min, max]", () => {
    for (const [total, max, min] of [[1798, 299, 120], [10_001, 300, 299], [12_345, 441, 100], [999, 7, 6], [5, 5, 5], [7, 3, 2]] as const) {
      const parts = planSplitParts(total, max, min)
      if (!parts) continue
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      expect(parts.length).toBe(Math.ceil(total / max))
      for (const p of parts) {
        expect(p).toBeLessThanOrEqual(max)
        expect(p).toBeGreaterThanOrEqual(min)
      }
      for (let i = 1; i < parts.length; i++) expect(parts[i]!).toBeLessThanOrEqual(parts[i - 1]!)
    }
  })

  it("infeasible when n · min > total — the source shorter than the minimum included", () => {
    expect(planSplitParts(90, 299, 120)).toBeNull()
    expect(planSplitParts(330, 300, 200)).toBeNull() // 2 parts × 200 > 330
    expect(planSplitParts(0, 300, 0)).toBeNull()
  })

  it("a whole source within [min, max] is one part", () => {
    expect(planSplitParts(150, 299, 120)).toEqual([150])
  })
})

describe("planSplit — the cap and the refusals", () => {
  it(`at most ${SPLIT_MEDIA_MAX_PARTS} parts; the message names the count, the limit and a length that fits`, () => {
    // 3 hours at 25 fps, 10 s parts → 1080 parts.
    const verdict = planSplit("video", 3 * 3600 * 25, P25, 10, 4)
    expect(verdict).toEqual({
      ok: false,
      message: "This video would make 1,080 parts; the limit is 200. Use a part length of at least 54 s, or trim the video first.",
    })
    const fits = planSplit("video", 3 * 3600 * 25, P25, 54, 4)
    expect(fits.ok && fits.parts.length).toBe(200)
  })

  it("the suggested length always fits, at awkward rates too", () => {
    for (const [total, rate] of [[1_000_001, NTSC], [4_000_000, unitRate(44100)], [60_001, P30]] as const) {
      const sec = minPartSecForCap(total, rate)
      expect(Math.ceil(total / unitsAtMost(sec * 1000, rate))).toBeLessThanOrEqual(SPLIT_MEDIA_MAX_PARTS)
      expect(Math.ceil(total / unitsAtMost((sec - 1) * 1000, rate))).toBeGreaterThan(SPLIT_MEDIA_MAX_PARTS)
    }
  })

  it("exactly 200 parts passes", () => {
    const v = planSplit("video", 200 * 300, P30, 10, 4)
    expect(v.ok && v.parts.length).toBe(200)
  })

  it("an audio file names itself", () => {
    const v = planSplit("audio", 48000 * 3000, unitRate(48000), 10, 4)
    expect(!v.ok && v.message).toBe("This audio would make 300 parts; the limit is 200. Use a part length of at least 15 s, or trim the audio first.")
  })

  it("shorter than the minimum", () => {
    const v = planSplit("video", 80, P25, 10, 4) // 3.2 s
    expect(!v.ok && v.message).toBe("This 3.2 s video is shorter than the 4 s minimum part length.")
  })

  it("no partition between the minimum and the part length", () => {
    const v = planSplit("video", 11 * 25, P25, 10, 6) // 11 s: 2 parts ≥ 6 s need 12 s
    expect(!v.ok && v.message).toBe("This 11 s video can't be cut into parts between 6 s and 10 s — lower the minimum or raise the part length.")
  })

  it("a part length shorter than one frame", () => {
    const v = planSplit("video", 10, unitRate(1, 2), 1, 0) // 0.5 fps
    expect(!v.ok && v.message).toMatch(/holds no whole frame/)
  })
})

describe("splitSettingsOf — x and the effective minimum", () => {
  it("absent minimum → 4 s, never above x; invalid x → undefined", () => {
    expect(splitSettingsOf({ chunkDuration: 10 })).toEqual({ chunkSec: 10, minPartSec: 4 })
    expect(splitSettingsOf({ chunkDuration: 3 })).toEqual({ chunkSec: 3, minPartSec: 3 })
    expect(splitSettingsOf({ chunkDuration: 10, minPartDuration: 0 })).toEqual({ chunkSec: 10, minPartSec: 0 })
    expect(splitSettingsOf({ chunkDuration: 10, minPartDuration: 7.5 })).toEqual({ chunkSec: 10, minPartSec: 7.5 })
    expect(splitSettingsOf({ chunkDuration: "10" })).toBeUndefined()
    expect(splitSettingsOf({ chunkDuration: 0 })).toBeUndefined()
  })
})

describe("cuts, keyframes and the sound under each picture part", () => {
  it("cut points are cumulative", () => {
    expect(cutPointsOf([299, 299, 152, 151])).toEqual([0, 299, 598, 750, 901])
  })

  it("keyframe times are floored to the microsecond, so they key THAT frame (598 @ 29.97 = 19.9532666… s)", () => {
    expect(frameStartMicros(598, NTSC)).toBe(19_953_266n)
    expect(forcedKeyframeTimes([0, 299, 598], NTSC)).toBe("0.000000,9.976633,19.953266")
    expect(forcedKeyframeTimes([250, 3_600_000], P25)).toBe("10.000000,144000.000000")
  })

  it("keyframe candidates cover every total within the estimate's slack", () => {
    const keyed = keyframeCandidates(1798, 299, 120)
    for (let total = 1796; total <= 1800; total++) {
      const parts = planSplitParts(total, 299, 120)!
      for (const c of cutPointsOf(parts).slice(0, -1)) expect(keyed).toContain(c)
    }
  })

  it("each part's sound never outlasts its picture, over a 3-hour plan at awkward rates", () => {
    for (const fps of [NTSC, unitRate(24000, 1001), P25]) {
      for (const sr of [44100, 48000, 22050]) {
        const total = unitsNearest(3 * 3600 * 1000, fps)
        const parts = planSplitParts(total, unitsAtMost(maxPartMsOf(60), fps), unitsAtLeast(minPartMsOf(4), fps))!
        const cuts = cutPointsOf(parts)
        for (let i = 0; i < parts.length; i++) {
          const { start, end } = audioSamplesForFrames(cuts[i]!, cuts[i + 1]!, fps, sr)
          // (end − start) / sr ≤ frames · den / num, in integers
          expect(BigInt(end - start) * BigInt(fps.num)).toBeLessThanOrEqual(BigInt(parts[i]!) * BigInt(fps.den) * BigInt(sr))
          // and short by at most one sample
          expect(BigInt(end - start + 2) * BigInt(fps.num)).toBeGreaterThan(BigInt(parts[i]!) * BigInt(fps.den) * BigInt(sr))
          if (i > 0) expect(start - audioSamplesForFrames(cuts[i - 1]!, cuts[i]!, fps, sr).end).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe("aacWholeFrameSamples — what the pinned ffmpeg decodes back exactly", () => {
  it("rounds a window DOWN to whole 1024-sample AAC frames", () => {
    expect(AAC_FRAME_SAMPLES).toBe(1024)
    expect(aacWholeFrameSamples(478877)).toBe(478208)
    expect(aacWholeFrameSamples(479232)).toBe(479232)
    expect(aacWholeFrameSamples(1023)).toBe(0)
    expect(aacWholeFrameSamples(-5)).toBe(0)
  })
})

describe("budgets", () => {
  it("the encode kill budget grows with the source and its canvas, floored at the ffmpeg default", () => {
    expect(splitEncodeTimeoutMs(10, { width: 320, height: 240, fps: 30 })).toBe(10 * 60_000)
    const hd = splitEncodeTimeoutMs(3600, { width: 1920, height: 1080, fps: 30 })
    // 3 × (1.6 encode + 0.5 decode) s per source second at 1080p30 (float noise ≤ 1 ms)
    expect(Math.abs(hd - 3 * 2.1 * 3600 * 1000)).toBeLessThanOrEqual(1)
    expect(Math.abs(splitEncodeTimeoutMs(3600, LIVENESS_CANVAS) - 4 * hd)).toBeLessThanOrEqual(4)
  })

  it("the liveness budget sums every step over the longest source the caps allow — min(200 · x, 3 h)", () => {
    const x = 10
    const maxSource = 200 * x
    const parts = 200 * splitPartTimeoutMs(x) // ⌈2000 / 10⌉ + 1 = 201 → capped at 200
    expect(splitMediaJobBudgetMs({ videoUrl: "https://v", chunkDuration: x })).toBe(
      DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS
      + 2 * (splitEncodeTimeoutMs(maxSource, LIVENESS_CANVAS) + FFPROBE_TIMEOUT_MS)
      + splitCopyTimeoutMs(maxSource) + parts,
    )
    expect(splitMediaJobBudgetMs({ audioUrl: "https://a", chunkDuration: x })).toBe(
      DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + splitCopyTimeoutMs(maxSource) + parts,
    )
    expect(splitMediaJobBudgetMs({ videoUrl: "https://v", audioUrl: "https://a", chunkDuration: x }))
      .toBe(splitMediaJobBudgetMs({ videoUrl: "https://v", chunkDuration: x })! + splitMediaJobBudgetMs({ audioUrl: "https://a", chunkDuration: x })!)
  })

  it("past 54 s parts the 3-hour source cap bounds the budget, and the part count follows the source", () => {
    expect(maxSourceSecFor(10)).toBe(2000)
    expect(maxSourceSecFor(54)).toBe(10_800)
    expect(maxSourceSecFor(600)).toBe(10_800)
    const x = 600
    const maxSource = SPLIT_MEDIA_MAX_SOURCE_SEC
    const parts = (Math.ceil(maxSource / x) + 1) * splitPartTimeoutMs(x) // 19 parts
    expect(splitMediaJobBudgetMs({ videoUrl: "https://v", chunkDuration: x })).toBe(
      DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS
      + 2 * (splitEncodeTimeoutMs(maxSource, LIVENESS_CANVAS) + FFPROBE_TIMEOUT_MS)
      + splitCopyTimeoutMs(maxSource) + parts,
    )
    // Bounded by the 3-hour source at any x: under Node's 2^31 − 1 ms timer ceiling.
    for (const x of [60, 300, 600, 3600, 10_800]) {
      const both = splitMediaJobBudgetMs({ videoUrl: "https://v", audioUrl: "https://a", chunkDuration: x })!
      expect(both).toBeLessThan(2 ** 31 - 1)
    }
  })

  it("no source or no usable x → no budget", () => {
    expect(splitMediaJobBudgetMs({ chunkDuration: 10 })).toBeUndefined()
    expect(splitMediaJobBudgetMs({ videoUrl: "https://v" })).toBeUndefined()
    expect(splitMediaJobBudgetMs(null)).toBeUndefined()
  })
})

describe("the 3-hour source cap", () => {
  it("is 3 hours, counted in whole units", () => {
    expect(SPLIT_MEDIA_MAX_SOURCE_SEC).toBe(10_800)
    expect(maxSourceUnits(NTSC)).toBe(323_676)
    expect(maxSourceUnits(P25)).toBe(270_000)
    expect(maxSourceUnits(unitRate(48000))).toBe(518_400_000)
  })

  it("lengths read the way people say them, rounded up", () => {
    expect(formatLength(3 * 3600 + 12 * 60)).toBe("3 h 12 min")
    expect(formatLength(3 * 3600 + 5)).toBe("3 h 0 min 5 s")
    expect(formatLength(3 * 3600 + 0.2)).toBe("3 h 0 min 1 s")
    expect(formatLength(3 * 3600)).toBe("3 h")
    expect(formatLength(45)).toBe("45 s")
    expect(formatLength(125)).toBe("2 min 5 s")
  })

  it("the refusal names the length and the limit", () => {
    expect(sourceTooLongMessage("video", 3 * 3600 + 12 * 60)).toBe("This video is 3 h 12 min long; Split into Chunks takes up to 3 hours — trim it first.")
    expect(sourceTooLongMessage("audio", undefined)).toBe("This audio is longer than 3 hours; Split into Chunks takes up to 3 hours — trim it first.")
  })
})
