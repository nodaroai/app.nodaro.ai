import { describe, it, expect } from "vitest"
import {
  AUDIO_TAGS,
  SSML_BREAK_OPTIONS,
  V3_MODELS,
  V2_MODELS,
  isV2Model,
  isV3Model,
  getAudioTagCategories,
  getLanguagesForModel,
  ALL_LANGUAGES,
} from "@/lib/audio-tags"

describe("isV2Model", () => {
  it("returns true for undefined (v2 is default)", () => {
    expect(isV2Model(undefined)).toBe(true)
  })

  it("returns true for elevenlabs-turbo", () => {
    expect(isV2Model("elevenlabs-turbo")).toBe(true)
  })

  it("returns true for elevenlabs-multilingual", () => {
    expect(isV2Model("elevenlabs-multilingual")).toBe(true)
  })

  it("returns false for elevenlabs-v3", () => {
    expect(isV2Model("elevenlabs-v3")).toBe(false)
  })

  it("returns false for unknown model", () => {
    expect(isV2Model("unknown-model")).toBe(false)
  })
})

describe("isV3Model", () => {
  it("returns true for elevenlabs-v3", () => {
    expect(isV3Model("elevenlabs-v3")).toBe(true)
  })

  it("returns false for elevenlabs-turbo", () => {
    expect(isV3Model("elevenlabs-turbo")).toBe(false)
  })

  it("returns false for undefined", () => {
    expect(isV3Model(undefined)).toBe(false)
  })

  it("returns false for random string", () => {
    expect(isV3Model("random")).toBe(false)
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

  it("returns 46 languages for elevenlabs-v3", () => {
    const langs = getLanguagesForModel("elevenlabs-v3")
    expect(langs).toHaveLength(46)
  })

  it("returns 32 languages when called with no argument (default = turbo)", () => {
    const langs = getLanguagesForModel()
    expect(langs).toHaveLength(32)
  })

  it("first language is always English", () => {
    for (const provider of [
      "elevenlabs-multilingual",
      "elevenlabs-turbo",
      "elevenlabs-v3",
      undefined,
    ]) {
      const langs = getLanguagesForModel(provider)
      expect(langs[0]).toEqual({ value: "en", label: "English" })
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

describe("model constants", () => {
  it("V3_MODELS contains elevenlabs-v3", () => {
    expect(V3_MODELS).toContain("elevenlabs-v3")
  })

  it("V2_MODELS contains elevenlabs-turbo and elevenlabs-multilingual", () => {
    expect(V2_MODELS).toContain("elevenlabs-turbo")
    expect(V2_MODELS).toContain("elevenlabs-multilingual")
  })
})
