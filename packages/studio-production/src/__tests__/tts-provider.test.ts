import { TTS_PROVIDERS, type VoiceType } from "@nodaro/shared"
import { describe, it, expect } from "vitest"

import {
  VOICE_TYPES,
  isTtsProvider,
  isVoiceType,
  resolveTtsProvider,
} from "../tts-provider"

describe("resolveTtsProvider", () => {
  it("defaults to elevenlabs-v3 when the voice carries no stored provider (premade/custom)", () => {
    expect(resolveTtsProvider(undefined)).toBe("elevenlabs-v3")
    expect(resolveTtsProvider({})).toBe("elevenlabs-v3")
    expect(resolveTtsProvider({ ttsProvider: undefined })).toBe("elevenlabs-v3")
  })

  it("keeps a library voice's verified provider over the default", () => {
    expect(resolveTtsProvider({ ttsProvider: "elevenlabs-multilingual" })).toBe(
      "elevenlabs-multilingual",
    )
  })
})

/**
 * plan-import-v2 D4 fix round 1 — the single narrowing every reader of an
 * untrusted `ttsProvider` field uses (the import repair step, the plan
 * reader), so a provider id valid nowhere on the platform can never reach a
 * `text-to-speech` call or silently vanish on the next reload.
 */
describe("isTtsProvider", () => {
  it("accepts every id the platform's own TTS_PROVIDERS list carries", () => {
    for (const id of TTS_PROVIDERS) expect(isTtsProvider(id)).toBe(true)
  })

  it("rejects an invented provider id and a non-string", () => {
    expect(isTtsProvider("acme")).toBe(false)
    expect(isTtsProvider(undefined)).toBe(false)
    expect(isTtsProvider(3)).toBe(false)
  })
})

describe("VOICE_TYPES", () => {
  it("names exactly the three values VoiceType allows", () => {
    // Compile-time pin: a VoiceType this array doesn't list fails here.
    const pin: ReadonlyArray<VoiceType> = VOICE_TYPES
    expect(pin).toEqual(["premade", "library", "custom"])
  })
})

/** The twin of {@link isTtsProvider} — both untrusted readers (`repairVoice`,
 *  `scene-plan`'s `readVoice`) hand-rolled this check before it existed. */
describe("isVoiceType", () => {
  it("accepts every VOICE_TYPES value", () => {
    for (const t of VOICE_TYPES) expect(isVoiceType(t)).toBe(true)
  })

  it("rejects an invented type and a non-string", () => {
    expect(isVoiceType("robot")).toBe(false)
    expect(isVoiceType(undefined)).toBe(false)
    expect(isVoiceType(3)).toBe(false)
  })
})
