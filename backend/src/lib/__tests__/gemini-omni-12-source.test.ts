import { describe, it, expect } from "vitest"
import { geminiOmni12CutEndSec, geminiOmni12LadderSec, geminiOmni12SourceWindow, videoRefBilledDurations } from "../gemini-omni-12-source.js"

describe("geminiOmni12SourceWindow", () => {
  it("sends a clip that fits as it is", () => {
    expect(geminiOmni12SourceWindow({ clipSec: 8 })).toEqual({ startSec: 0, endSec: 8, spanSec: 8, cut: false })
  })

  it("cuts a clip over KIE's 15 s however slightly, and one of exactly 15 s not at all", () => {
    expect(geminiOmni12SourceWindow({ clipSec: 15.02 })).toMatchObject({ endSec: 15, cut: true })
    expect(geminiOmni12SourceWindow({ clipSec: 15 }).cut).toBe(false)
  })

  it("does not cut for a requested end a hair inside the clip", () => {
    expect(geminiOmni12SourceWindow({ clipSec: 8.02, trim: { end: 8 } }).cut).toBe(false)
  })

  it("keeps the first 15 s of a longer clip", () => {
    expect(geminiOmni12SourceWindow({ clipSec: 40 })).toEqual({ startSec: 0, endSec: 15, spanSec: 15, cut: true })
  })

  it("honours the trim", () => {
    expect(geminiOmni12SourceWindow({ clipSec: 40, trim: { start: 5, end: 12 } })).toEqual({ startSec: 5, endSec: 12, spanSec: 7, cut: true })
  })

  it("holds a trim to 15 s from its start and to the clip's end", () => {
    expect(geminiOmni12SourceWindow({ clipSec: 60, trim: { start: 10, end: 50 } }).endSec).toBe(25)
    expect(geminiOmni12SourceWindow({ clipSec: 12, trim: { start: 5, end: 30 } })).toMatchObject({ endSec: 12, spanSec: 7 })
  })

  it("never lets a trim end before its start", () => {
    expect(geminiOmni12SourceWindow({ clipSec: 30, trim: { start: 8, end: 3 } })).toMatchObject({ startSec: 8, endSec: 9, spanSec: 1 })
  })

  it("with an unknown length: the most it can bill, and no cut unless a trim asks", () => {
    for (const clipSec of [undefined, Number.NaN, 0, -1, null]) {
      expect(geminiOmni12SourceWindow({ clipSec })).toEqual({ startSec: 0, endSec: 15, spanSec: 15, cut: false })
    }
    expect(geminiOmni12SourceWindow({ trim: { start: 2, end: 6 } })).toEqual({ startSec: 2, endSec: 6, spanSec: 4, cut: true })
  })

  it("a trim past the clip's end leaves nothing to send", () => {
    expect(geminiOmni12SourceWindow({ clipSec: 5, trim: { start: 9 } }).spanSec).toBeLessThanOrEqual(0)
  })
})

describe("videoRefBilledDurations", () => {
  it("cuts a per-second Omni clip by the trim", () => {
    expect(videoRefBilledDurations("gemini-omni-flash-1-2", [40], { start: 5, end: 12 })).toEqual([7])
    expect(videoRefBilledDurations("gemini-omni-flash-1-2", [40], undefined)).toEqual([15])
  })

  it("keeps an unreadable clip unknown unless a trim end sizes it", () => {
    expect(videoRefBilledDurations("gemini-omni-flash-1-2", [Number.NaN], undefined)[0]).toBeNaN()
    expect(videoRefBilledDurations("gemini-omni-flash-1-2", [Number.NaN], { start: 2, end: 6 })).toEqual([4])
  })

  it("leaves every other provider's clips alone", () => {
    const clips = [40]
    expect(videoRefBilledDurations("seedance-2-5", clips, { start: 5, end: 12 })).toBe(clips)
    expect(videoRefBilledDurations("kling-4", clips, undefined)).toBe(clips)
  })
})

describe("geminiOmni12CutEndSec", () => {
  it("ends a cut at the limit just inside it", () => {
    expect(geminiOmni12CutEndSec(geminiOmni12SourceWindow({ clipSec: 40 }))).toBeCloseTo(14.9)
    expect(geminiOmni12CutEndSec(geminiOmni12SourceWindow({ clipSec: 40, trim: { start: 5, end: 20 } }))).toBeCloseTo(19.9)
  })

  it("leaves a shorter window alone", () => {
    expect(geminiOmni12CutEndSec(geminiOmni12SourceWindow({ clipSec: 40, trim: { start: 5, end: 12 } }))).toBe(12)
  })
})

describe("geminiOmni12LadderSec", () => {
  it("lands a clip on a rung of the 3-15 s ladder", () => {
    expect(geminiOmni12LadderSec(8)).toBe(8)
    expect(geminiOmni12LadderSec(8.04)).toBe(8)
    expect(geminiOmni12LadderSec(8.4)).toBe(9)
    expect(geminiOmni12LadderSec(1.2)).toBe(3)
    expect(geminiOmni12LadderSec(20)).toBe(15)
  })
})
