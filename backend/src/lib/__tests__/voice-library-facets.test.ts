import { describe, expect, it } from "vitest"
import type { LibraryVoiceRecord } from "../../providers/elevenlabs/shared-voices.js"
import { VOICE_LIBRARY_FACET_KEYS, computeVoiceLibraryFacets, emptyVoiceLibraryFacets } from "../voice-library-facets.js"

// ---------------------------------------------------------------------------
// The facet counts are pure: library records in, counts out. These pin the
// contract a picker builds on — each facet ignores its own filter, zero
// counts are left out, `language` means a verified language, `search` is an
// estimate and says so.
// ---------------------------------------------------------------------------

function voice(overrides: Partial<LibraryVoiceRecord> & { id: string }): LibraryVoiceRecord {
  return {
    name: overrides.id,
    gender: "male",
    age: "middle_aged",
    accent: "american",
    descriptive: "calm",
    useCase: "narrative_story",
    category: "professional",
    language: "en",
    locale: "en-US",
    featured: false,
    languages: ["en"],
    description: "",
    ...overrides,
  }
}

const LIBRARY: LibraryVoiceRecord[] = [
  voice({ id: "ad-calm-en", useCase: "advertisement", descriptive: "calm", languages: ["en"] }),
  voice({ id: "social-calm-en-es", useCase: "social_media", descriptive: "calm", languages: ["en", "es"], gender: "female" }),
  voice({ id: "ad-deep-he", useCase: "advertisement", descriptive: "deep", language: "he", locale: "he-IL", languages: ["he"] }),
  voice({ id: "social-deep-en", useCase: "social_media", descriptive: "deep", languages: ["en"], featured: true }),
  voice({ id: "untagged", useCase: "", descriptive: "", languages: ["en"], name: "Nobody - Plain", description: "A plain voice for anything." }),
]

const counts = (list: Array<{ value: string; count: number }>) => Object.fromEntries(list.map((f) => [f.value, f.count]))

describe("computeVoiceLibraryFacets", () => {
  it("with no filter, counts every voice once per facet and leaves empty values out", () => {
    const facets = computeVoiceLibraryFacets(LIBRARY, {})
    expect(facets.total).toBe(5)
    expect(counts(facets.use_cases)).toEqual({ advertisement: 2, social_media: 2 })
    expect(counts(facets.descriptives)).toEqual({ calm: 2, deep: 2 })
    expect(counts(facets.genders)).toEqual({ male: 4, female: 1 })
    expect(counts(facets.categories)).toEqual({ professional: 5 })
    expect(facets.approximate).toBe(false)
  })

  it("total applies every filter; each facet applies every filter except its own", () => {
    const facets = computeVoiceLibraryFacets(LIBRARY, { use_cases: "advertisement" })
    expect(facets.total).toBe(2)
    // The category facet still shows the OTHER category's count — a picker
    // keeps every category's number while one is chosen.
    expect(counts(facets.use_cases)).toEqual({ advertisement: 2, social_media: 2 })
    // The other facets are narrowed to the chosen category.
    expect(counts(facets.descriptives)).toEqual({ calm: 1, deep: 1 })
    expect(counts(facets.languages)).toEqual({ en: 1, he: 1 })
    expect(counts(facets.genders)).toEqual({ male: 2 })
  })

  it("a voice that fails one filter counts only in that filter's facet; one that fails two counts nowhere", () => {
    const facets = computeVoiceLibraryFacets(LIBRARY, { use_cases: "advertisement", descriptives: "calm" })
    expect(facets.total).toBe(1) // ad-calm-en
    expect(counts(facets.use_cases)).toEqual({ advertisement: 1, social_media: 1 }) // social-calm-en-es fails use_cases only
    expect(counts(facets.descriptives)).toEqual({ calm: 1, deep: 1 }) // ad-deep-he fails descriptives only
    // social-deep-en fails both → in neither; the untagged voice fails both → nowhere.
    expect(counts(facets.genders)).toEqual({ male: 1 })
  })

  it("`language` matches a voice's VERIFIED languages, and the languages facet counts a voice under each of them", () => {
    const es = computeVoiceLibraryFacets(LIBRARY, { language: "es" })
    expect(es.total).toBe(1) // social-calm-en-es: primary en, verified es
    expect(counts(es.use_cases)).toEqual({ social_media: 1 })

    const all = computeVoiceLibraryFacets(LIBRARY, {})
    expect(counts(all.languages)).toEqual({ en: 4, es: 1, he: 1 }) // 6 > total 5: the bilingual voice counts twice
  })

  it("values match as the library spells them, case-insensitively, and never a comma list", () => {
    expect(computeVoiceLibraryFacets(LIBRARY, { gender: "Female" }).total).toBe(1)
    expect(computeVoiceLibraryFacets(LIBRARY, { age: "middle-aged" }).total).toBe(0)
    expect(computeVoiceLibraryFacets(LIBRARY, { descriptives: "calm,deep" }).total).toBe(0)
  })

  it("`featured` narrows every count, its own facet included", () => {
    const facets = computeVoiceLibraryFacets(LIBRARY, { featured: true })
    expect(facets.total).toBe(1)
    expect(counts(facets.use_cases)).toEqual({ social_media: 1 })
    expect(counts(facets.descriptives)).toEqual({ deep: 1 })
    expect(computeVoiceLibraryFacets(LIBRARY, { featured: false }).total).toBe(4)
  })

  it("`search` is a case-insensitive substring of the name or description, and marks the counts approximate", () => {
    const byName = computeVoiceLibraryFacets(LIBRARY, { search: "PLAIN" })
    expect(byName.total).toBe(1)
    expect(byName.approximate).toBe(true)
    expect(computeVoiceLibraryFacets(LIBRARY, { search: "anything" }).total).toBe(1) // the description
    expect(computeVoiceLibraryFacets(LIBRARY, { search: "   " }).approximate).toBe(false) // blank = no search
  })

  it("sorts each facet by count, then by value", () => {
    const facets = computeVoiceLibraryFacets(LIBRARY, {})
    expect(facets.languages.map((f) => f.value)).toEqual(["en", "es", "he"])
    expect(facets.genders.map((f) => f.value)).toEqual(["male", "female"])
  })

  it("an empty library, and the keyless answer, carry every facet as an empty list", () => {
    const none = computeVoiceLibraryFacets([], { use_cases: "advertisement" })
    expect(none.total).toBe(0)
    for (const key of VOICE_LIBRARY_FACET_KEYS) expect(none[key]).toEqual([])
    const empty = emptyVoiceLibraryFacets()
    expect(empty.total).toBe(0)
    expect(empty.approximate).toBe(false)
    for (const key of VOICE_LIBRARY_FACET_KEYS) expect(empty[key]).toEqual([])
  })
})
