/**
 * The render's check that a Trim, Loop or Combine Videos run was charged for
 * the clips it downloaded: the units those clips cost by the node's own
 * formula — each clip first shortened by the half-second re-measure slack —
 * must not exceed the units charged. A longer clip is refused (and refunded),
 * and so is a job that carries no priced units.
 */
import { describe, it, expect } from "vitest"
import { VIDEO_UTILITY_REMEASURE_SLACK_SEC, videoUtilityRefusalForCharge, videoUtilityUnpricedRefusal } from "../video-utility-refusal.js"

const trim = (billedUnits: unknown, upstreamDuration?: number) => ({ videoUrl: "https://cdn.example/v.mp4", trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0, billedUnits, upstreamDuration })
const loop = (billedUnits: unknown, upstreamDuration?: number, extra: Record<string, unknown> = {}) => ({ videoUrl: "https://cdn.example/v.mp4", mode: "repeat", repeatCount: 2, billedUnits, upstreamDuration, ...extra })
const combine = (billedUnits: unknown, upstreamDurations: number[]) => ({
  videoUrls: upstreamDurations.map((_, i) => `https://cdn.example/c${i}.mp4`),
  transition: "cut", transitionDuration: 0.5, trimStartFrames: 1, trimEndFrames: 2, billedUnits, upstreamDurations,
})

describe("videoUtilityRefusalForCharge", () => {
  it("the slack is half a second, as Mask Composite's", () => {
    expect(VIDEO_UTILITY_REMEASURE_SLACK_SEC).toBe(0.5)
  })

  it("clips no longer than they measured when priced pass (and a shorter one is never refused)", () => {
    expect(videoUtilityRefusalForCharge("trim-video", trim(2, 10), [10])).toBeUndefined()
    expect(videoUtilityRefusalForCharge("trim-video", trim(3, 10.04), [4])).toBeUndefined()
    expect(videoUtilityRefusalForCharge("loop-video", loop(4, 10), [10])).toBeUndefined()
    expect(videoUtilityRefusalForCharge("combine-videos", combine(4, [10, 10]), [10, 10])).toBeUndefined()
  })

  it("a re-measure up to half a second longer is the same file, and the frame grace holds there too: a Trim priced for 10 s renders at 10.6 s; 10.7 s is refused", () => {
    expect(videoUtilityRefusalForCharge("trim-video", trim(2, 10), [10.4])).toBeUndefined()
    // 10.6 − 0.5 (re-measure slack) − 0.15 (the grace) = 9.95 s: still 2 units.
    expect(videoUtilityRefusalForCharge("trim-video", trim(2, 10), [10.6])).toBeUndefined()
    expect(videoUtilityRefusalForCharge("trim-video", trim(2, 10), [10.7])).toEqual({
      code: "video_utility_input_changed",
      message: "The video is 11 seconds, longer than the 10 seconds this run was priced for — run it again",
    })
  })

  it("Loop: the slack comes off the clip, before its copies are counted", () => {
    // 2 × (10.4 − 0.5) = 19.8 s → 4 units: the same file.
    expect(videoUtilityRefusalForCharge("loop-video", loop(4, 10), [10.4])).toBeUndefined()
    expect(videoUtilityRefusalForCharge("loop-video", loop(4, 10), [12])?.message).toBe(
      "The video is 12 seconds, longer than the 10 seconds this run was priced for — run it again",
    )
  })

  it("a Loop to a target length and a Trim to a fixed window never read the clip's length", () => {
    expect(videoUtilityRefusalForCharge("loop-video", loop(2, 5, { mode: "duration", targetDuration: 10 }), [60])).toBeUndefined()
    expect(videoUtilityRefusalForCharge("trim-video", { videoUrl: "u", trimMode: "time", startTime: 0, endTime: 5, billedUnits: 1, upstreamDuration: 5 }, [60])).toBeUndefined()
  })

  it("Combine Videos names the clip that grew", () => {
    expect(videoUtilityRefusalForCharge("combine-videos", combine(4, [10, 10]), [10, 16])).toEqual({
      code: "video_utility_input_changed",
      message: "Clip 2 of 2 is 16 seconds, longer than the 10 seconds this run was priced for — run it again",
    })
  })

  it("a job that carries no usable priced units is refused — never rendered at a default", () => {
    for (const billedUnits of [undefined, null, 0, -1, Number.NaN, "3"]) {
      expect(videoUtilityRefusalForCharge("trim-video", trim(billedUnits, 10), [5])).toEqual({
        code: "video_utility_input_changed",
        message: "This run was not priced for its video — run it again",
      })
    }
    expect(videoUtilityUnpricedRefusal("combine-videos", undefined)?.message).toBe("This run was not priced for its clips — run it again")
    expect(videoUtilityUnpricedRefusal("loop-video", 3)).toBeUndefined()
  })
})

describe("the render's check counts frame trims at the rate it re-probes (decided 2026-11-14)", () => {
  // Charged 2 units for a 12 s clip cut 60 frames at 24 fps (11.9 − 2.5 = 9.4 s).
  const job = { billedUnits: 2, upstreamDuration: 12, trimEndFrames: 60, videoUrl: "https://cdn.example/a.mp4" }

  it("the same file at the same rate passes", () => {
    expect(videoUtilityRefusalForCharge("trim-video", job, [12], [24])).toBeUndefined()
  })

  it("a file served at a higher rate since (60 frames are then 1 s: 10.4 s, 3 units) is refused", () => {
    expect(videoUtilityRefusalForCharge("trim-video", job, [12], [60])?.code).toBe("video_utility_input_changed")
  })

  it("a rate it cannot read cuts no frames (the worker then fails on it): 3 units, refused", () => {
    expect(videoUtilityRefusalForCharge("trim-video", job, [12], [undefined])?.code).toBe("video_utility_input_changed")
  })
})
