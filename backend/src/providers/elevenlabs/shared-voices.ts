/**
 * The speech provider's shared Voice Library listing (`GET /v1/shared-voices`)
 * — the one owner of its wire shape. Two readers: the library listing route
 * (`routes/voices.ts`, a filtered page at a time) and the library catalog
 * (`./voice-library-catalog.ts`, the whole library for the facet counts).
 *
 * Measured 2026-11-09 (21,710 voices over 218 pages of 100): every voice has
 * at most ONE `use_case` and ONE `descriptive`; its `language` is the primary
 * one and `verified_languages` lists every language it is verified for — and
 * the listing's `language=` filter matches THAT list, not the primary field
 * (characters_animation + language=en: 681 voices, of which 595 have `en` as
 * their primary language). `age`, `accent`, `gender`, `use_cases` and
 * `descriptives` match their raw strings exactly (`age=middle-aged` is a
 * different value from `middle_aged`); `descriptives=a,b` matches nothing.
 */
import { config } from "../../lib/config.js"
import { ELEVENLABS_BASE_URL } from "./client.js"

export interface RawVerifiedLanguage {
  language?: string
  locale?: string
  accent?: string
  model_id?: string
  preview_url?: string
}

/** One voice as the listing returns it — the fields the platform reads. */
export interface RawSharedVoice {
  voice_id: string
  name: string
  preview_url?: string
  gender?: string
  accent?: string
  age?: string
  description?: string
  descriptive?: string
  use_case?: string
  category?: string
  language?: string
  locale?: string
  featured?: boolean
  verified_languages?: RawVerifiedLanguage[]
}

export interface RawSharedVoicesPage {
  voices: RawSharedVoice[]
  has_more?: boolean
}

/** The listing's address for `params`. */
export function sharedVoicesUrl(params: URLSearchParams): string {
  return `${ELEVENLABS_BASE_URL}/v1/shared-voices?${params.toString()}`
}

/** The listing's request headers (the key is read at call time). */
export function sharedVoicesHeaders(): Record<string, string> {
  return { "xi-api-key": config.ELEVENLABS_API_KEY, Accept: "application/json" }
}

/** The model ids a voice is verified for (what `deriveVerifiedTtsProviders` reads). */
export function verifiedModelIds(voice: Pick<RawSharedVoice, "verified_languages">): string[] {
  return (voice.verified_languages ?? [])
    .map((l) => l.model_id)
    .filter((m): m is string => typeof m === "string")
}

/**
 * Every language a voice speaks, as the library codes them (`en`, `he`, …):
 * its verified languages, de-duplicated, with the primary `language` first
 * when the list does not already carry it. The listing's `language=` filter
 * matches this set.
 */
export function verifiedLanguageCodes(voice: Pick<RawSharedVoice, "language" | "verified_languages">): string[] {
  const codes: string[] = []
  const seen = new Set<string>()
  const add = (code: string | undefined) => {
    const c = (code ?? "").trim()
    if (!c || seen.has(c)) return
    seen.add(c)
    codes.push(c)
  }
  add(voice.language)
  for (const l of voice.verified_languages ?? []) add(l.language)
  return codes
}

/** The description's length kept in a library record (`LibraryVoiceRecord`). */
export const LIBRARY_DESCRIPTION_CHARS = 240

/**
 * One library voice as the platform's own catalog keeps it: the fields the
 * facet counts and their filters read, nothing a client renders (no preview,
 * no model ids). ≈500 bytes a voice; the whole library ≈10 MB.
 */
export interface LibraryVoiceRecord {
  readonly id: string
  readonly name: string
  readonly gender: string
  readonly age: string
  readonly accent: string
  readonly descriptive: string
  readonly useCase: string
  readonly category: string
  /** The primary language and locale (`en`, `en-US`); `""` when unstated. */
  readonly language: string
  readonly locale: string
  readonly featured: boolean
  /** `verifiedLanguageCodes` — what a `language` filter matches. */
  readonly languages: readonly string[]
  /** The description, cut to `LIBRARY_DESCRIPTION_CHARS` — what a `search` filter reads. */
  readonly description: string
}

export function toLibraryVoiceRecord(raw: RawSharedVoice): LibraryVoiceRecord {
  return {
    id: raw.voice_id,
    name: raw.name ?? "",
    gender: raw.gender ?? "",
    age: raw.age ?? "",
    accent: raw.accent ?? "",
    descriptive: raw.descriptive ?? "",
    useCase: raw.use_case ?? "",
    category: raw.category ?? "",
    language: raw.language ?? "",
    locale: raw.locale ?? "",
    featured: raw.featured === true,
    languages: verifiedLanguageCodes(raw),
    description: (raw.description ?? "").slice(0, LIBRARY_DESCRIPTION_CHARS),
  }
}
