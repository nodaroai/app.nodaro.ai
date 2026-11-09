/**
 * Facet counts over the Voice Library — how many voices each category
 * (`use_cases`), tone (`descriptives`), language, gender, age, accent and
 * category has, for the filters a client holds. Pure: a list of library
 * records in, counts out; the route (`routes/voice-library-facets.ts`) owns
 * the snapshot, the voice lock and the caching.
 *
 * Standard faceted search: `total` applies every filter; each facet's counts
 * apply every filter EXCEPT that facet's own, so a client can show every
 * category's count while one is chosen. Values with no voices are left out;
 * lists are sorted by count, then by value for stable ties.
 *
 * The filters mean what the listing's (`GET /v1/voices/library`) mean, so a
 * count here is the length of the list a client would page through there:
 *   • `language` matches a voice's VERIFIED languages (primary included),
 *     which is what the library's own filter does; a voice counts once in
 *     the `languages` facet for every language it is verified for, so those
 *     counts sum to more than `total`.
 *   • `use_cases`, `descriptives`, `gender`, `age`, `accent`, `category`:
 *     one value, matched as the library spells it (case-insensitively).
 *   • `featured`: the library's flag.
 *   • `search`: the library's own search is fuzzy (it stems and tolerates a
 *     typo), which no snapshot can reproduce. Here it is a case-insensitive
 *     substring of the name or description, so with `search` the counts are
 *     a lower estimate — `approximate` says so.
 */
import type { LibraryVoiceRecord } from "../providers/elevenlabs/shared-voices.js"

/** The filters the facets route takes — the listing's, without paging and sort. */
export interface VoiceLibraryFacetFilters {
  readonly search?: string
  readonly gender?: string
  readonly age?: string
  readonly accent?: string
  readonly language?: string
  readonly category?: string
  readonly use_cases?: string
  readonly descriptives?: string
  readonly featured?: boolean
}

export interface FacetCount {
  readonly value: string
  readonly count: number
}

/** The seven facets, keyed as the response names them. */
export const VOICE_LIBRARY_FACET_KEYS = ["use_cases", "languages", "descriptives", "genders", "ages", "accents", "categories"] as const
export type VoiceLibraryFacetKey = (typeof VOICE_LIBRARY_FACET_KEYS)[number]

export type VoiceLibraryFacetCounts = {
  readonly total: number
  readonly approximate: boolean
} & { readonly [K in VoiceLibraryFacetKey]: FacetCount[] }

interface Dimension {
  readonly key: VoiceLibraryFacetKey
  /** The filter on this dimension, normalized; undefined when none. */
  readonly filter: string | undefined
  /** The voice's value(s) on this dimension — several for languages. */
  readonly valuesOf: (v: LibraryVoiceRecord) => readonly string[]
}

const norm = (s: string | undefined): string | undefined => {
  const t = (s ?? "").trim().toLowerCase()
  return t === "" ? undefined : t
}

const one = (f: (v: LibraryVoiceRecord) => string) => (v: LibraryVoiceRecord): readonly string[] => {
  const value = f(v)
  return value === "" ? [] : [value]
}

function dimensions(filters: VoiceLibraryFacetFilters): Dimension[] {
  return [
    { key: "use_cases", filter: norm(filters.use_cases), valuesOf: one((v) => v.useCase) },
    { key: "languages", filter: norm(filters.language), valuesOf: (v) => v.languages },
    { key: "descriptives", filter: norm(filters.descriptives), valuesOf: one((v) => v.descriptive) },
    { key: "genders", filter: norm(filters.gender), valuesOf: one((v) => v.gender) },
    { key: "ages", filter: norm(filters.age), valuesOf: one((v) => v.age) },
    { key: "accents", filter: norm(filters.accent), valuesOf: one((v) => v.accent) },
    { key: "categories", filter: norm(filters.category), valuesOf: one((v) => v.category) },
  ]
}

function matches(dim: Dimension, v: LibraryVoiceRecord): boolean {
  if (dim.filter === undefined) return true
  return dim.valuesOf(v).some((value) => value.toLowerCase() === dim.filter)
}

/** The non-facet filters, applied to every count. */
function baseMatch(filters: VoiceLibraryFacetFilters): (v: LibraryVoiceRecord) => boolean {
  const search = norm(filters.search)
  const featured = filters.featured
  return (v) => {
    if (featured !== undefined && v.featured !== featured) return false
    if (search !== undefined && !v.name.toLowerCase().includes(search) && !v.description.toLowerCase().includes(search)) return false
    return true
  }
}

function sortedCounts(counter: Map<string, number>): FacetCount[] {
  return [...counter.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
}

/**
 * The counts for `filters` over `voices` (the list the voice lock allows —
 * the caller narrows it first). One pass: a voice that matches every
 * dimension counts in `total` and in every facet; a voice that fails exactly
 * one dimension counts only in that dimension's facet (the facet that drops
 * its own filter); a voice that fails two or more counts nowhere.
 */
export function computeVoiceLibraryFacets(voices: readonly LibraryVoiceRecord[], filters: VoiceLibraryFacetFilters): VoiceLibraryFacetCounts {
  const dims = dimensions(filters)
  const base = baseMatch(filters)
  const counters = dims.map(() => new Map<string, number>())
  let total = 0

  const add = (counter: Map<string, number>, values: readonly string[]) => {
    for (const value of values) counter.set(value, (counter.get(value) ?? 0) + 1)
  }

  for (const v of voices) {
    if (!base(v)) continue
    let failed = -1
    let failures = 0
    for (let i = 0; i < dims.length; i++) {
      if (!matches(dims[i], v)) {
        failures++
        if (failures > 1) break
        failed = i
      }
    }
    if (failures > 1) continue
    if (failures === 0) {
      total++
      for (let i = 0; i < dims.length; i++) add(counters[i], dims[i].valuesOf(v))
    } else {
      add(counters[failed], dims[failed].valuesOf(v))
    }
  }

  const facets = Object.fromEntries(dims.map((dim, i) => [dim.key, sortedCounts(counters[i])])) as { [K in VoiceLibraryFacetKey]: FacetCount[] }
  return { total, approximate: norm(filters.search) !== undefined, ...facets }
}

/** The answer for a library nobody can count (no key): every facet empty. */
export function emptyVoiceLibraryFacets(): VoiceLibraryFacetCounts {
  return {
    total: 0,
    approximate: false,
    use_cases: [],
    languages: [],
    descriptives: [],
    genders: [],
    ages: [],
    accents: [],
    categories: [],
  }
}
