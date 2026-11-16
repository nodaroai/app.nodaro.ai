/**
 * The order a picture's length is read in (`videoTrackLengthFrom`): the
 * stream's own, its DURATION tag, its packets — the container's only when all
 * three fail, a reading its step prices less the fallback's allowance.
 */
import { describe, expect, it, vi } from "vitest"
import { CONTAINER_FALLBACK_GRACE_SEC } from "@nodaro/render-rules"
import { videoTrackHeaderOf, videoTrackLengthFrom, videoTrackPricedSec } from "../video-track-length.js"

const noScan = vi.fn(async () => ({}))

describe("videoTrackLengthFrom", () => {
  it("the stream's own length first, then its tag; no scan", async () => {
    expect(await videoTrackLengthFrom({ streamSec: 5, tagSec: 6, streamIndex: 0, containerSec: 7 }, noScan)).toEqual({ sec: 5, reading: "video-stream" })
    expect(await videoTrackLengthFrom({ tagSec: 6, streamIndex: 0, containerSec: 7 }, noScan)).toEqual({ sec: 6, reading: "video-stream" })
    expect(noScan).not.toHaveBeenCalled()
  })

  it("a tag or a last packet that claims more than the container is held to the container (the bound an upload is quoted at)", async () => {
    expect(await videoTrackLengthFrom({ tagSec: 9, streamIndex: 0, containerSec: 5 }, noScan)).toEqual({ sec: 5, reading: "video-stream" })
    expect(await videoTrackLengthFrom({ streamIndex: 0, startTimeSec: 0, containerSec: 5 }, async () => ({ maxPtsEnd: 7 }))).toEqual({ sec: 5, reading: "video-stream" })
    // Within the container, as read; no container stated, as read.
    expect(await videoTrackLengthFrom({ tagSec: 4.9, containerSec: 5 }, noScan)).toEqual({ sec: 4.9, reading: "video-stream" })
    expect(await videoTrackLengthFrom({ tagSec: 9 }, noScan)).toEqual({ sec: 9, reading: "video-stream" })
  })

  it("neither: the packets, less the file's start time", async () => {
    const scan = vi.fn(async () => ({ maxPtsEnd: 5.044 }))
    expect(await videoTrackLengthFrom({ streamIndex: 2, startTimeSec: 0.044, containerSec: 5.367 }, scan)).toEqual({ sec: expect.closeTo(5, 9), reading: "video-stream" })
    expect(scan).toHaveBeenCalledWith(2)
  })

  it("the container only when all three fail: a scan that finds nothing, fails or runs out of time; and priced less its allowance", async () => {
    for (const scan of [async () => ({}), async () => { throw new Error("ffprobe failed") }, async () => { throw Object.assign(new Error("slow"), { timedOut: true }) }]) {
      const track = await videoTrackLengthFrom({ streamIndex: 0, containerSec: 5.1 }, scan)
      expect(track).toEqual({ sec: 5.1, reading: "container" })
      expect(videoTrackPricedSec(track!)).toBeCloseTo(5.1 - CONTAINER_FALLBACK_GRACE_SEC, 9)
    }
    // No stream index to scan: the container straight away.
    expect(await videoTrackLengthFrom({ containerSec: 5.1 }, noScan)).toEqual({ sec: 5.1, reading: "container" })
    // No length anywhere: nothing (the caller's own refusal).
    expect(await videoTrackLengthFrom({}, async () => ({}))).toBeUndefined()
  })

  it("a scan stopped by its caller is thrown as it is, never read as a fallback", async () => {
    const stop = new AbortController()
    stop.abort()
    await expect(videoTrackLengthFrom({ streamIndex: 0, containerSec: 5 }, async () => { throw Object.assign(new Error("aborted"), { aborted: true }) }, stop.signal)).rejects.toThrow("aborted")
  })

  it("a probed video source as its header", () => {
    expect(videoTrackHeaderOf({ durationSeconds: 5.3, videoTagDurationSeconds: 5, videoStreamIndex: 0, startTimeSeconds: 0 })).toEqual({ tagSec: 5, streamIndex: 0, startTimeSec: 0, containerSec: 5.3 })
  })
})
