import { describe, expect, it } from "vitest"
import { buildPitchTempoArgs, buildRubberbandFilter, isMissingRubberbandError, normalizePitchTempoSettings, PitchTempoInputError } from "../pitch-tempo.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

describe("buildRubberbandFilter", () => {
  it("sends the pitch ratio, tempo, formant and quality every time", () => {
    expect(buildRubberbandFilter({ semitones: 3, tempo: 1, preserveFormants: true })).toBe(
      "rubberband=pitch=1.189207:tempo=1:formant=preserved:pitchq=quality",
    )
    expect(buildRubberbandFilter({ semitones: -5, tempo: 0.5, preserveFormants: false })).toBe(
      "rubberband=pitch=0.749154:tempo=0.5:formant=shifted:pitchq=quality",
    )
  })

  it("is an exact octave at ±12 and a no-op ratio at 0", () => {
    expect(buildRubberbandFilter({ semitones: 12, tempo: 2, preserveFormants: true })).toContain("pitch=2:tempo=2:")
    expect(buildRubberbandFilter({ semitones: -12, tempo: 1, preserveFormants: true })).toContain("pitch=0.5:")
    expect(buildRubberbandFilter({ semitones: 0, tempo: 1, preserveFormants: true })).toContain("pitch=1:")
  })
})

describe("buildPitchTempoArgs", () => {
  const filter = "rubberband=pitch=2:tempo=1:formant=preserved:pitchq=quality"

  it("audio lane: drops any picture and encodes MP3", () => {
    expect(buildPitchTempoArgs({ inputPath: "/w/in.wav", outputPath: "/w/out.mp3", lane: "audio", filter })).toEqual([
      "-y", "-i", "/w/in.wav", "-vn", "-af", filter, "-c:a", "libmp3lame", "-b:a", "192k", "/w/out.mp3",
    ])
  })

  it("video lane: copies the picture and holds the audio to the picture's length", () => {
    const args = buildPitchTempoArgs({ inputPath: "/w/in.mp4", outputPath: "/w/out.mp4", lane: "video", filter, sourceSec: 12.3456789 })
    expect(args).toEqual([
      "-y", "-i", "/w/in.mp4",
      "-map", "0:v:0", "-map", "0:a:0",
      "-c:v", "copy",
      "-af", `${filter},apad,atrim=end=12.345679`,
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      "/w/out.mp4",
    ])
  })

  it("video lane refuses to run without the picture's length", () => {
    expect(() => buildPitchTempoArgs({ inputPath: "/w/in.mp4", outputPath: "/w/out.mp4", lane: "video", filter })).toThrow(/length/)
  })
})

describe("errors", () => {
  it("recognises a build without librubberband", () => {
    expect(isMissingRubberbandError(new Error("[AVFilterGraph @ 0x1] No such filter: 'rubberband'"))).toBe(true)
    expect(isMissingRubberbandError(new Error("Error parsing filterchain 'rubberband=…': Filter not found"))).toBe(true)
    expect(isMissingRubberbandError(new Error("Invalid data found when processing input"))).toBe(false)
  })

  it("marks an input refusal as deterministic, so the worker fails it once and refunds", () => {
    expect(isDeterministicJobError(new PitchTempoInputError("no audio"))).toBe(true)
  })
})

describe("normalizePitchTempoSettings (the workflow lane skips the route's Zod)", () => {
  it("fills the defaults", () => {
    expect(normalizePitchTempoSettings({})).toEqual({ semitones: 0, tempo: 1, preserveFormants: true })
  })

  it("holds values to the node's ranges and reads numeric strings from field mappings", () => {
    expect(normalizePitchTempoSettings({ semitones: 30, tempo: 9, preserveFormants: false })).toEqual({ semitones: 12, tempo: 2, preserveFormants: false })
    expect(normalizePitchTempoSettings({ semitones: "-20", tempo: "0.1" })).toEqual({ semitones: -12, tempo: 0.5, preserveFormants: true })
    expect(normalizePitchTempoSettings({ semitones: "abc", tempo: Number.NaN })).toEqual({ semitones: 0, tempo: 1, preserveFormants: true })
  })
})
