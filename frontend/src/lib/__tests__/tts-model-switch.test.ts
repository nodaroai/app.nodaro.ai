// @vitest-environment node
import { describe, it, expect } from "vitest"
import { ttsDirection, ttsSupportsStitching } from "@nodaro/shared/model-catalog"
import { GEMINI_3_1_DEFAULT_VOICE, GEMINI_3_8_DEFAULT_VOICE, GEMINI_3_1_TTS_STYLES, GEMINI_3_1_TTS_PACES, GEMINI_3_1_TTS_ACCENTS } from "@nodaro/shared/models"
import { ttsModelSwitchPatch } from "../tts-model-switch"

const LITE_38 = "gemini-3-8-flash-lite-tts"
const FLASH_38 = "gemini-3-8-flash-tts"
const FLASH_31 = "gemini-3-1-flash-tts"
const PRO_25 = "gemini-2-5-pro-tts"
const snapped = (voice: string) => ({ voiceId: voice, voiceType: "premade", voiceDisplayName: voice, voiceLabel: voice })

describe("ttsModelSwitchPatch — what a user's model switch clears", () => {
  const tuned = { similarityBoost: 0.8, style: 0.3, speed: 1.15, languageCode: "he" }

  it("to v3: similarity, style and speed go; Hebrew stays (v3 offers it)", () => {
    const patch = ttsModelSwitchPatch("elevenlabs-v3", tuned)
    expect(patch).toStrictEqual({ similarityBoost: undefined, style: undefined, speed: undefined })
    // toStrictEqual distinguishes an explicit `undefined` from an absent key, and the store
    // only REMOVES a stored value when the patch carries its key.
    expect(Object.keys(patch).sort()).toEqual(["similarityBoost", "speed", "style"])
  })

  it("to v4: speed and style go, similarity stays (v4 honours it), Hebrew stays", () => {
    const patch = ttsModelSwitchPatch("elevenlabs-v4", tuned)
    expect(patch).toStrictEqual({ style: undefined, speed: undefined })
    expect(Object.keys(patch).sort()).toEqual(["speed", "style"])
  })

  it("to v4 Turbo: speed and style go, similarity stays, Hebrew stays — exactly as to v4", () => {
    expect(ttsModelSwitchPatch("elevenlabs-v4-turbo", tuned)).toStrictEqual(ttsModelSwitchPatch("elevenlabs-v4", tuned))
  })

  it("to turbo: every lever stays, but Hebrew is not offered, so the language resets to auto-detect", () => {
    expect(ttsModelSwitchPatch("elevenlabs-turbo", tuned)).toStrictEqual({ languageCode: "" })
  })

  it("to multilingual: every lever stays; Hebrew is not offered", () => {
    expect(ttsModelSwitchPatch("elevenlabs-multilingual", tuned)).toStrictEqual({ languageCode: "" })
  })

  it("a node that already fits the model yields an empty patch — nothing to write, nothing to mark dirty", () => {
    expect(ttsModelSwitchPatch("elevenlabs-v3", {})).toStrictEqual({})
    expect(ttsModelSwitchPatch("elevenlabs-v3", { languageCode: "" })).toStrictEqual({})
    expect(ttsModelSwitchPatch("elevenlabs-turbo", { similarityBoost: 0.75, style: 0, speed: 1, languageCode: "en" })).toStrictEqual({})
  })

  it("clears only what the node actually carries", () => {
    expect(ttsModelSwitchPatch("elevenlabs-v3", { speed: 1 })).toStrictEqual({ speed: undefined })
    expect(ttsModelSwitchPatch("elevenlabs-v4", { speed: 1, similarityBoost: 0.5 })).toStrictEqual({ speed: undefined })
  })

  it("a switch to the legacy alias, an unknown id or a missing id reads as turbo", () => {
    for (const next of ["elevenlabs", "not-a-model", "elevenlabs-dialogue", "constructor"]) {
      expect(ttsModelSwitchPatch(next, tuned), next).toStrictEqual({ languageCode: "" })
    }
  })

  describe("neighbour text (continuity)", () => {
    const withContext = { previousText: "Before.", nextText: "After." }

    it("to a model that does not stitch (v3): both are reset to empty, in the same patch as the levers", () => {
      const patch = ttsModelSwitchPatch("elevenlabs-v3", { ...tuned, ...withContext })
      expect(patch).toStrictEqual({ similarityBoost: undefined, style: undefined, speed: undefined, previousText: "", nextText: "" })
    })

    it("to v4: both stay", () => {
      expect(ttsModelSwitchPatch("elevenlabs-v4", withContext)).toStrictEqual({})
    })

    it("to v4 Turbo: both stay iff its sheet stitches", () => {
      const patch = ttsModelSwitchPatch("elevenlabs-v4-turbo", withContext)
      expect(patch).toStrictEqual(ttsSupportsStitching("elevenlabs-v4-turbo") ? {} : { previousText: "", nextText: "" })
    })

    it("clears only a side the node actually carries, and never an already-empty one", () => {
      expect(ttsModelSwitchPatch("elevenlabs-v3", { previousText: "Before." })).toStrictEqual({ previousText: "" })
      expect(ttsModelSwitchPatch("elevenlabs-v3", { previousText: "", nextText: "" })).toStrictEqual({})
      expect(ttsModelSwitchPatch("elevenlabs-v3", {})).toStrictEqual({})
    })
  })

  describe("a model with named voices (Gemini)", () => {
    // What a fresh ElevenLabs node stores (types/nodes.ts defaultData): the voice and every lever.
    const freshNode = {
      provider: "elevenlabs-v4", voiceId: "Rachel", voiceType: "premade", voiceDisplayName: "Rachel",
      stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, languageCode: "", previousText: "", nextText: "",
    }

    it("from a fresh v4 node to 3.8: the voice snaps to 3.8's default and every lever but stability goes (it honours none; stability is never cleared)", () => {
      expect(ttsModelSwitchPatch(LITE_38, freshNode)).toStrictEqual({
        similarityBoost: undefined, style: undefined, speed: undefined,
        ...snapped(GEMINI_3_8_DEFAULT_VOICE),
      })
    })

    it("a language resets to auto-detect (the language follows the text); neighbour text is emptied", () => {
      const patch = ttsModelSwitchPatch(FLASH_31, { provider: "elevenlabs-v4", languageCode: "he", previousText: "Before.", nextText: "After." })
      expect(patch).toStrictEqual({ languageCode: "", previousText: "", nextText: "" })
    })

    it("a clone or a library voice snaps to the model's default, as a premade voice", () => {
      expect(ttsModelSwitchPatch(FLASH_31, { provider: "elevenlabs-v3", voiceId: "clone-1", voiceType: "custom", voiceDisplayName: "My voice", voiceLabel: "My voice" }))
        .toStrictEqual(snapped(GEMINI_3_1_DEFAULT_VOICE))
      expect(ttsModelSwitchPatch(PRO_25, { provider: "elevenlabs-v3", voiceId: "lib-1", voiceType: "library" })).toStrictEqual(snapped(GEMINI_3_1_DEFAULT_VOICE))
    })

    it("an empty voice stays empty — it runs as the model's default already", () => {
      expect(ttsModelSwitchPatch(LITE_38, { provider: "elevenlabs-v4", voiceId: "" })).toStrictEqual({})
      expect(ttsModelSwitchPatch(LITE_38, { provider: "elevenlabs-v4" })).toStrictEqual({})
    })

    it("between generations: a voice both lists have stays, one the new list lacks snaps to its default", () => {
      expect(ttsModelSwitchPatch(FLASH_31, { provider: LITE_38, voiceId: "Kore", voiceType: "premade", voiceDisplayName: "Kore", voiceLabel: "Kore" })).toStrictEqual({})
      expect(ttsModelSwitchPatch(FLASH_31, { provider: LITE_38, voiceId: GEMINI_3_8_DEFAULT_VOICE, voiceType: "premade" })).toStrictEqual(snapped(GEMINI_3_1_DEFAULT_VOICE))
      expect(ttsModelSwitchPatch(LITE_38, { provider: FLASH_31, voiceId: "Zephyr", voiceType: "premade" })).toStrictEqual({})
    })

    it("within a generation nothing moves", () => {
      const node = { provider: LITE_38, voiceId: "Bodi", voiceType: "premade", voiceDisplayName: "Bodi", voiceLabel: "Bodi", styleDirection: "Warm." }
      expect(ttsModelSwitchPatch(FLASH_38, node)).toStrictEqual({})
      expect(ttsModelSwitchPatch(PRO_25, { provider: FLASH_31, voiceId: "Puck", styleDirection: "Whisper", pace: "Natural", accent: "Neutral", audioProfile: "A narrator." })).toStrictEqual({})
    })

    it("leaving one for an ElevenLabs model: the voice goes back to none (what a fresh node on a curated deployment holds), its names cleared", () => {
      const node = { provider: LITE_38, voiceId: "Bodi", voiceType: "premade", voiceDisplayName: "Bodi", voiceLabel: "Bodi" }
      expect(ttsModelSwitchPatch("elevenlabs-v4", node)).toStrictEqual({ voiceId: "", voiceDisplayName: undefined, voiceLabel: undefined })
      // The names are cleared as keys (the store removes them), so the browser shows no stale Gemini name.
      expect(Object.keys(ttsModelSwitchPatch("elevenlabs-v3", node)).sort()).toEqual(["voiceDisplayName", "voiceId", "voiceLabel"])
    })

    it("an ElevenLabs-to-ElevenLabs switch never touches the voice", () => {
      expect(ttsModelSwitchPatch("elevenlabs-v3", { provider: "elevenlabs-v4", voiceId: "Rachel", voiceDisplayName: "Rachel" })).toStrictEqual({})
      expect(ttsModelSwitchPatch("elevenlabs-v4", { provider: undefined, voiceId: "Rachel" })).toStrictEqual({})
    })
  })

  describe("style direction", () => {
    it("3.8's free text is not one of 3.1's styles: cleared", () => {
      expect(ttsModelSwitchPatch(FLASH_31, { provider: LITE_38, styleDirection: "Warm and unhurried." })).toStrictEqual({ styleDirection: undefined })
    })

    it("a 3.1 style is valid free text on 3.8: kept; its pace, accent and audio profile are cleared (3.8 takes none)", () => {
      const node = { provider: FLASH_31, styleDirection: GEMINI_3_1_TTS_STYLES[1], pace: GEMINI_3_1_TTS_PACES[0], accent: GEMINI_3_1_TTS_ACCENTS[0], audioProfile: "A narrator." }
      expect(ttsModelSwitchPatch(LITE_38, node)).toStrictEqual({ pace: undefined, accent: undefined, audioProfile: undefined })
    })

    it("to an ElevenLabs model every direction field goes", () => {
      const node = { provider: FLASH_31, styleDirection: "Whisper", pace: "Natural", accent: "Neutral", audioProfile: "A narrator." }
      expect(ttsModelSwitchPatch("elevenlabs-v4", node)).toStrictEqual({ styleDirection: undefined, pace: undefined, accent: undefined, audioProfile: undefined })
    })

    it("a value padded with spaces that the model still takes is not a change", () => {
      expect(ttsModelSwitchPatch(FLASH_38, { provider: LITE_38, styleDirection: "  calm  " })).toStrictEqual({})
    })

    it("empty and missing fields are never written", () => {
      expect(ttsModelSwitchPatch("elevenlabs-v4", { styleDirection: "", pace: undefined, accent: "", audioProfile: "" })).toStrictEqual({})
    })

    it("the sheets this pins: 3.8 takes free text only, 3.1 and 2.5 take the four fields", () => {
      expect(Object.keys(ttsDirection(LITE_38) ?? {})).toEqual(["styleMaxChars"])
      expect(Object.keys(ttsDirection(PRO_25) ?? {}).sort()).toEqual(["accents", "audioProfileMaxChars", "paces", "styles"])
    })
  })
})

describe("ttsModelSwitchPatch — a one-off clone (decided 2026-11-13)", () => {
  const replica = { sourceAudioUrl: "https://cdn.example/me.wav", consentAudioUrl: "https://cdn.example/consent.wav" }

  it("goes on a switch to a model that does not clone (Flash-Lite, 3.1, ElevenLabs)", () => {
    for (const next of ["gemini-3-8-flash-lite-tts", "gemini-3-1-flash-tts", "elevenlabs-v3"]) {
      expect(ttsModelSwitchPatch(next, { provider: "gemini-3-8-flash-tts", voiceId: "Kore", replica }), next).toHaveProperty("replica", undefined)
    }
  })

  it("stays on a switch to the model that clones (no key)", () => {
    expect(ttsModelSwitchPatch("gemini-3-8-flash-tts", { provider: "gemini-3-8-flash-lite-tts", voiceId: "Kore", replica })).not.toHaveProperty("replica")
  })
})

describe("ttsModelSwitchPatch — the clone's consent (decided 2026-11-13)", () => {
  const replica = { sourceAudioUrl: "https://cdn.example/me.wav", consentAudioUrl: "https://cdn.example/consent.wav" }

  it("goes with the clone on a switch to a model that does not clone, even when no recording is stored", () => {
    expect(ttsModelSwitchPatch("gemini-3-8-flash-lite-tts", { provider: "gemini-3-8-flash-tts", voiceId: "Kore", replica, replicaConsent: true }))
      .toMatchObject({ replica: undefined, replicaConsent: undefined })
    const lone = ttsModelSwitchPatch("elevenlabs-v3", { provider: "gemini-3-8-flash-tts", replicaConsent: true })
    expect(lone).toHaveProperty("replicaConsent", undefined)
  })

  it("stays on the model that clones", () => {
    const patch = ttsModelSwitchPatch("gemini-3-8-flash-tts", { provider: "gemini-3-8-flash-lite-tts", voiceId: "Kore", replica, replicaConsent: true })
    expect(patch).not.toHaveProperty("replica")
    expect(patch).not.toHaveProperty("replicaConsent")
  })
})
