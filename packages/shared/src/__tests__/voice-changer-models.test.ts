import { describe, it, expect } from "vitest"
import {
  VOICE_CHANGER_MODELS,
  VOICE_CHANGER_MODEL_IDS,
  DEFAULT_VOICE_CHANGER_MODEL,
} from "../voice-changer-models.js"

describe("voice-changer-models", () => {
  it("exposes the ElevenLabs speech-to-speech models", () => {
    expect(VOICE_CHANGER_MODEL_IDS).toEqual([
      "eleven_english_sts_v2",
      "eleven_multilingual_sts_v2",
    ])
  })

  it("defaults to the English model to preserve prior behavior", () => {
    // The provider hardcoded eleven_english_sts_v2 before this lever existed;
    // keeping it the default means existing nodes/output never change.
    expect(DEFAULT_VOICE_CHANGER_MODEL).toBe("eleven_english_sts_v2")
    expect(VOICE_CHANGER_MODEL_IDS).toContain(DEFAULT_VOICE_CHANGER_MODEL)
  })

  it("gives every model a non-empty label and description for the picker", () => {
    expect(VOICE_CHANGER_MODELS.length).toBe(VOICE_CHANGER_MODEL_IDS.length)
    for (const m of VOICE_CHANGER_MODELS) {
      expect(m.value.length).toBeGreaterThan(0)
      expect(m.label.length).toBeGreaterThan(0)
      expect(m.desc.length).toBeGreaterThan(0)
    }
  })
})
