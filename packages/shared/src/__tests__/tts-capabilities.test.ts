import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, SPEECH_UNIT_PRICE_NOTE } from "../model-catalog.js"
import { TTS_PROVIDERS, MAX_TTS_CHARS_BY_PROVIDER, getMaxTtsChars, TTS_TEXT_MAX } from "../model-constants.js"
import {
  TTS_PROVIDER_ALIASES,
  TTS_FALLBACK_PROVIDER,
  canonicalTtsProvider,
  findTtsCapabilities,
  getTtsCapabilities,
  ttsSupportsAudioTags,
  ttsSupportsSsmlBreaks,
  ttsSupportsStitching,
  ttsHasLever,
  ttsLanguageCodes,
  ttsSupportsTimestamps,
} from "../tts-capabilities.js"

describe("speech-model capability sheets — totality", () => {
  it("every text-to-speech provider id resolves to a catalog model with a sheet and a price", () => {
    for (const id of TTS_PROVIDERS) {
      const entry = MODEL_CATALOG[canonicalTtsProvider(id)]
      expect(entry, `${id} has no catalog entry`).toBeDefined()
      expect(entry!.tts, `${id} has no capability sheet`).toBeDefined()
      expect(entry!.pricing.length, `${id} has no pricing row`).toBeGreaterThan(0)
    }
  })

  it("every catalog model that speaks (tts or dialogue mode) carries a sheet, and nothing else does", () => {
    for (const m of Object.values(MODEL_CATALOG)) {
      const speaks = m.modes.includes("tts") || m.modes.includes("dialogue")
      expect(m.tts !== undefined, `${m.id}: sheet presence must match its modes`).toBe(speaks)
    }
  })

  it("every non-alias provider id IS a catalog id, and every alias points at a real speech model", () => {
    for (const id of TTS_PROVIDERS) {
      if (id in TTS_PROVIDER_ALIASES) continue
      expect(MODEL_CATALOG[id]?.modes).toContain("tts")
    }
    for (const [alias, target] of Object.entries(TTS_PROVIDER_ALIASES)) {
      expect(MODEL_CATALOG[alias], `${alias} is an alias and must not have its own entry`).toBeUndefined()
      expect(MODEL_CATALOG[target]?.tts).toBeDefined()
    }
    expect(MODEL_CATALOG[TTS_FALLBACK_PROVIDER]?.tts).toBeDefined()
  })

  it("each sheet is internally consistent", () => {
    for (const m of Object.values(MODEL_CATALOG)) {
      if (!m.tts) continue
      expect(Number.isInteger(m.tts.maxChars) && m.tts.maxChars > 0, `${m.id} maxChars`).toBe(true)
      expect(m.tts.levers, `${m.id} must honour stability`).toContain("stability")
      expect(new Set(m.tts.levers).size, `${m.id} duplicate lever`).toBe(m.tts.levers.length)
      expect(m.tts.languages.length, `${m.id} languages`).toBeGreaterThan(0)
      expect(new Set(m.tts.languages).size, `${m.id} duplicate language`).toBe(m.tts.languages.length)
      // The `features` flag other packages already read must agree with the sheet.
      expect(m.features?.includes("audio-tags") ?? false, `${m.id} audio-tags feature`).toBe(m.tts.audioTags)
    }
  })

  it("every sheet says whether the model returns timings, and all six speech models do", () => {
    const yes = Object.values(MODEL_CATALOG).filter((m) => m.tts?.timestamps === true).map((m) => m.id).sort()
    for (const m of Object.values(MODEL_CATALOG)) {
      if (!m.tts) continue
      expect(typeof m.tts.timestamps, `${m.id} timestamps`).toBe("boolean")
    }
    // Measured 2026-10-04 (v4) and 2026-10-06 (the rest): /with-timestamps answers 200 on every
    // speech model at the same character cost. A new model joins this list only once it is measured.
    expect(yes).toEqual([
      "elevenlabs-dialogue",
      "elevenlabs-dialogue-v4",
      "elevenlabs-multilingual",
      "elevenlabs-turbo",
      "elevenlabs-v3",
      "elevenlabs-v4",
    ])
  })
})

describe("speech-model capability sheets — what each model does today", () => {
  it("v3: tags, no SSML, stability only, 5,000 characters, 46 languages", () => {
    const c = getTtsCapabilities("elevenlabs-v3")
    expect(c.audioTags).toBe(true)
    expect(c.ssmlBreaks).toBe(false)
    expect(c.levers).toEqual(["stability"])
    expect(c.languageCode).toBe(true)
    expect(c.maxChars).toBe(5000)
    expect(c.languages).toHaveLength(46)
    expect(c.languages).toContain("he")
  })

  it("turbo: no tags, SSML, all five levers, 40,000 characters, 32 languages", () => {
    const c = getTtsCapabilities("elevenlabs-turbo")
    expect(c.audioTags).toBe(false)
    expect(c.ssmlBreaks).toBe(true)
    expect(c.levers).toEqual(["stability", "similarity", "style", "speed", "speakerBoost"])
    expect(c.languageCode).toBe(true)
    expect(c.maxChars).toBe(40000)
    expect(c.languages).toHaveLength(32)
    expect(c.languages).not.toContain("he")
  })

  it("multilingual: no tags, SSML, all five levers, no language code, 10,000 characters, 29 languages", () => {
    const c = getTtsCapabilities("elevenlabs-multilingual")
    expect(c.audioTags).toBe(false)
    expect(c.ssmlBreaks).toBe(true)
    expect(c.levers).toEqual(["stability", "similarity", "style", "speed", "speakerBoost"])
    expect(c.languageCode).toBe(false)
    expect(c.maxChars).toBe(10000)
    expect(c.languages).toHaveLength(29)
  })

  it("dialogue (read from its catalog entry — its own lane): tags, stability only, 5,000 characters in total", () => {
    const c = MODEL_CATALOG["elevenlabs-dialogue"]!.tts!
    expect(c.audioTags).toBe(true)
    expect(c.levers).toEqual(["stability"])
    expect(c.maxChars).toBe(5000)
  })
})

describe("speech-model capability lookups", () => {
  it("the legacy alias reads as the model it runs on", () => {
    expect(canonicalTtsProvider("elevenlabs")).toBe("elevenlabs-turbo")
    expect(canonicalTtsProvider("elevenlabs-v3")).toBe("elevenlabs-v3")
    expect(findTtsCapabilities("elevenlabs")).toBe(getTtsCapabilities("elevenlabs-turbo"))
  })

  it("a missing or unknown id gets the fallback model's sheet, and `find` says it is unknown", () => {
    expect(findTtsCapabilities(undefined)).toBeUndefined()
    expect(findTtsCapabilities("")).toBeUndefined()
    expect(findTtsCapabilities("not-a-model")).toBeUndefined()
    expect(findTtsCapabilities("nano-banana-pro")).toBeUndefined() // a real model, not a speech model
    expect(getTtsCapabilities(undefined)).toBe(getTtsCapabilities("elevenlabs-turbo"))
    expect(getTtsCapabilities("not-a-model")).toBe(getTtsCapabilities("elevenlabs-turbo"))
  })

  it("an id that is the name of an inherited object member is an unknown id, never a function", () => {
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(canonicalTtsProvider(id), id).toBe(id)
      expect(findTtsCapabilities(id), id).toBeUndefined()
      expect(getTtsCapabilities(id), id).toBe(getTtsCapabilities("elevenlabs-turbo"))
      expect(ttsSupportsAudioTags(id), id).toBe(false)
      expect(getMaxTtsChars(id), id).toBe(TTS_TEXT_MAX)
    }
  })

  it("a non-string id (node data can be written straight into workflow JSON) is an unknown id — an array is not coerced into the model it spells", () => {
    for (const id of [["elevenlabs-v3"], ["elevenlabs-multilingual"], ["elevenlabs"], 3, {}, true, null] as unknown as string[]) {
      expect(findTtsCapabilities(id), JSON.stringify(id)).toBeUndefined()
      expect(getTtsCapabilities(id), JSON.stringify(id)).toBe(getTtsCapabilities("elevenlabs-turbo"))
      expect(ttsSupportsAudioTags(id), JSON.stringify(id)).toBe(false)
      expect(ttsHasLever(id, "style"), JSON.stringify(id)).toBe(true)
      expect(canonicalTtsProvider(id), JSON.stringify(id)).toBe(id)
    }
  })

  it("the dialogue model has a sheet for its own lane but is not a text-to-speech model: a speech request naming it runs as the fallback", () => {
    expect(MODEL_CATALOG["elevenlabs-dialogue"]!.tts).toBeDefined()
    expect(findTtsCapabilities("elevenlabs-dialogue")).toBeUndefined()
    expect(getTtsCapabilities("elevenlabs-dialogue")).toBe(getTtsCapabilities("elevenlabs-turbo"))
    expect(ttsSupportsAudioTags("elevenlabs-dialogue")).toBe(false)
    expect(ttsHasLever("elevenlabs-dialogue", "style")).toBe(true)
  })

  it("audio tags: kept on v3, stripped everywhere else (alias, unknown and missing included)", () => {
    expect(ttsSupportsAudioTags("elevenlabs-v3")).toBe(true)
    expect(ttsSupportsAudioTags("elevenlabs-turbo")).toBe(false)
    expect(ttsSupportsAudioTags("elevenlabs-multilingual")).toBe(false)
    expect(ttsSupportsAudioTags("elevenlabs")).toBe(false)
    expect(ttsSupportsAudioTags(undefined)).toBe(false)
    expect(ttsSupportsAudioTags("not-a-model")).toBe(false)
  })

  it("SSML breaks are the mirror image", () => {
    expect(ttsSupportsSsmlBreaks("elevenlabs-turbo")).toBe(true)
    expect(ttsSupportsSsmlBreaks("elevenlabs-multilingual")).toBe(true)
    expect(ttsSupportsSsmlBreaks("elevenlabs-v3")).toBe(false)
  })

  it("levers", () => {
    expect(ttsHasLever("elevenlabs-v3", "stability")).toBe(true)
    expect(ttsHasLever("elevenlabs-v3", "similarity")).toBe(false)
    expect(ttsHasLever("elevenlabs-v3", "speed")).toBe(false)
    expect(ttsHasLever("elevenlabs-turbo", "similarity")).toBe(true)
    expect(ttsHasLever("elevenlabs-turbo", "speed")).toBe(true)
    expect(ttsHasLever("elevenlabs-turbo", "speakerBoost")).toBe(true)
  })

  it("languages nest: multilingual ⊂ turbo ⊂ v3", () => {
    const multi = ttsLanguageCodes("elevenlabs-multilingual")
    const turbo = ttsLanguageCodes("elevenlabs-turbo")
    const v3 = ttsLanguageCodes("elevenlabs-v3")
    expect(multi.every((c) => turbo.includes(c))).toBe(true)
    expect(turbo.every((c) => v3.includes(c))).toBe(true)
    expect(turbo.filter((c) => !multi.includes(c))).toEqual(["hu", "no", "vi"])
  })
})

describe("character caps derive from the sheets", () => {
  it("MAX_TTS_CHARS_BY_PROVIDER has exactly the catalog's speech models", () => {
    const speaking = Object.values(MODEL_CATALOG).filter((m) => m.tts).map((m) => m.id).sort()
    expect(Object.keys(MAX_TTS_CHARS_BY_PROVIDER).sort()).toEqual(speaking)
  })

  it("keeps every cap it had before the sheets existed; the alias and unknown ids keep the default", () => {
    expect(getMaxTtsChars("elevenlabs-turbo")).toBe(40000)
    expect(getMaxTtsChars("elevenlabs-multilingual")).toBe(10000)
    expect(getMaxTtsChars("elevenlabs-v3")).toBe(5000)
    expect(getMaxTtsChars("elevenlabs-dialogue")).toBe(5000)
    expect(getMaxTtsChars("elevenlabs")).toBe(TTS_TEXT_MAX)
    expect(getMaxTtsChars(undefined)).toBe(TTS_TEXT_MAX)
  })
})

describe("elevenlabs-v4 — added beside v3", () => {
  it("is a text-to-speech provider, in the catalog, with the sheet below", () => {
    expect(TTS_PROVIDERS).toContain("elevenlabs-v4")
    expect(MODEL_CATALOG["elevenlabs-v4"]?.modes).toContain("tts")
  })

  it("tags, no SSML, stability + similarity, 10,000 characters, the same 46 languages as v3", () => {
    const c = getTtsCapabilities("elevenlabs-v4")
    expect(c.audioTags).toBe(true)
    expect(c.ssmlBreaks).toBe(false)
    expect(c.levers).toEqual(["stability", "similarity"])
    expect(c.languageCode).toBe(true)
    expect(c.maxChars).toBe(10000)
    expect(c.languages).toEqual(getTtsCapabilities("elevenlabs-v3").languages)
  })

  it("keeps [audio tags] and has no SSML breaks", () => {
    expect(ttsSupportsAudioTags("elevenlabs-v4")).toBe(true)
    expect(ttsSupportsSsmlBreaks("elevenlabs-v4")).toBe(false)
  })

  it("honours similarity but not speed, style or speaker boost", () => {
    expect(ttsHasLever("elevenlabs-v4", "similarity")).toBe(true)
    expect(ttsHasLever("elevenlabs-v4", "speed")).toBe(false)
    expect(ttsHasLever("elevenlabs-v4", "style")).toBe(false)
    expect(ttsHasLever("elevenlabs-v4", "speakerBoost")).toBe(false)
  })

  it("is capped at 10,000 characters; v3 stays at 5,000", () => {
    expect(getMaxTtsChars("elevenlabs-v4")).toBe(10000)
    expect(getMaxTtsChars("elevenlabs-v3")).toBe(5000)
  })

  it("its flat row is 30 credits with no note — the same as v3 — beside its per-100-characters row; as the default, it is the featured model", () => {
    const v4 = MODEL_CATALOG["elevenlabs-v4"]!
    expect(v4.pricing).toEqual([
      { identifier: "elevenlabs-v4", credits: 30 },
      { identifier: "elevenlabs-v4:per-100-chars", credits: 4, note: SPEECH_UNIT_PRICE_NOTE },
    ])
    expect(MODEL_CATALOG["elevenlabs-v3"]!.pricing).toEqual([
      { identifier: "elevenlabs-v3", credits: 30 },
      { identifier: "elevenlabs-v3:per-100-chars", credits: 4, note: SPEECH_UNIT_PRICE_NOTE },
    ])
    expect(v4.featured).toBe(true)
    expect(MODEL_CATALOG["elevenlabs-v3"]!.featured).toBeUndefined()
  })

  it("does not call v3 the latest model any more", () => {
    expect(MODEL_CATALOG["elevenlabs-v3"]!.description).not.toMatch(/latest/i)
  })
})

describe("ttsSupportsTimestamps", () => {
  it("answers for the model the request runs as", () => {
    expect(ttsSupportsTimestamps("elevenlabs-v4")).toBe(true)
    expect(ttsSupportsTimestamps("elevenlabs-v3")).toBe(true)
    expect(ttsSupportsTimestamps("elevenlabs-turbo")).toBe(true)
    expect(ttsSupportsTimestamps("elevenlabs-multilingual")).toBe(true)
    // Unknown / missing / legacy alias run as turbo, which answers timings too.
    expect(ttsSupportsTimestamps(undefined)).toBe(true)
    expect(ttsSupportsTimestamps("elevenlabs")).toBe(true)
    expect(ttsSupportsTimestamps("not-a-model")).toBe(true)
    // A dialogue id is not a text-to-speech model: it runs as the fallback here (turbo).
    expect(ttsSupportsTimestamps("elevenlabs-dialogue-v4")).toBe(true)
  })
})

describe("stitching — conditioning on neighbouring text (previous_text / next_text)", () => {
  it("every speech sheet declares it (a boolean, never undefined)", () => {
    for (const m of Object.values(MODEL_CATALOG)) {
      if (!m.tts) continue
      expect(typeof m.tts.stitching, `${m.id} stitching`).toBe("boolean")
    }
  })

  it("v4, Turbo and Multilingual condition on neighbouring text (probed 200 each); v3 rejects the fields (probed 400); the dialogue sheet says no (its lane does not read it)", () => {
    expect(getTtsCapabilities("elevenlabs-v4").stitching).toBe(true)
    expect(getTtsCapabilities("elevenlabs-turbo").stitching).toBe(true)
    expect(getTtsCapabilities("elevenlabs-multilingual").stitching).toBe(true)
    expect(getTtsCapabilities("elevenlabs-v3").stitching).toBe(false)
    expect(MODEL_CATALOG["elevenlabs-dialogue"]!.tts!.stitching).toBe(false)
  })

  it("the reader answers from the sheet of the model the request runs as", () => {
    expect(ttsSupportsStitching("elevenlabs-v4")).toBe(true)
    expect(ttsSupportsStitching("elevenlabs-v3")).toBe(false)
    expect(ttsSupportsStitching("elevenlabs-multilingual")).toBe(true)
    const turbo = ttsSupportsStitching("elevenlabs-turbo")
    expect(turbo).toBe(getTtsCapabilities("elevenlabs-turbo").stitching)
    // The alias, a missing id, an unknown id, an inherited-member name and a non-string all run as turbo.
    for (const id of ["elevenlabs", undefined, "not-a-model", "constructor", "elevenlabs-dialogue", ["elevenlabs-v4"] as unknown as string]) {
      expect(ttsSupportsStitching(id), JSON.stringify(id)).toBe(turbo)
    }
  })
})

describe("field mappings — the neighbour text fields are mappable", () => {
  it("text-to-speech maps directText and both neighbour fields, in that order", async () => {
    const { NODE_MAPPABLE_FIELDS } = await import("../node-mappable-fields.js")
    expect(NODE_MAPPABLE_FIELDS["text-to-speech"]).toEqual(["directText", "previousText", "nextText"])
  })
})
