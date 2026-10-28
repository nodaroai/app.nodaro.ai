import { describe, expect, it } from "vitest"
import { audioSoundtrackActive, audioSoundtrackClipSec, audioSoundtrackPrompt, AUDIO_SOUNDTRACK_MIN_SEC } from "../audio-soundtrack"

describe("audioSoundtrackActive", () => {
  it("is on by default for a model that can play a soundtrack, once a clip is there", () => {
    expect(audioSoundtrackActive({ provider: "kling-4", audioSoundtrack: undefined, audioRefCount: 1 })).toBe(true)
    expect(audioSoundtrackActive({ provider: "kling-4", audioSoundtrack: true, audioRefCount: 3 })).toBe(true)
  })

  it("is off when turned off, with no clip, or on a model that follows the audio itself", () => {
    expect(audioSoundtrackActive({ provider: "kling-4", audioSoundtrack: false, audioRefCount: 1 })).toBe(false)
    expect(audioSoundtrackActive({ provider: "kling-4", audioSoundtrack: undefined, audioRefCount: 0 })).toBe(false)
    expect(audioSoundtrackActive({ provider: "seedance-2", audioSoundtrack: true, audioRefCount: 1 })).toBe(false)
    expect(audioSoundtrackActive({ provider: "kling-4-keyframes", audioSoundtrack: true, audioRefCount: 1 })).toBe(false)
    expect(audioSoundtrackActive({ provider: undefined, audioSoundtrack: true, audioRefCount: 1 })).toBe(false)
  })
})

describe("audioSoundtrackClipSec", () => {
  it("is the audio's length within [2 s, the clip], on whole 24 fps frames", () => {
    expect(audioSoundtrackClipSec(3.4, 5)).toBe(82 / 24)
    expect(audioSoundtrackClipSec(3.375, 5)).toBe(3.375)
    expect(audioSoundtrackClipSec(14, 5)).toBe(5)
    expect(audioSoundtrackClipSec(0.8, 5)).toBe(AUDIO_SOUNDTRACK_MIN_SEC)
  })

  it("counts an audio of unknown length as the whole clip", () => {
    expect(audioSoundtrackClipSec(Number.NaN, 8)).toBe(8)
    expect(audioSoundtrackClipSec(0, 8)).toBe(8)
  })
})

describe("audioSoundtrackPrompt", () => {
  it("names the soundtrack clip where the prompt named the first audio, and moves the rest down", () => {
    const out = audioSoundtrackPrompt("use the exact audio from @audio_1, and @audio_2 is the narrator; @audio_10x stays", 2)
    expect(out).toContain("use the exact audio from @video_2, and @audio_1 is the narrator")
    expect(out).toContain("@audio_10x stays")
    expect(out.startsWith("@video_2 is the soundtrack:")).toBe(true)
  })

  it("leaves the sentence out when it would push the prompt past the model's limit", () => {
    const long = "x".repeat(990) + " @audio_1"
    expect(audioSoundtrackPrompt(long, 1, 1000)).toBe("x".repeat(990) + " @video_1")
  })

  it("adds the soundtrack sentence to an empty prompt", () => {
    expect(audioSoundtrackPrompt("  ", 1)).toMatch(/^@video_1 is the soundtrack:/)
  })
})
