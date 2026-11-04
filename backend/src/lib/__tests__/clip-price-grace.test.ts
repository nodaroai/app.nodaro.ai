import { beforeEach, describe, expect, it, vi } from "vitest"

// A whole-second cut of a 29.97 or 23.976 fps clip can come out a little long,
// and it is the file a run measures. Each step priced by length ignores up to
// 0.05 s past a whole second, so that cut is charged what a whole-second clip is,
// and the limits still read the file's real length.

const { mockProbe } = vi.hoisted(() => ({ mockProbe: vi.fn() }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: mockProbe }))
vi.mock("../credit-base-cost.js", () => ({ unitRateBaseCredits: vi.fn() }))

import { measureMaskCompositeLength } from "../mask-composite-length.js"
import { measureVideoDepthInput } from "../video-depth-input.js"
import { measureVideoFaceMeshLength } from "../video-face-mesh-length.js"
import { measureVideoMaskLength } from "../video-mask-length.js"

const clip = (durationSeconds: number, fps?: number) =>
  mockProbe.mockResolvedValue({ width: 640, height: 360, durationSeconds, ...(fps === undefined ? {} : { fps }) })
const URL = "https://x/v.mp4"

beforeEach(() => {
  mockProbe.mockReset()
})

describe("what the Video Depth route and a workflow run reserve", () => {
  it.each([
    [4.004, 4],
    [5.005, 5],
    [10.01, 10],
    [12.012, 12],
    [15.015, 15],
    [4.05, 4],
    [4.051, 5],
    [0.02, 1],
    [12, 12],
  ])("video-depth-anything: %s s is %i s", async (sec, whole) => {
    clip(sec, 29.97)
    expect(await measureVideoDepthInput("video-depth-anything", URL)).toEqual({ ok: true, durationSec: whole, creditId: `video-depth-anything:${whole}s` })
  })

  it("the 300 s limit still reads the file: 300 s is priced, 300.02 s is refused", async () => {
    clip(300, 7)
    expect(await measureVideoDepthInput("video-depth-anything", URL)).toEqual({ ok: true, durationSec: 300, creditId: "video-depth-anything:300s" })
    // At 7 fps it is 2,101 frames, under the frame cap: only the 300 s limit can refuse it.
    clip(300.02, 7)
    expect(await measureVideoDepthInput("video-depth-anything", URL)).toMatchObject({ ok: false, code: "video_too_long", message: expect.stringContaining("at most 300 s") })
  })

  it.each([
    [4.004, 4, 15],
    [15, 15, 15],
    [15.015, 15, 15],
    [15.051, 16, 30],
    [30.03, 30, 30],
    [30.051, 31, 60],
    [60.0266, 60, 60],
    [60.06, 61, 120],
  ])("depth-anything-frames: %s s is %i s, the %i s price step", async (sec, whole, step) => {
    clip(sec, 29.97)
    expect(await measureVideoDepthInput("depth-anything-frames", URL)).toEqual({ ok: true, durationSec: whole, creditId: `depth-anything-frames:${step}s` })
  })

  it("depth-anything-frames' 80 s limit still reads the file: 80 s is priced, 80.02 s is refused", async () => {
    clip(80, 29.97)
    expect(await measureVideoDepthInput("depth-anything-frames", URL)).toEqual({ ok: true, durationSec: 80, creditId: "depth-anything-frames:120s" })
    clip(80.02, 29.97)
    expect(await measureVideoDepthInput("depth-anything-frames", URL)).toMatchObject({ ok: false, code: "video_too_long" })
  })
})

describe.each([
  ["Video Mask", measureVideoMaskLength, "sam-3.1-video"],
  ["the face mesh", measureVideoFaceMeshLength, "video-face-mesh"],
])("what %s reserves", (_name, measure, rowPrefix) => {
  it.each([
    [4.004, 4, 5],
    [5.005, 5, 5],
    [10.01, 10, 10],
    [12.012, 12, 15],
    [15.015, 15, 15],
    [5.05, 5, 5],
    [5.051, 6, 10],
    [0.02, 1, 5],
    [5, 5, 5],
  ])("%s s is priced at %i s, the %i s row", async (sec, billedSec, row) => {
    clip(sec, 29.97)
    expect(await measure(URL)).toEqual({ ok: true, billedSec, creditId: `${rowPrefix}:${row}s` })
  })

  it("the grace is on the priced length, at the 30 fps basis", async () => {
    clip(5.02, 60) // 10.04 s priced
    expect(await measure(URL)).toEqual({ ok: true, billedSec: 10, creditId: `${rowPrefix}:10s` })
    clip(5.03, 60) // 10.06 s priced
    expect(await measure(URL)).toEqual({ ok: true, billedSec: 11, creditId: `${rowPrefix}:15s` })
  })

  it("the 300 s limit still reads the file: 300 s is priced, 300.02 s is refused", async () => {
    clip(300, 30)
    expect(await measure(URL)).toEqual({ ok: true, billedSec: 300, creditId: `${rowPrefix}:300s` })
    clip(300.02, 30)
    expect(await measure(URL)).toMatchObject({ ok: false, code: "video_duration_exceeds_limit" })
  })
})

describe("what Mask Composite reserves", () => {
  it.each([
    [4.004, 1],
    [5.005, 1],
    [10.01, 2],
    [12.012, 3],
    [15.015, 3],
    [5.05, 1],
    [5.051, 2],
    [0.02, 1],
    [15, 3],
  ])("%s s is %i unit(s)", async (sec, units) => {
    clip(sec)
    expect(await measureMaskCompositeLength(URL)).toEqual({ ok: true, durationSec: sec, units })
  })

  it("the 300 s limit still reads the file: 300 s is 60 units, 300.02 s is refused", async () => {
    clip(300)
    expect(await measureMaskCompositeLength(URL)).toEqual({ ok: true, durationSec: 300, units: 60 })
    clip(300.02)
    expect(await measureMaskCompositeLength(URL)).toMatchObject({ ok: false, code: "video_duration_exceeds_limit" })
  })
})
