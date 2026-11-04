import { describe, it, expect } from "vitest"
import { budget } from "../budget.js"
import { DOWNLOAD_MAX_MS, FFPROBE_TIMEOUT_MS } from "../../../providers/video/ffmpeg-timeouts.js"
import { SHOT_CUTS_MAX_DURATION_SEC, SHOT_CUTS_MAX_FRAME_SHOTS, shotCutsDecodeTimeoutMs, shotCutsFrameUploadsMs } from "../../../providers/video/shot-cuts-plan.js"

describe("shot-cuts budget", () => {
  const decode = shotCutsDecodeTimeoutMs(SHOT_CUTS_MAX_DURATION_SEC)
  it("the download, the probe and the scoring decode of a 30-minute clip; with frames on, the frames decode and 2,000 frame uploads too", () => {
    expect(budget({ videoUrl: "https://media.test/clip.mp4" })).toBe(DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + decode)
    expect(budget({ videoUrl: "https://media.test/clip.mp4", frames: true })).toBe(DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + 2 * decode + shotCutsFrameUploadsMs(SHOT_CUTS_MAX_FRAME_SHOTS))
  })
  it("is past the 90-minute default (so the node is long-running), and nothing for a payload with no video", () => {
    expect(budget({ videoUrl: "https://media.test/clip.mp4" })!).toBeGreaterThan(90 * 60_000)
    expect(budget({})).toBeUndefined()
    expect(budget(null)).toBeUndefined()
  })
})
