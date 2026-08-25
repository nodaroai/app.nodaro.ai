import { describe, it, expect } from "vitest"
import { deriveKieEgressDimensions as d } from "../egress-dimensions.js"

describe("deriveKieEgressDimensions", () => {
  it("reads resolution from resolution / output_resolution / video_resolution", () => {
    expect(d({ resolution: "1080P" }).resolution).toBe("1080P")
    expect(d({ output_resolution: "4K" }).resolution).toBe("4K")
    expect(d({ video_resolution: "720p" }).resolution).toBe("720p")
  })

  it("reads audio as a boolean from audio, generate_audio, or sound, else omits", () => {
    expect(d({ audio: true }).audio).toBe(true)
    expect(d({ generate_audio: false }).audio).toBe(false)
    // Kling's native audio lever is `sound` (a real 2× cost lever); it must be
    // read or kling-2.6 audio is silently dropped from the priced dimensions.
    expect(d({ sound: true }).audio).toBe(true)
    expect(d({ sound: false }).audio).toBe(false)
    expect("audio" in d({})).toBe(false)
  })

  it("flags videoInput true when a video source is present, false when a body clearly has none", () => {
    expect(d({ video_url: "https://x/v.mp4" }).videoInput).toBe(true)
    // `video_urls` (plural) is the standard V2V / motion-control array field.
    expect(d({ video_urls: ["https://x/v.mp4"] }).videoInput).toBe(true)
    expect(d({ video_list: ["https://x/v.mp4"] }).videoInput).toBe(true)
    expect(d({ input_video: "https://x/v.mp4" }).videoInput).toBe(true)
  })

  it("does NOT flag videoInput for an empty video array (omitted, never guessed)", () => {
    expect("videoInput" in d({ video_urls: [] })).toBe(false)
    expect("videoInput" in d({ video_list: [] })).toBe(false)
  })

  it("ignores the generic `mode` key (grok fun/normal, lip-sync lite/basic) — resolution is synthesized at the call site", () => {
    // The helper must NOT read `mode` generically. Kling-motion sites synthesize
    // `{ resolution: mode }` themselves; a bare `mode` body yields no resolution.
    expect("resolution" in d({ mode: "720p" })).toBe(false)
    // …and a synthesized `resolution` (what the motion call sites pass) IS read.
    expect(d({ mode: "720p", resolution: "720p", video_urls: ["https://x/v.mp4"] })).toEqual({
      resolution: "720p",
      videoInput: true,
    })
  })

  it("emits nothing billable for aleph / luma bodies (camelCase videoUrl is not a wire lever)", () => {
    // runway-aleph / luma-modify build `{ prompt, videoUrl }` (camelCase) and do
    // not even call the helper; if they did, it must stay empty.
    expect(d({ prompt: "x", videoUrl: "https://x/v.mp4" })).toEqual({})
  })

  it("emits duration (number) and durationLabel (rounded seconds) together", () => {
    expect(d({ duration: 6 }).duration).toBe(6)
    expect(d({ duration: 6 }).durationLabel).toBe("6s")
    expect(d({ duration: "8" }).duration).toBe(8)      // stringy body value
    expect(d({ duration: "8" }).durationLabel).toBe("8s")
    expect(d({ duration_seconds: 10 }).durationLabel).toBe("10s") // sfx body key
  })

  it("omits duration for a non-positive / non-finite value", () => {
    expect("duration" in d({ duration: 0 })).toBe(false)
    expect("durationLabel" in d({ duration: 0 })).toBe(false)
    expect("duration" in d({ duration: "abc" })).toBe(false)
  })

  it("counts characters from text, and from a joined dialogue array", () => {
    expect(d({ text: "hello world" }).characters).toBe(11)
    expect(d({ dialogue: [{ text: "ab" }, { text: "cde" }] }).characters).toBe(5)
    expect("characters" in d({ text: "" })).toBe(false)
  })

  it("returns an empty object for a body with no billable dimension", () => {
    expect(d({ prompt: "hi" })).toEqual({})
  })
})
