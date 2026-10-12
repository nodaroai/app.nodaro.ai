// packages/shared/src/__tests__/video-depth.test.ts
import { describe, expect, it } from "vitest"
import {
  VIDEO_DEPTH_PROVIDERS,
  FAL_VIDEO_DEPTH_PROVIDERS,
  REPLICATE_VIDEO_DEPTH_PROVIDERS,
  videoDepthLevers,
  checkVideoDepthLength,
  videoDepthCreditId,
  videoDepthColormaps,
  resolveVideoDepthColormap,
  videoDepthNeedsGrayscalePass,
  VIDEO_DEPTH_COLORMAPS,
  VIDEO_DEPTH_LIMITS,
  VIDEO_DEPTH_BUCKETS,
  resolveVideoDepthProvider,
  resolveVideoDepthModelSize,
} from "../video-depth.js"

describe("video-depth providers", () => {
  it("partitions every provider into exactly one serving lane", () => {
    for (const p of VIDEO_DEPTH_PROVIDERS) {
      const lanes = [FAL_VIDEO_DEPTH_PROVIDERS.has(p), REPLICATE_VIDEO_DEPTH_PROVIDERS.has(p)].filter(Boolean)
      expect(lanes).toHaveLength(1)
    }
  })
  it("fal has all three levers, Replicate only colormap, unknown none", () => {
    expect([...videoDepthLevers("video-depth-anything")].sort()).toEqual(["colormap", "resolution", "sideBySide"])
    expect([...videoDepthLevers("depth-anything-frames")]).toEqual(["colormap"])
    expect(videoDepthLevers("nope").size).toBe(0)
  })
})

describe("videoDepthColormaps", () => {
  it("fal offers all five in order, Replicate grayscale + inferno, unknown none", () => {
    expect(videoDepthColormaps("video-depth-anything")).toEqual([...VIDEO_DEPTH_COLORMAPS])
    expect(videoDepthColormaps("depth-anything-frames")).toEqual(["grayscale", "inferno"])
    expect(videoDepthColormaps("nope")).toEqual([])
  })
})

describe("resolveVideoDepthColormap", () => {
  it("keeps a colormap the provider offers", () => {
    expect(resolveVideoDepthColormap("video-depth-anything", "turbo")).toBe("turbo")
    expect(resolveVideoDepthColormap("depth-anything-frames", "inferno")).toBe("inferno")
  })
  it("coerces an unsupported, missing or garbage value to grayscale", () => {
    expect(resolveVideoDepthColormap("depth-anything-frames", "turbo")).toBe("grayscale")
    expect(resolveVideoDepthColormap("depth-anything-frames", undefined)).toBe("grayscale")
    expect(resolveVideoDepthColormap("video-depth-anything", 42)).toBe("grayscale")
  })
  it("returns undefined for a provider with no colormap lever", () => {
    expect(resolveVideoDepthColormap("nope", "turbo")).toBeUndefined()
  })
})

describe("videoDepthNeedsGrayscalePass", () => {
  it("Replicate needs the pass unless inferno is chosen", () => {
    expect(videoDepthNeedsGrayscalePass("depth-anything-frames", undefined)).toBe(true)
    expect(videoDepthNeedsGrayscalePass("depth-anything-frames", "grayscale")).toBe(true)
    expect(videoDepthNeedsGrayscalePass("depth-anything-frames", "inferno")).toBe(false)
  })
  it("fal never needs the pass", () => {
    expect(videoDepthNeedsGrayscalePass("video-depth-anything", "grayscale")).toBe(false)
  })
})

describe("checkVideoDepthLength", () => {
  it("fal: exactly 2400 frames passes, 2401 rejects", () => {
    expect(checkVideoDepthLength("video-depth-anything", { durationSec: 100, fps: 24 })).toEqual({ ok: true })
    const r = checkVideoDepthLength("video-depth-anything", { durationSec: 100.01, fps: 24 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/2,401 frames.*2,400.*100 s at 24 fps/)
  })
  it("fal: unknown fps assumes 30 (80 s cap)", () => {
    expect(checkVideoDepthLength("video-depth-anything", { durationSec: 80 })).toEqual({ ok: true })
    const r = checkVideoDepthLength("video-depth-anything", { durationSec: 80.1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/assumed 30 fps/)
  })
  it("fal: also capped at 300 s (the top price bucket), whatever the frame count", () => {
    expect(VIDEO_DEPTH_LIMITS.FAL_MAX_SECONDS).toBe(300)
    // 5 fps × 480 s = 2,400 frames: within the frame limit, over the seconds cap.
    const long = checkVideoDepthLength("video-depth-anything", { durationSec: 480, fps: 5 })
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.message).toBe("Video is 480 s. This provider accepts at most 300 s. Trim the clip and run again.")
    // 8 fps × 300 s = 2,400 frames: both limits met exactly.
    expect(checkVideoDepthLength("video-depth-anything", { durationSec: 300, fps: 8 })).toEqual({ ok: true })
    const over = checkVideoDepthLength("video-depth-anything", { durationSec: 300.5, fps: 1 })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.message).toMatch(/^Video is 301 s\. This provider accepts at most 300 s\./)
  })
  it("replicate: seconds cap", () => {
    expect(checkVideoDepthLength("depth-anything-frames", { durationSec: VIDEO_DEPTH_LIMITS.REPLICATE_MAX_SECONDS })).toEqual({ ok: true })
    expect(checkVideoDepthLength("depth-anything-frames", { durationSec: 80.5 }).ok).toBe(false)
  })
})

describe("videoDepthCreditId", () => {
  it("buckets by duration, boundaries inclusive", () => {
    expect(videoDepthCreditId("video-depth-anything", 5)).toBe("video-depth-anything:15s")
    expect(videoDepthCreditId("video-depth-anything", 15)).toBe("video-depth-anything:15s")
    expect(videoDepthCreditId("video-depth-anything", 15.01)).toBe("video-depth-anything:30s")
    expect(videoDepthCreditId("depth-anything-frames", 61)).toBe("depth-anything-frames:120s")
    expect(videoDepthCreditId("video-depth-anything", 299)).toBe("video-depth-anything:300s")
  })
  it("unknown, non-positive or over-cap duration prices the provider's highest REACHABLE bucket", () => {
    // fal: capped at 300 s → the 300 s row.
    expect(videoDepthCreditId("video-depth-anything", undefined)).toBe("video-depth-anything:300s")
    expect(videoDepthCreditId("video-depth-anything", 0)).toBe("video-depth-anything:300s")
    expect(videoDepthCreditId("video-depth-anything", 900)).toBe("video-depth-anything:300s")
    // Replicate: capped at 80 s → the 120 s row; a longer clip is refused, so the 300 s row is unreachable.
    expect(videoDepthCreditId("depth-anything-frames", undefined)).toBe("depth-anything-frames:120s")
    expect(videoDepthCreditId("depth-anything-frames", -1)).toBe("depth-anything-frames:120s")
    expect(videoDepthCreditId("depth-anything-frames", Number.NaN)).toBe("depth-anything-frames:120s")
    expect(videoDepthCreditId("depth-anything-frames", 200)).toBe("depth-anything-frames:120s")
    expect(videoDepthCreditId("depth-anything-frames", 80)).toBe("depth-anything-frames:120s")
  })
  it("derives each reachable ceiling from the limits: the smallest bucket at or above the provider's longest clip", () => {
    const ceilingFor = (maxSec: number) => VIDEO_DEPTH_BUCKETS.find((b) => b >= maxSec)
    expect(videoDepthCreditId("depth-anything-frames", undefined)).toBe(`depth-anything-frames:${ceilingFor(VIDEO_DEPTH_LIMITS.REPLICATE_MAX_SECONDS)}s`)
    expect(videoDepthCreditId("video-depth-anything", undefined)).toBe(`video-depth-anything:${ceilingFor(VIDEO_DEPTH_LIMITS.FAL_MAX_SECONDS)}s`)
  })
})

// Raw workflow JSON can carry any value; every layer that dispatches, denies or
// prices a run reads the SAME resolved provider, so none of them can drift.
describe("resolveVideoDepthProvider", () => {
  it("keeps a known provider, resolves missing/unknown/non-string to the default", () => {
    expect(resolveVideoDepthProvider("depth-anything-frames")).toBe("depth-anything-frames")
    expect(resolveVideoDepthProvider("video-depth-anything")).toBe("video-depth-anything")
    for (const raw of [undefined, null, "", "nope", "constructor", 42]) {
      expect(resolveVideoDepthProvider(raw), String(raw)).toBe("video-depth-anything")
    }
  })
})

describe("resolveVideoDepthModelSize", () => {
  it("keeps a known size, resolves anything else to large", () => {
    expect(resolveVideoDepthModelSize("small")).toBe("small")
    expect(resolveVideoDepthModelSize("base")).toBe("base")
    for (const raw of [undefined, "huge", "constructor", 1]) {
      expect(resolveVideoDepthModelSize(raw), String(raw)).toBe("large")
    }
  })
})
