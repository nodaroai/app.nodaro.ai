import { beforeEach, describe, expect, it, vi } from "vitest"

const probe = vi.hoisted(() => ({ duration: vi.fn() }))
vi.mock("../../../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe.duration }))
const { measuredAudioSeconds } = await import("../_audio-length.js")

beforeEach(() => probe.duration.mockReset())

describe("measuredAudioSeconds", () => {
  it("rounds the measured length up to 0.1 s", async () => {
    probe.duration.mockResolvedValue(10.01)
    expect(await measuredAudioSeconds("https://a/v.mp3")).toBe(10.1)
    probe.duration.mockResolvedValue(8)
    expect(await measuredAudioSeconds("https://a/v.mp3")).toBe(8)
  })
  it("a probe failure or an unusable length gives nothing, so the route keeps today's bucket", async () => {
    probe.duration.mockRejectedValue(new Error("ffprobe failed"))
    expect(await measuredAudioSeconds("https://a/v.mp3")).toBeUndefined()
    for (const d of [Number.NaN, 0, -1, 600.01]) {
      probe.duration.mockReset().mockResolvedValue(d)
      expect(await measuredAudioSeconds("https://a/v.mp3"), String(d)).toBeUndefined()
    }
  })
})
