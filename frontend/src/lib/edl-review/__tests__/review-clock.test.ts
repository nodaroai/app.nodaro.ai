import { describe, it, expect } from "vitest"
import { normalizeEdl, remapMsThroughEdl } from "@nodaro/shared"
import { clockMapOf, masterOfPreviewTime, previewSeekOfWord, previewTimeOfMaster } from "../review-clock"

const VIDEO = { output: "video", crossfadeMs: 0, sources: [] } as const
const edl = normalizeEdl({
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "cam" }, { id: "s1", inMs: 2000, outMs: 3000, video: "cam" }],
})

describe("the preview's clock (A3-1's clocks, as the player reads them)", () => {
  it("is the effective EDL the render builds, from a wired string or an object", () => {
    expect(clockMapOf(JSON.stringify(edl), VIDEO)?.segments.length).toBe(2)
    expect(clockMapOf(edl, VIDEO)?.segments.map((s) => s.inMs)).toEqual([0, 2000])
  })

  it("is null with nothing to read", () => {
    expect(clockMapOf(undefined, VIDEO)).toBeNull()
    expect(clockMapOf("{nope", VIDEO)).toBeNull()
  })

  it("maps master time to preview time and back", () => {
    const map = clockMapOf(edl, VIDEO)
    expect(previewTimeOfMaster(map, 2500)).toBe(1500)
    expect(masterOfPreviewTime(map, 1500)).toBe(2500)
    expect(previewTimeOfMaster(map, 1500)).toBeNull()
    expect(previewTimeOfMaster(null, 2500)).toBeNull()
    expect(masterOfPreviewTime(null, 10)).toBeNull()
  })

  it("seeks a word to its first kept instant: a word whose start was cut plays from where it is kept", () => {
    const map = clockMapOf(edl, VIDEO)
    expect(previewSeekOfWord(map, { startMs: 2200, endMs: 2400 })).toBe(1200)
    expect(previewSeekOfWord(map, { startMs: 1800, endMs: 2300 })).toBe(remapMsThroughEdl(map!, 2000))
    expect(previewSeekOfWord(map, { startMs: 1200, endMs: 1400 })).toBeNull()
    // The transcript's own clock: master = source + offset.
    expect(previewSeekOfWord(map, { startMs: 1700, endMs: 1900 }, 500)).toBe(1200)
  })
})
