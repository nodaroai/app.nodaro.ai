import { describe, it, expect } from "vitest"
import { freeVideoRefusal, freeVideoRequestForJob, freeVideoRequestOf } from "../free-video-limits.js"
import { drivingAudioFreeVideoRequest } from "../../../lib/driving-audio-measure.js"

/**
 * Free credits and LTX 2.5 Fast audio-to-video (decided 2026-11-23): an
 * audio-driven run is judged by its shortest audio clip ONLY when the server
 * measured it. A body or payload that claims one is read as before.
 */
const LIMITS = { enabled: true, maxSeconds: 4 } as const
const SPOOF = { provider: "ltx-2.5-fast", resolution: "720p", audioToVideo: true, drivingAudioBilledSec: 2, duration: 2 }

describe("the free-credit readers", () => {
  it("a body claiming an audio-driven run is judged exactly as one without the claim (the passthrough fallback)", () => {
    const { audioToVideo: _a, drivingAudioBilledSec: _b, ...plain } = SPOOF
    expect(freeVideoRequestOf(SPOOF)).toEqual(freeVideoRequestOf(plain))
    expect(freeVideoRequestOf(SPOOF)?.audioDriven).toBeUndefined()
    // LTX 2.5 Fast stays locked: its text and image runs start at 6 s.
    expect(freeVideoRefusal(freeVideoRequestOf(SPOOF)!, LIMITS)).not.toBeNull()
  })

  it("a job payload claiming one is read the same way", () => {
    for (const job of ["generate-video", "image-to-video", "text-to-video", "generate-video-pro"]) {
      expect(freeVideoRequestForJob(job, "ltx-2.5-fast:2s:720p", SPOOF)?.audioDriven, job).toBeUndefined()
    }
  })

  it("the server's own measurement is judged by the audio-driven rule: open at 720p up to 4 s, locked above", () => {
    expect(freeVideoRefusal(drivingAudioFreeVideoRequest("ltx-2.5-fast", { billedSec: 4, resolution: "720p" }), LIMITS)).toBeNull()
    expect(freeVideoRefusal(drivingAudioFreeVideoRequest("ltx-2.5-fast", { billedSec: 5, resolution: "720p" }), LIMITS)).not.toBeNull()
    expect(freeVideoRefusal(drivingAudioFreeVideoRequest("ltx-2.5-fast", { billedSec: 3, resolution: "1080p" }), LIMITS)).not.toBeNull()
  })
})
