import { describe, it, expect } from "vitest"
import {
  VIDEO_AUDIO_CAPABILITY,
  getVideoAudioCapability,
  videoModelSupportsAudio,
  videoModelCanSpeakDialogue,
  AUDIO_ADDON_PROVIDERS,
  VEO_PROVIDERS,
  SEEDANCE_2_PROVIDERS,
} from "../model-constants.js"

describe("getVideoAudioCapability", () => {
  it("returns native_speech (always on) for the VEO family", () => {
    for (const m of ["veo3", "veo3.1", "veo3_lite"]) {
      const cap = getVideoAudioCapability(m)
      expect(cap.mode, m).toBe("native_speech")
      expect(cap.alwaysOn, m).toBe(true)
    }
  })

  it("returns ambient (sound toggle, cost-affecting) for Kling", () => {
    for (const m of ["kling", "kling-3.0"]) {
      const cap = getVideoAudioCapability(m)
      expect(cap.mode, m).toBe("ambient")
      expect(cap.field, m).toBe("sound")
      expect(cap.affectsCost, m).toBe(true)
    }
  })

  it("returns audio_driven for Seedance 2.0", () => {
    for (const m of ["seedance-2", "seedance-2-fast"]) {
      const cap = getVideoAudioCapability(m)
      expect(cap.mode, m).toBe("audio_driven")
      expect(cap.field, m).toBe("generateAudio")
    }
  })

  it("returns ambient (audio but not dialogue) for Seedance 1.x", () => {
    const cap = getVideoAudioCapability("seedance")
    expect(cap.mode).toBe("ambient")
    expect(cap.field).toBe("generateAudio")
  })

  it("defaults to none for silent / unknown / undefined models", () => {
    for (const m of [
      "minimax",
      "hailuo-2.3",
      "wan-i2v",
      "grok-i2v",
      "gemini-omni-video",
      "runway",
      "pika",
      "totally-unknown-model",
      undefined,
    ]) {
      expect(getVideoAudioCapability(m).mode, String(m)).toBe("none")
    }
  })
})

describe("videoModelSupportsAudio", () => {
  it("is true for any model with an audio mode, false for silent", () => {
    expect(videoModelSupportsAudio("veo3")).toBe(true)
    expect(videoModelSupportsAudio("kling-3.0")).toBe(true)
    expect(videoModelSupportsAudio("seedance-2")).toBe(true)
    expect(videoModelSupportsAudio("seedance")).toBe(true)
    expect(videoModelSupportsAudio("minimax")).toBe(false)
    expect(videoModelSupportsAudio(undefined)).toBe(false)
  })
})

describe("videoModelCanSpeakDialogue", () => {
  it("is true only for native_speech + audio_driven models", () => {
    expect(videoModelCanSpeakDialogue("veo3")).toBe(true)
    expect(videoModelCanSpeakDialogue("veo3_lite")).toBe(true)
    expect(videoModelCanSpeakDialogue("seedance-2")).toBe(true)
    expect(videoModelCanSpeakDialogue("seedance-2-fast")).toBe(true)
    // ambient-only models are NOT dialogue-capable — their audio is SFX/ambient
    expect(videoModelCanSpeakDialogue("kling")).toBe(false)
    expect(videoModelCanSpeakDialogue("kling-3.0")).toBe(false)
    expect(videoModelCanSpeakDialogue("seedance")).toBe(false)
    expect(videoModelCanSpeakDialogue("minimax")).toBe(false)
    expect(videoModelCanSpeakDialogue(undefined)).toBe(false)
  })
})

describe("VIDEO_AUDIO_CAPABILITY internal consistency", () => {
  it("every Kling AUDIO_ADDON provider is ambient + affectsCost", () => {
    for (const m of AUDIO_ADDON_PROVIDERS) {
      const cap = getVideoAudioCapability(m)
      expect(cap.mode, m).toBe("ambient")
      expect(cap.affectsCost, m).toBe(true)
    }
  })

  it("every VEO provider is native_speech", () => {
    for (const m of VEO_PROVIDERS) {
      expect(getVideoAudioCapability(m).mode, m).toBe("native_speech")
    }
  })

  it("every Seedance-2 provider is audio_driven", () => {
    for (const m of SEEDANCE_2_PROVIDERS) {
      expect(getVideoAudioCapability(m).mode, m).toBe("audio_driven")
    }
  })

  it("affectsCost is set only for AUDIO_ADDON providers", () => {
    for (const [model, cap] of Object.entries(VIDEO_AUDIO_CAPABILITY)) {
      if (cap.affectsCost) expect(AUDIO_ADDON_PROVIDERS.has(model), model).toBe(true)
    }
  })

  it("a user-controllable mode declares which field carries the toggle", () => {
    for (const [model, cap] of Object.entries(VIDEO_AUDIO_CAPABILITY)) {
      // alwaysOn models (VEO) have no toggle; everything else with audio must
      // name the provider option field so the UI + worker wire the right one.
      if (cap.mode !== "none" && !cap.alwaysOn) {
        expect(cap.field, model).toBeDefined()
      }
    }
  })
})
