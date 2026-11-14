import { replicaConsentProblem, replicaModels, replicaOf, ttsReplicaProblem, ttsTakesReplica } from "../tts-capabilities.js"
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, SPEECH_UNIT_PRICE_NOTE } from "../model-catalog.js"
import { TTS_PROVIDERS, MAX_TTS_CHARS_BY_PROVIDER, getMaxTtsChars, TTS_TEXT_MAX, DEFAULT_TTS_PROVIDER } from "../model-constants.js"
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
  ttsNamedVoices,
  ttsAcceptsVoice,
  ttsNamedVoiceFor,
  ttsAngleTags,
  ttsDirection,
  ttsDirectionFor,
  ttsDirectionProblem,
  ttsVoiceForModel,
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
      // An ElevenLabs model honours stability; a named-voice model (Gemini) takes no ElevenLabs setting at all.
      if (m.tts.voices) expect(m.tts.levers, `${m.id} takes no ElevenLabs lever`).toEqual([])
      else expect(m.tts.levers, `${m.id} must honour stability`).toContain("stability")
      expect(new Set(m.tts.levers).size, `${m.id} duplicate lever`).toBe(m.tts.levers.length)
      // No language picker only where no language is ever sent (the text decides).
      if (m.tts.languageCode) expect(m.tts.languages.length, `${m.id} languages`).toBeGreaterThan(0)
      expect(new Set(m.tts.languages).size, `${m.id} duplicate language`).toBe(m.tts.languages.length)
      // The `features` flag other packages already read must agree with the sheet.
      expect(m.features?.includes("audio-tags") ?? false, `${m.id} audio-tags feature`).toBe(m.tts.audioTags)
    }
  })

  it("every sheet says whether the model returns timings, and all seven speech models do", () => {
    const yes = Object.values(MODEL_CATALOG).filter((m) => m.tts?.timestamps === true).map((m) => m.id).sort()
    for (const m of Object.values(MODEL_CATALOG)) {
      if (!m.tts) continue
      expect(typeof m.tts.timestamps, `${m.id} timestamps`).toBe("boolean")
    }
    // Measured 2026-10-04 (v4) and 2026-10-06 (the rest): /with-timestamps answers 200 on every
    // speech model at the same character cost. A new model joins this list only once it is measured.
    // v4 Turbo measured 2026-10-07: with-timestamps 200 at equal character-cost.
    expect(yes).toEqual([
      "elevenlabs-dialogue",
      "elevenlabs-dialogue-v4",
      "elevenlabs-multilingual",
      "elevenlabs-turbo",
      "elevenlabs-v3",
      "elevenlabs-v4",
      "elevenlabs-v4-turbo",
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

describe("elevenlabs-v4-turbo — the fast v4, added beside v4 (decided 2026-10-06)", () => {
  it("is a text-to-speech provider, in the catalog, listed after v3 and before Turbo v2.5", () => {
    expect(TTS_PROVIDERS).toContain("elevenlabs-v4-turbo")
    expect(MODEL_CATALOG["elevenlabs-v4-turbo"]?.modes).toContain("tts")
    const order = TTS_PROVIDERS.filter((id) => ["elevenlabs-v3", "elevenlabs-v4-turbo", "elevenlabs-turbo"].includes(id))
    expect(order).toEqual(["elevenlabs-v3", "elevenlabs-v4-turbo", "elevenlabs-turbo"])
  })

  it("the sheet: tags, no SSML, stability + similarity, language code, v4's curated 46 languages, the cap", () => {
    const c = getTtsCapabilities("elevenlabs-v4-turbo")
    expect(c.audioTags).toBe(true)
    expect(c.ssmlBreaks).toBe(false)
    expect(c.levers).toEqual(["stability", "similarity"])
    expect(c.languageCode).toBe(true)
    expect(c.languages).toEqual(getTtsCapabilities("elevenlabs-v4").languages)
    expect(c.maxChars).toBe(10000) // measured 2026-10-07: the vendor declares 10,000; live, 10,000 AND 10,001 both returned 200 — the declared (smaller) figure is the clamp
    expect(getMaxTtsChars("elevenlabs-v4-turbo")).toBe(c.maxChars)
  })

  it("stitching and timestamps are the probe's values, declared, never undefined", () => {
    const c = getTtsCapabilities("elevenlabs-v4-turbo")
    expect(c.stitching).toBe(true) // measured 2026-10-07: neighbour-text 200 at the plain call's character-cost
    expect(c.timestamps).toBe(true) // measured 2026-10-07: with-timestamps 200 at equal character-cost
    expect(ttsSupportsStitching("elevenlabs-v4-turbo")).toBe(c.stitching)
    expect(ttsSupportsTimestamps("elevenlabs-v4-turbo")).toBe(c.timestamps)
  })

  it("keeps [audio tags], has no SSML breaks, honours similarity but not speed, style or speaker boost", () => {
    expect(ttsSupportsAudioTags("elevenlabs-v4-turbo")).toBe(true)
    expect(ttsSupportsSsmlBreaks("elevenlabs-v4-turbo")).toBe(false)
    expect(ttsHasLever("elevenlabs-v4-turbo", "similarity")).toBe(true)
    for (const lever of ["speed", "style", "speakerBoost"] as const) expect(ttsHasLever("elevenlabs-v4-turbo", lever), lever).toBe(false)
  })

  it("its flat row is 15 with no note — Turbo v2.5 parity — beside a 2-credit per-100-characters row; it is not featured", () => {
    expect(MODEL_CATALOG["elevenlabs-v4-turbo"]!.pricing).toEqual([
      { identifier: "elevenlabs-v4-turbo", credits: 15 },
      { identifier: "elevenlabs-v4-turbo:per-100-chars", credits: 2, note: SPEECH_UNIT_PRICE_NOTE },
    ])
    expect(MODEL_CATALOG["elevenlabs-v4-turbo"]!.featured).toBeUndefined()
    expect(MODEL_CATALOG["elevenlabs-turbo"]!.pricing[0]!.credits).toBe(15)
  })

  it("every existing speech sheet is exactly what it was", () => {
    expect(getTtsCapabilities("elevenlabs-v4").maxChars).toBe(10000)
    expect(getTtsCapabilities("elevenlabs-v3").maxChars).toBe(5000)
    expect(getTtsCapabilities("elevenlabs-turbo").maxChars).toBe(40000)
    expect(getTtsCapabilities("elevenlabs-multilingual").maxChars).toBe(10000)
    expect(TTS_PROVIDERS.filter((id) => id !== "elevenlabs-v4-turbo" && !id.startsWith("gemini-"))).toEqual(["elevenlabs-v3", "elevenlabs-v4", "elevenlabs-turbo", "elevenlabs-multilingual", "elevenlabs"])
  })

  it("the narration recommendation keeps v4 first and places v4 Turbo after v3, before Turbo v2.5", async () => {
    const { MODEL_RECOMMENDATIONS } = await import("../model-catalog.js")
    const narration = MODEL_RECOMMENDATIONS.find((r) => r.intent === "voice over / narration")
    expect(narration?.modelIds).toEqual(["elevenlabs-v4", "elevenlabs-v3", "elevenlabs-v4-turbo", "elevenlabs-turbo"])
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

describe("Gemini speech — four models beside ElevenLabs (decided 2026-11-12)", () => {
  const GEMINI_3_8 = ["gemini-3-8-flash-lite-tts", "gemini-3-8-flash-tts"]
  const GEMINI_3_1 = ["gemini-3-1-flash-tts", "gemini-2-5-pro-tts"]

  it("each is a text-to-speech model of Google's, priced per 1,000 characters; ElevenLabs v4 stays the default", () => {
    for (const id of [...GEMINI_3_8, ...GEMINI_3_1]) {
      expect(TTS_PROVIDERS as readonly string[]).toContain(id)
      expect(MODEL_CATALOG[id]?.maker).toBe("google")
      expect(MODEL_CATALOG[id]?.modes).toEqual(["tts", "dialogue"]) // one id for one speaker and two: dialogue priced on the one-speaker row by construction
      expect(getTtsCapabilities(id).ratePer1kChars).toBe(true)
      expect(MODEL_CATALOG[id]!.pricing.map((p) => p.identifier)).toEqual([id, `${id}:per-1k-chars`])
    }
    expect(DEFAULT_TTS_PROVIDER).toBe("elevenlabs-v4")
  })

  it("named voices only: 70 grouped by use on 3.8, the same 30 on 3.1 and 2.5; a voice of one list is not a voice of the other", () => {
    for (const id of GEMINI_3_8) {
      const voices = ttsNamedVoices(id)!
      expect(voices).toHaveLength(70)
      expect(voices.every((v) => v.group !== undefined)).toBe(true)
      expect(new Set(voices.map((v) => v.id)).size).toBe(70)
      expect(getTtsCapabilities(id).defaultVoice).toBe("Fola")
      expect(ttsAcceptsVoice(id, "Fola")).toBe(true)
    }
    for (const id of GEMINI_3_1) {
      expect(ttsNamedVoices(id)).toHaveLength(30)
      expect(getTtsCapabilities(id).defaultVoice).toBe("Kore")
      expect(ttsAcceptsVoice(id, "Fola")).toBe(false) // a 3.8 voice (KIE refuses it: 422)
      expect(ttsAcceptsVoice(id, "Kore")).toBe(true)
    }
    // Every default is on its own list, and an ElevenLabs model takes any voice id (its own checks apply).
    for (const id of [...GEMINI_3_8, ...GEMINI_3_1]) expect(ttsAcceptsVoice(id, getTtsCapabilities(id).defaultVoice!)).toBe(true)
    expect(ttsNamedVoices("elevenlabs-v4")).toBeUndefined()
    expect(ttsAcceptsVoice("elevenlabs-v4", "Rachel")).toBe(true)
  })

  it("ttsNamedVoiceFor: the voice asked for when the model speaks it, else the model's default; nothing on ElevenLabs", () => {
    expect(ttsNamedVoiceFor("gemini-3-8-flash-tts", "Zephyr")).toBe("Zephyr")
    expect(ttsNamedVoiceFor("gemini-3-8-flash-tts", "Rachel")).toBe("Fola")
    expect(ttsNamedVoiceFor("gemini-3-1-flash-tts", undefined)).toBe("Kore")
    expect(ttsNamedVoiceFor("elevenlabs-v4", "Rachel")).toBeUndefined()
  })

  it("no ElevenLabs lever, no language field, no timings, no neighbour text, a 10,000-character cap", () => {
    for (const id of [...GEMINI_3_8, ...GEMINI_3_1]) {
      const c = getTtsCapabilities(id)
      expect(c).toMatchObject({ levers: [], languageCode: false, languages: [], timestamps: false, stitching: false, ssmlBreaks: false, maxChars: 10000, audioTags: true })
      expect(getMaxTtsChars(id)).toBe(10000)
    }
  })

  it("tags: 3.8 writes its own <angle> tags from a closed list; 3.1 / 2.5 take [square] tags as written", () => {
    for (const id of GEMINI_3_8) {
      expect(ttsAngleTags(id)).toContain("laugh")
      expect(ttsAngleTags(id)).toContain("short pause")
      expect(ttsAngleTags(id)).toHaveLength(40)
    }
    for (const id of [...GEMINI_3_1, "elevenlabs-v4"]) expect(ttsAngleTags(id)).toBeUndefined()
  })

  it("direction: free text per line on 3.8; style, pace, accent and audio profile on 3.1 / 2.5; none on ElevenLabs", () => {
    for (const id of GEMINI_3_8) expect(ttsDirection(id)).toEqual({ styleMaxChars: 1000 })
    for (const id of GEMINI_3_1) {
      const d = ttsDirection(id)!
      expect(d.styles).toContain("Deadpan")
      expect(d.paces).toContain("Staccato")
      expect(d.accents).toContain("British (RP)")
      expect(d.audioProfileMaxChars).toBe(1000)
      expect(d.styleMaxChars).toBeUndefined()
    }
    expect(ttsDirection("elevenlabs-v4")).toBeUndefined()
  })

  it("ttsDirectionFor keeps only what the model takes, trimmed; ttsDirectionProblem judges only that", () => {
    const all = { styleDirection: "  slow and dry ", pace: "Staccato", accent: "Australian", audioProfile: "A narrator" }
    expect(ttsDirectionFor("gemini-3-8-flash-lite-tts", all)).toEqual({ styleDirection: "slow and dry" })
    expect(ttsDirectionFor("gemini-3-1-flash-tts", { ...all, styleDirection: "Deadpan" })).toEqual({ styleDirection: "Deadpan", pace: "Staccato", accent: "Australian", audioProfile: "A narrator" })
    expect(ttsDirectionFor("gemini-3-1-flash-tts", all)).toEqual({ pace: "Staccato", accent: "Australian", audioProfile: "A narrator" })
    expect(ttsDirectionFor("elevenlabs-v4", all)).toEqual({})
    expect(ttsDirectionProblem("gemini-3-8-flash-tts", all)).toBeUndefined()
    expect(ttsDirectionProblem("gemini-3-8-flash-tts", { styleDirection: "x".repeat(1001) })).toMatchObject({ field: "styleDirection" })
    expect(ttsDirectionProblem("gemini-3-1-flash-tts", all)).toMatchObject({ field: "styleDirection" })
    expect(ttsDirectionProblem("gemini-3-1-flash-tts", { pace: "Slow" })).toMatchObject({ field: "pace" })
    expect(ttsDirectionProblem("gemini-2-5-pro-tts", { accent: "" })).toBeUndefined()
    expect(ttsDirectionProblem("elevenlabs-v4", { pace: "Slow" })).toBeUndefined()
  })
})

describe("ttsVoiceForModel — the editor's model-switch rule where the editor is not there (decided 2026-11-13)", () => {
  it("an ElevenLabs voice on a Gemini model becomes the model's default; a voice of its own list stays", () => {
    expect(ttsVoiceForModel("gemini-3-8-flash-tts", "Rachel")).toBe("Fola")
    expect(ttsVoiceForModel("gemini-3-1-flash-tts", "Fola")).toBe("Kore") // a 3.8 voice is not on 3.1's list
    expect(ttsVoiceForModel("gemini-3-8-flash-tts", "Zephyr")).toBe("Zephyr")
    expect(ttsVoiceForModel("gemini-2-5-pro-tts", "")).toBeUndefined()
    expect(ttsVoiceForModel("gemini-2-5-pro-tts", undefined)).toBeUndefined()
  })

  it("a Gemini voice on an ElevenLabs model becomes no voice (the deployment's default); an ElevenLabs voice stays", () => {
    expect(ttsVoiceForModel("elevenlabs-v4", "Fola")).toBeUndefined()
    expect(ttsVoiceForModel("elevenlabs-turbo", "Kore")).toBeUndefined()
    expect(ttsVoiceForModel("elevenlabs-v4", "Rachel")).toBe("Rachel")
    expect(ttsVoiceForModel("elevenlabs-v4", "21m00Tcm4TlvDq8ikWAM")).toBe("21m00Tcm4TlvDq8ikWAM")
    expect(ttsVoiceForModel(undefined, "Puck")).toBeUndefined() // no model: the fallback model, ElevenLabs
  })

  it("no Gemini voice name is also an ElevenLabs premade name", () => {
    const premade = ["Rachel", "Aria", "Roger", "Sarah", "Laura", "Charlie", "George", "Callum", "River", "Liam", "Charlotte", "Alice", "Matilda", "Will", "Jessica", "Eric", "Chris", "Brian", "Daniel", "Lily", "Bill"]
    for (const id of ["gemini-3-8-flash-tts", "gemini-3-1-flash-tts"]) {
      for (const v of ttsNamedVoices(id)!) expect(premade, v.id).not.toContain(v.id)
    }
  })
})

describe("a one-off clone (replica, decided 2026-11-13)", () => {
  it("3.8 Flash takes it; 3.8 Flash-Lite (KIE refuses it), 3.1, 2.5 and every ElevenLabs model do not", () => {
    expect(ttsTakesReplica("gemini-3-8-flash-tts")).toBe(true)
    for (const id of ["gemini-3-8-flash-lite-tts", "gemini-3-1-flash-tts", "gemini-2-5-pro-tts", "elevenlabs-v4", undefined]) expect(ttsTakesReplica(id), String(id)).toBe(false)
    expect(replicaModels()).toEqual(["gemini-3-8-flash-tts"])
  })

  it("replicaOf reads two https links; ttsReplicaProblem refuses one on a model that does not clone, and a malformed one", () => {
    const ok = { sourceAudioUrl: "https://a.example/s.wav", consentAudioUrl: "https://a.example/c.wav" }
    expect(replicaOf(ok)).toEqual(ok)
    expect(replicaOf({ ...ok, sourceAudioUrl: "http://a.example/s.wav" })).toBeUndefined()
    expect(replicaOf({ sourceAudioUrl: "https://a" })).toBeUndefined()
    expect(ttsReplicaProblem("gemini-3-8-flash-tts", ok)).toBeUndefined()
    expect(ttsReplicaProblem("gemini-3-8-flash-tts", undefined)).toBeUndefined()
    expect(ttsReplicaProblem("gemini-3-8-flash-lite-tts", ok)).toBe("gemini-3-8-flash-lite-tts does not clone a voice; a one-off clone runs on gemini-3-8-flash-tts")
    expect(ttsReplicaProblem("gemini-3-8-flash-tts", { sourceAudioUrl: "file:///etc/passwd", consentAudioUrl: ok.consentAudioUrl })).toMatch(/https link/)
  })
})

describe("a one-off clone's consent on the API and MCP (decided 2026-11-13)", () => {
  it("a clone must say consent: true; none asked is no problem", () => {
    const links = { sourceAudioUrl: "https://a.example/s.wav", consentAudioUrl: "https://a.example/c.wav" }
    expect(replicaConsentProblem(undefined)).toBeUndefined()
    expect(replicaConsentProblem({ ...links, consent: true })).toBeUndefined()
    for (const replica of [links, { ...links, consent: false }, { ...links, consent: "yes" }]) {
      expect(replicaConsentProblem(replica)).toMatch(/^replica\.consent must be true: it confirms "I confirm the voice in these recordings is my own/)
    }
  })
})

