import { describe, it, expect, vi, beforeEach } from "vitest"

// Decided 2026-11-16: Seedance 2.5 Flash takes a reference video only between
// 1:2.5 and 2.5:1 (width to height). The one gate every lane runs before a hold
// (`probeAndCheckRefVideoDurations`: the video routes' pre-check, a Video to
// Video edit, the workflow run, the quotes) refuses any other shape.

const probe = vi.hoisted(() => ({
  durations: new Map<string, number>(),
  sizes: new Map<string, { width: number; height: number }>(),
}))

vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  probeMediaDuration: vi.fn(async (url: string) => probe.durations.get(url) ?? 8),
  probeVideoSource: vi.fn(async (url: string) => {
    const size = probe.sizes.get(url)
    if (!size) throw new Error("unreadable")
    return { ...size, durationSeconds: probe.durations.get(url) ?? 8 }
  }),
}))

import { probeAndCheckRefVideoDurations, refVideoShapeProblem } from "../ref-video-probe.js"
import { probeVideoSource } from "../../providers/video/ffmpeg-utils.js"

const WIDE = "https://cdn.example.com/wide.mp4"
const TALL = "https://cdn.example.com/tall.mp4"
const HD = "https://cdn.example.com/hd.mp4"
const UNREADABLE = "https://cdn.example.com/unreadable.mp4"

beforeEach(() => {
  vi.mocked(probeVideoSource).mockClear()
  probe.sizes.clear()
  probe.sizes.set(WIDE, { width: 3840, height: 1080 })
  probe.sizes.set(TALL, { width: 400, height: 1080 })
  probe.sizes.set(HD, { width: 1920, height: 1080 })
})

describe("the reference-video shape gate", () => {
  it("refuses a clip wider than 2.5:1 or taller than 1:2.5 on Seedance 2.5 Flash, with its own code", async () => {
    for (const url of [WIDE, TALL]) {
      const check = await probeAndCheckRefVideoDurations({ provider: "seedance-2-5-flash", referenceVideoUrls: [HD, url] })
      expect(check.ok, url).toBe(false)
      if (!check.ok) {
        expect(check.code).toBe("video_aspect_unsupported")
        expect(check.message).toMatch(/1:2\.5 to 2\.5:1/)
        expect(check.durationsSec).toHaveLength(2)
      }
    }
  })

  it("passes a shape Flash takes, and never refuses a clip whose size cannot be read", async () => {
    expect(await probeAndCheckRefVideoDurations({ provider: "seedance-2-5-flash", referenceVideoUrls: [HD, UNREADABLE] })).toMatchObject({ ok: true })
  })

  it("does not probe the shape for a model with no picture rule (Seedance 2.5 takes the wide clip)", async () => {
    expect(await probeAndCheckRefVideoDurations({ provider: "seedance-2-5", referenceVideoUrls: [WIDE] })).toMatchObject({ ok: true })
    expect(await refVideoShapeProblem("seedance-2-5", [WIDE])).toBeUndefined()
    expect(probeVideoSource).not.toHaveBeenCalled()
  })

  it("a length refusal comes first, as before", async () => {
    probe.durations.set(WIDE, 45)
    const check = await probeAndCheckRefVideoDurations({ provider: "seedance-2-5-flash", referenceVideoUrls: [WIDE] })
    expect(check).toMatchObject({ ok: false })
    if (!check.ok) expect(check.code).toBeUndefined()
    probe.durations.delete(WIDE)
  })
})
