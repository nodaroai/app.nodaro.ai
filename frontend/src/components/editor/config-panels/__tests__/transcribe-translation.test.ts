import { describe, expect, it } from "vitest"
import { TRANSCRIBE_TARGET_LANGUAGES } from "@nodaro/shared/models"
import { en } from "@/lib/i18n/en"
import { TRANSCRIBE_TARGET_LANGUAGE_LABEL_KEYS, transcribeTranslationSnap } from "../transcribe-translation"

describe("the Transcribe node's Translate to (Nemotron 3.5 Transcribe)", () => {
  it("names every language KIE translates into, in English at least", () => {
    for (const code of TRANSCRIBE_TARGET_LANGUAGES) {
      const key = TRANSCRIBE_TARGET_LANGUAGE_LABEL_KEYS[code]
      expect(key, code).toBe(`langname.${code}`)
      expect(en[key], code).toBeTruthy()
    }
  })

  it("clears a translation the engine cannot run (the step-12b fail-safe), and only then", () => {
    expect(transcribeTranslationSnap("elevenlabs-stt", "en")).toEqual({ targetLanguage: undefined })
    expect(transcribeTranslationSnap("whisper", "he")).toEqual({ targetLanguage: undefined })
    expect(transcribeTranslationSnap(undefined, "en")).toEqual({ targetLanguage: undefined })
    expect(transcribeTranslationSnap("nemotron-3-5-transcribe", "en")).toBeNull()
    expect(transcribeTranslationSnap("elevenlabs-stt", undefined)).toBeNull()
    expect(transcribeTranslationSnap("elevenlabs-stt", "")).toBeNull()
  })
})
