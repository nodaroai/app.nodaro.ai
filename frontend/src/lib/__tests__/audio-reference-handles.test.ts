// @vitest-environment node
import { describe, expect, it } from "vitest"
import { audioReferencesLabel, sendsReferenceVideo } from "../audio-reference-handles"

describe("audioReferencesLabel", () => {
  it("keeps Audio Refs on Kling 4.0 while the first clip plays as the soundtrack (the default)", () => {
    expect(audioReferencesLabel("kling-4", undefined)).toBe("Audio Refs")
    expect(audioReferencesLabel("kling-4", true)).toBe("Audio Refs")
  })

  it("names the pip Voice Refs on Kling 4.0 once the soundtrack is off — every clip is then a voice sample", () => {
    expect(audioReferencesLabel("kling-4", false)).toBe("Voice Refs")
  })

  it("keeps Audio Refs for a model that follows the audio, and when no model is known", () => {
    expect(audioReferencesLabel("seedance-2", false)).toBe("Audio Refs")
    expect(audioReferencesLabel(undefined, undefined)).toBe("Audio Refs")
  })
})

describe("sendsReferenceVideo", () => {
  const audioWire = { target: "gv", targetHandle: "audioReferences" }
  const videoWire = { target: "gv", targetHandle: "videoReferences" }

  it("is true for a wired reference video on any model", () => {
    expect(sendsReferenceVideo("gv", "seedance-2", undefined, [videoWire])).toBe(true)
  })

  it("is true for a Kling 4.0 audio clip while it plays as the soundtrack", () => {
    expect(sendsReferenceVideo("gv", "kling-4", undefined, [audioWire])).toBe(true)
    expect(sendsReferenceVideo("gv", "kling-4", false, [audioWire])).toBe(false)
  })

  it("is false for audio on a model that takes it as audio", () => {
    expect(sendsReferenceVideo("gv", "seedance-2", undefined, [audioWire])).toBe(false)
  })
})
