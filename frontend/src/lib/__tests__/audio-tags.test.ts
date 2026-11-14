// @vitest-environment node
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { GEMINI_3_8_TONE_TAGS } from "@nodaro/shared/models"
import {
  AUDIO_TAGS,
  SSML_BREAK_OPTIONS,
  LANGUAGE_LABELS,
  getAudioTagCategories,
  getLanguagesForModel,
  ALL_LANGUAGES,
  angleTagMenu,
  tagInsertWarning,
} from "@/lib/audio-tags"

// Which model performs [audio tags] / honours SSML is answered by the capability
// sheet in @nodaro/shared (tts-capabilities.test.ts there pins every model);
// this file covers what the frontend adds on top: the names of the languages.
describe("language names", () => {
  it("every language code on every speech model's sheet has a display name", () => {
    for (const m of Object.values(MODEL_CATALOG)) {
      for (const code of m.tts?.languages ?? []) {
        expect(LANGUAGE_LABELS[code], `${m.id}: no name for language "${code}"`).toBeDefined()
      }
    }
  })

  it("every name belongs to a language some speech model offers (no dead names)", () => {
    const offered = new Set(Object.values(MODEL_CATALOG).flatMap((m) => m.tts?.languages ?? []))
    for (const code of Object.keys(LANGUAGE_LABELS)) {
      expect(offered.has(code), `"${code}" is named but no model offers it`).toBe(true)
    }
  })
})

describe("getAudioTagCategories", () => {
  it("returns a Map with 6 categories", () => {
    const categories = getAudioTagCategories()
    expect(categories).toBeInstanceOf(Map)
    expect(categories.size).toBe(6)
  })

  it("contains all expected category names", () => {
    const categories = getAudioTagCategories()
    const expectedCategories = [
      "Emotions",
      "Reactions",
      "Delivery",
      "Pacing",
      "Tone",
      "Sound Effects",
    ]
    for (const name of expectedCategories) {
      expect(categories.has(name)).toBe(true)
    }
  })

  it("each category has at least 1 tag", () => {
    const categories = getAudioTagCategories()
    for (const [, tags] of categories) {
      expect(tags.length).toBeGreaterThanOrEqual(1)
    }
  })

  it("total count across all categories matches AUDIO_TAGS.length", () => {
    const categories = getAudioTagCategories()
    let total = 0
    for (const [, tags] of categories) {
      total += tags.length
    }
    expect(total).toBe(AUDIO_TAGS.length)
  })

  it("all AUDIO_TAGS are present in some category", () => {
    const categories = getAudioTagCategories()
    const allCategorized: string[] = []
    for (const [, tags] of categories) {
      allCategorized.push(...tags.map((t) => t.tag))
    }
    for (const tag of AUDIO_TAGS) {
      expect(allCategorized).toContain(tag.tag)
    }
  })
})

describe("getLanguagesForModel", () => {
  it("returns 29 languages for elevenlabs-multilingual", () => {
    const langs = getLanguagesForModel("elevenlabs-multilingual")
    expect(langs).toHaveLength(29)
  })

  it("returns 32 languages for elevenlabs-turbo", () => {
    const langs = getLanguagesForModel("elevenlabs-turbo")
    expect(langs).toHaveLength(32)
  })

  it("returns the same 46 languages for v4 as for v3 (the curated picker; v4 itself speaks more)", () => {
    expect(getLanguagesForModel("elevenlabs-v4")).toEqual(getLanguagesForModel("elevenlabs-v3"))
    expect(getLanguagesForModel("elevenlabs-v4").some((l) => l.value === "he")).toBe(true)
    expect(getLanguagesForModel("elevenlabs-v4-turbo")).toEqual(getLanguagesForModel("elevenlabs-v3"))
    expect(ALL_LANGUAGES).toHaveLength(46) // v4 Turbo adds no language to the union
  })

  it("the legacy alias lists what turbo lists (it runs as turbo)", () => {
    expect(getLanguagesForModel("elevenlabs")).toEqual(getLanguagesForModel("elevenlabs-turbo"))
  })

  it("returns 46 languages for elevenlabs-v3", () => {
    const langs = getLanguagesForModel("elevenlabs-v3")
    expect(langs).toHaveLength(46)
  })

  it("a model offered in no language (Gemini: the language follows the text) lists none", () => {
    for (const provider of ["gemini-3-8-flash-lite-tts", "gemini-3-8-flash-tts", "gemini-3-1-flash-tts", "gemini-2-5-pro-tts"]) {
      expect(getLanguagesForModel(provider), provider).toEqual([])
    }
  })

  it("returns 32 languages when called with no argument (default = turbo)", () => {
    const langs = getLanguagesForModel()
    expect(langs).toHaveLength(32)
  })

  it("every list is alphabetical by label — release order was unfindable at 46 entries", () => {
    // Replaces "first language is always English": ABC ordering (user request,
    // 2026-08-31) puts English under E, predictably, instead of pinning it first.
    for (const provider of [
      "elevenlabs-multilingual",
      "elevenlabs-turbo",
      "elevenlabs-v3",
      "elevenlabs-v4",
      "elevenlabs-v4-turbo",
      undefined,
    ]) {
      const labels = getLanguagesForModel(provider).map((l) => l.label)
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)))
      expect(labels).toContain("English")
    }
  })
})

describe("ALL_LANGUAGES", () => {
  it("has 46 entries", () => {
    expect(ALL_LANGUAGES).toHaveLength(46)
  })

  it("contains English (en)", () => {
    expect(ALL_LANGUAGES.some((l) => l.value === "en")).toBe(true)
  })

  it("contains Hebrew (he) - v3-only language", () => {
    expect(ALL_LANGUAGES.some((l) => l.value === "he")).toBe(true)
  })

  it("contains Hungarian (hu) - Flash v2.5 extra language", () => {
    expect(ALL_LANGUAGES.some((l) => l.value === "hu")).toBe(true)
  })

  it("is alphabetical by label — the dropdowns render it verbatim", () => {
    const labels = ALL_LANGUAGES.map((l) => l.label)
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)))
  })
})

describe("tagInsertWarning — what inserting a tag earns on each model", () => {
  const BREAK = SSML_BREAK_OPTIONS[1]!.tag // <break time="1.0s" />
  const TAG = "[whispers]"

  it.each([
    ["elevenlabs-v3", BREAK, "ssml"],
    ["elevenlabs-v3", TAG, null],
    ["elevenlabs-turbo", BREAK, null],
    ["elevenlabs-turbo", TAG, "audioTag"],
    ["elevenlabs-multilingual", BREAK, null],
    ["elevenlabs-multilingual", TAG, "audioTag"],
    ["elevenlabs", BREAK, null], // the legacy id runs as turbo
    ["elevenlabs", TAG, "audioTag"],
    ["not-a-model", BREAK, null], // an unknown id runs as turbo too
    ["not-a-model", TAG, "audioTag"],
    [undefined, BREAK, null], // no model chosen: never warns
    [undefined, TAG, null],
  ])("%s + %s → %s", (provider, tag, expected) => {
    expect(tagInsertWarning(provider, tag)).toBe(expected)
  })

  it("a tag that is neither an SSML break nor an audio tag never warns", () => {
    for (const provider of ["elevenlabs-v3", "elevenlabs-turbo", undefined]) {
      expect(tagInsertWarning(provider, "plain text")).toBeNull()
      expect(tagInsertWarning(provider, "")).toBeNull()
    }
  })

  it("agrees with every shipped tag: all audio tags start with [ and every SSML break with <", () => {
    for (const t of AUDIO_TAGS) expect(tagInsertWarning("elevenlabs-turbo", t.tag), t.tag).toBe("audioTag")
    for (const b of SSML_BREAK_OPTIONS) expect(tagInsertWarning("elevenlabs-v3", b.tag), b.tag).toBe("ssml")
  })

  describe("on a model that writes its own <tone tags> (Gemini 3.8)", () => {
    const LITE_38 = "gemini-3-8-flash-lite-tts"

    it("every tag of its own list is no warning — it is not SSML", () => {
      for (const name of GEMINI_3_8_TONE_TAGS) expect(tagInsertWarning(LITE_38, `<${name}>`), name).toBeNull()
    })

    it("a [square] tag the platform rewrites to one of them is no warning; one it takes out is", () => {
      expect(tagInsertWarning(LITE_38, "[laughs]")).toBeNull() // → <laugh>
      expect(tagInsertWarning(LITE_38, "[pause]")).toBeNull() // → <short pause>
      expect(tagInsertWarning(LITE_38, "[whispers]")).toBeNull() // its own name
      expect(tagInsertWarning(LITE_38, "[sarcastic]")).toBe("audioTag")
      expect(tagInsertWarning(LITE_38, "[explosion]")).toBe("audioTag")
    })

    it("an angle tag not on its list is taken out; an SSML break is still SSML (it honours none)", () => {
      expect(tagInsertWarning(LITE_38, "<excited>")).toBe("audioTag")
      expect(tagInsertWarning(LITE_38, BREAK)).toBe("ssml")
    })

    it("3.1 / 2.5 take [square] tags as written: no warning; still no SSML", () => {
      for (const provider of ["gemini-3-1-flash-tts", "gemini-2-5-pro-tts"]) {
        expect(tagInsertWarning(provider, TAG)).toBeNull()
        expect(tagInsertWarning(provider, "[sarcastic]")).toBeNull()
        expect(tagInsertWarning(provider, BREAK)).toBe("ssml")
      }
    })
  })
})

describe("angleTagMenu — the tag menu on an angle-tag model", () => {
  it("3.8 offers exactly its own tags, written as it reads them, in its sheet's order", () => {
    for (const provider of ["gemini-3-8-flash-lite-tts", "gemini-3-8-flash-tts"]) {
      expect(angleTagMenu(provider)).toEqual(GEMINI_3_8_TONE_TAGS.map((name) => ({ tag: `<${name}>`, label: name })))
    }
  })

  it("every other model keeps the platform's menu (undefined), a missing or unknown id included", () => {
    for (const provider of ["gemini-3-1-flash-tts", "gemini-2-5-pro-tts", "elevenlabs-v4", "elevenlabs-turbo", "not-a-model", undefined]) {
      expect(angleTagMenu(provider), String(provider)).toBeUndefined()
    }
  })
})

describe("AUDIO_TAGS data integrity", () => {
  it("all tags are in [bracket] format", () => {
    for (const tag of AUDIO_TAGS) {
      expect(tag.tag).toMatch(/^\[.+\]$/)
    }
  })

  it("each tag has a non-empty label", () => {
    for (const tag of AUDIO_TAGS) {
      expect(tag.label.length).toBeGreaterThan(0)
    }
  })

  it("each tag has a non-empty category", () => {
    for (const tag of AUDIO_TAGS) {
      expect(tag.category.length).toBeGreaterThan(0)
    }
  })

  it("has no duplicate tags", () => {
    const tagValues = AUDIO_TAGS.map((t) => t.tag)
    const unique = new Set(tagValues)
    expect(unique.size).toBe(tagValues.length)
  })
})

describe("SSML_BREAK_OPTIONS", () => {
  it("has 5 entries", () => {
    expect(SSML_BREAK_OPTIONS).toHaveLength(5)
  })

  it('all tags contain <break time=" pattern', () => {
    for (const option of SSML_BREAK_OPTIONS) {
      expect(option.tag).toContain('<break time="')
    }
  })

  it('labels follow "Break N.Ns" format', () => {
    for (const option of SSML_BREAK_OPTIONS) {
      expect(option.label).toMatch(/^Break \d+\.\d+s$/)
    }
  })
})

