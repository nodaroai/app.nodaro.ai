import { describe, it, expect } from "vitest"
import {
  AUDIO_CROSSFADE_CURVES,
  AUDIO_CROSSFADE_CURVE_IDS,
  DEFAULT_AUDIO_CROSSFADE_CURVE_ID,
  resolveAudioCrossfadeCurve,
} from "../audio-crossfade-curves.js"

describe("AUDIO_CROSSFADE_CURVES catalog", () => {
  it("has unique ids and ffmpeg names", () => {
    const ids = AUDIO_CROSSFADE_CURVES.map((c) => c.id)
    const ffmpeg = AUDIO_CROSSFADE_CURVES.map((c) => c.ffmpeg)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ffmpeg).size).toBe(ffmpeg.length)
  })

  it("default id exists in the catalog", () => {
    expect(AUDIO_CROSSFADE_CURVE_IDS).toContain(DEFAULT_AUDIO_CROSSFADE_CURVE_ID)
  })

  it("resolveAudioCrossfadeCurve maps known ids to acrossfade names", () => {
    expect(resolveAudioCrossfadeCurve("linear")).toBe("tri")
    expect(resolveAudioCrossfadeCurve("equal-power")).toBe("qsin")
    expect(resolveAudioCrossfadeCurve("smooth")).toBe("hsin")
    expect(resolveAudioCrossfadeCurve("logarithmic")).toBe("log")
    expect(resolveAudioCrossfadeCurve("exponential")).toBe("exp")
  })

  it("resolveAudioCrossfadeCurve falls back to `tri` for undefined or unknown", () => {
    expect(resolveAudioCrossfadeCurve(undefined)).toBe("tri")
    expect(resolveAudioCrossfadeCurve("not-a-curve")).toBe("tri")
  })
})
