import { describe, it, expect } from "vitest"
import { SPLIT_MEDIA_MAX_PARTS, SPLIT_MEDIA_MAX_SOURCE_SEC } from "@nodaro/render-rules"
import { DOWNLOAD_MAX_MS, FFPROBE_TIMEOUT_MS } from "../ffmpeg-timeouts.js"
import { BIG_MEDIA_MAX_BYTES } from "../ffmpeg-timeouts.js"
import { videoMaskFfmpegTimeoutMs } from "../video-mask.js"
import {
  SHOT_CUTS_MAX_BYTES,
  SHOT_CUTS_MAX_DURATION_SEC,
  SHOT_CUTS_FRAME_UPLOAD_MS,
  SHOT_CUTS_MAX_FRAME_SHOTS,
  SHOT_CUTS_UPLOAD_CONCURRENCY,
  planShots,
  shotCutsFrameUploadsMs,
  shotCutsJobBudgetMs,
  shotCutsDecodeTimeoutMs,
  shotCutsTooLongMessage,
  shotCutsTooManyFramesMessage,
} from "../shot-cuts-plan.js"
import { framesToSave, selectFramesExpr } from "../shot-cuts.js"

describe("Shot Cuts caps", () => {
  it("30 minutes; Split into Chunks' bytes per second of footage (about 10.7 GiB); frames for up to 1,000 shots, its own cap (Split keeps 200 parts)", () => {
    expect(SHOT_CUTS_MAX_DURATION_SEC).toBe(1800)
    expect(SHOT_CUTS_MAX_BYTES).toBe(Math.floor(BIG_MEDIA_MAX_BYTES / (SPLIT_MEDIA_MAX_SOURCE_SEC / 1800)))
    expect(SHOT_CUTS_MAX_BYTES / 1024 ** 3).toBeCloseTo(10.67, 2)
    expect(SHOT_CUTS_MAX_FRAME_SHOTS).toBe(1_000)
    expect(SPLIT_MEDIA_MAX_PARTS).toBe(200)
  })

  it("a decode's kill budget is Video Mask's scan budget for the same length", () => {
    for (const sec of [0, 1, 299.5, 1800]) expect(shotCutsDecodeTimeoutMs(sec)).toBe(videoMaskFfmpegTimeoutMs(sec))
  })

  it("the refusals name the limit and the count", () => {
    expect(shotCutsTooLongMessage(1800.2)).toMatch(/1801 seconds long; Shot Cuts measures clips up to 30 minutes/)
    expect(shotCutsTooManyFramesMessage(1_250)).toMatch(/1250 shots; first and last frames are saved for up to 1000 shots/)
  })
})

describe("the job budget with frames", () => {
  it("covers the most frames a run saves: 1,000 shots × 2 PNGs on a 30-minute clip, uploaded 6 at a time, 10 s each", () => {
    const decode = shotCutsDecodeTimeoutMs(SHOT_CUTS_MAX_DURATION_SEC)
    const uploads = Math.ceil((2 * SHOT_CUTS_MAX_FRAME_SHOTS) / SHOT_CUTS_UPLOAD_CONCURRENCY) * SHOT_CUTS_FRAME_UPLOAD_MS
    expect(shotCutsFrameUploadsMs(SHOT_CUTS_MAX_FRAME_SHOTS)).toBe(uploads)
    expect(uploads).toBe(334 * 10_000)
    expect(shotCutsJobBudgetMs({ videoUrl: "https://v", frames: true })).toBe(DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + 2 * decode + uploads)
    // about 6.3 hours; without frames there are no uploads to allow for
    expect(shotCutsJobBudgetMs({ videoUrl: "https://v", frames: true })! / 3_600_000).toBeCloseTo(6.29, 2)
    expect(shotCutsJobBudgetMs({ videoUrl: "https://v" })).toBe(DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + decode)
  })
})

describe("planShots", () => {
  it("cuts → shots: each from its cut to the next, the first from 0, the last to the end; frames from the cut frames", () => {
    expect(planShots([{ sec: 1, frame: 24 }, { sec: 2.5, frame: 60 }], 84, 3.5)).toEqual({
      durationSec: 3.5,
      cutsSec: [1, 2.5],
      shots: [
        { index: 0, startSec: 0, endSec: 1, durationSec: 1, firstFrame: 0, lastFrame: 23 },
        { index: 1, startSec: 1, endSec: 2.5, durationSec: 1.5, firstFrame: 24, lastFrame: 59 },
        { index: 2, startSec: 2.5, endSec: 3.5, durationSec: 1, firstFrame: 60, lastFrame: 83 },
      ],
    })
  })

  it("one shot: no cuts, one shot covering the clip", () => {
    expect(planShots([], 48, 2.0004)).toEqual({
      durationSec: 2,
      cutsSec: [],
      shots: [{ index: 0, startSec: 0, endSec: 2, durationSec: 2, firstFrame: 0, lastFrame: 47 }],
    })
  })

  it("a cut at 0, at the end or past it starts no shot (the scene-cuts route's filter); lengths to the millisecond", () => {
    const plan = planShots([{ sec: 0, frame: 0 }, { sec: 1.0004, frame: 24 }, { sec: 3, frame: 72 }, { sec: 4, frame: 96 }], 72, 3)
    expect(plan.cutsSec).toEqual([1.0004])
    expect(plan.shots.map((s) => [s.startSec, s.endSec, s.durationSec])).toEqual([[0, 1.0004, 1], [1.0004, 3, 2]])
  })

  it("a one-frame shot's first frame is its last", () => {
    const plan = planShots([{ sec: 1, frame: 24 }, { sec: 1.042, frame: 25 }], 48, 2)
    expect(plan.shots[1]).toMatchObject({ firstFrame: 24, lastFrame: 24 })
    expect(framesToSave(plan.shots)).toEqual([0, 23, 24, 25, 47])
  })
})

describe("the frames decode's select expression", () => {
  it("keeps exactly the frames named, by their number", () => {
    expect(selectFramesExpr([0, 23, 24])).toBe("eq(n,0)+eq(n,23)+eq(n,24)")
    expect(() => selectFramesExpr([])).toThrow()
    expect(() => selectFramesExpr([1.5])).toThrow()
  })
})
