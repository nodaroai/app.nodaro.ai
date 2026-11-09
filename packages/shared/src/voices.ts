import type { TtsProvider } from "./model-constants.js"

/**
 * A premade ElevenLabs voice as returned by `GET /v1/voices`.
 * Field names + types mirror the route verbatim: the route normalizes every
 * optional field to `""` (never null), so these are all non-null strings.
 */
export interface Voice {
  voice_id: string
  name: string
  preview_url: string
  gender: string
  accent: string
  age: string
  description: string
  use_case: string
  category: string
}

/**
 * A shared/community Voice Library entry (`GET /v1/voices/library`).
 * Same shape as {@link Voice} plus the TTS provider the voice is verified on.
 */
export interface SharedVoice extends Voice {
  /**
   * The best of our TTS providers whose underlying ElevenLabs model the
   * voice lists in `verified_languages`, in the order `elevenlabs-v4` (when
   * verified for the base model `eleven_v4`), then `elevenlabs-v3`, which
   * renders any voice unmodified, then `elevenlabs-v4-turbo` (verified for the
   * exact id `eleven_v4_turbo`), then the cheapest v2 model: `elevenlabs-turbo`
   * preferred, else `elevenlabs-multilingual`. Only those two exact ids count
   * in the v4 family; the other `eleven_v4_…` variants (`_hq`, `_exp`, …) are
   * not models of ours and count toward nothing. Models the deployment does
   * not offer are never recommended.
   * Clients without a provider picker should send it as the `provider` on
   * text-to-speech so generation uses a model the voice is actually verified
   * for — rendering a voice on an unverified model is what makes output drift
   * audibly from its preview. Absent when the entry has no model metadata, or
   * when none of the models it is verified for is offered by the deployment.
   */
  recommendedProvider?: TtsProvider
  /**
   * Every TTS provider the voice is verified on and the deployment offers
   * (a subset of {@link TtsProvider}, in the order `elevenlabs-v4`,
   * `elevenlabs-v3`, `elevenlabs-v4-turbo`, `elevenlabs-turbo`,
   * `elevenlabs-multilingual` — the same order `recommendedProvider` is picked
   * from, so it is always the first entry); absent whenever
   * `recommendedProvider` is. Clients WITH a provider picker should only snap
   * the provider when the current choice is NOT in this set — most voices
   * verify more than one, and an explicit user choice within the set must win.
   * Do not switch over a closed list of members: a speech model added later
   * joins this set the release it ships.
   */
  verifiedProviders?: TtsProvider[]
  /**
   * The library's one-word tone for the voice (`calm`, `deep`, `cute`, …) —
   * one of {@link VOICE_LIBRARY_DESCRIPTIVES}, or a word the library added
   * since; `""` when it states none, like every other field here. The value
   * a `descriptives` filter matches. Absent only on a server older than this
   * field.
   */
  descriptive?: string
  /**
   * The voice's primary language as the library codes it (`en`, `he`, …) and
   * its locale (`en-US`); `""` when unstated. For what a `language` filter
   * matches see {@link SharedVoice.verifiedLanguages}. Absent only on a
   * server older than these fields.
   */
  language?: string
  locale?: string
  /**
   * Every language the voice is verified for, as the library codes them, the
   * primary language first — the set `GET /v1/voices/library?language=`
   * matches against (a voice whose primary language is English and that is
   * verified for Spanish is listed under `language=es`), and what the
   * `languages` facet counts. Absent only on a server older than this field.
   */
  verifiedLanguages?: string[]
}

/**
 * The `use_cases` values the Voice Library groups its voices by
 * (`GET /v1/voices/library?use_cases=<one>`): what a picker shows as its
 * categories. The route passes the value through verbatim, so a value the
 * library adds later works before it is listed here.
 */
export const VOICE_LIBRARY_USE_CASES = [
  "advertisement",
  "characters_animation",
  "conversational",
  "entertainment_tv",
  "informative_educational",
  "narrative_story",
  "social_media",
] as const
export type VoiceLibraryUseCase = (typeof VOICE_LIBRARY_USE_CASES)[number]

/**
 * The tones (`descriptives`) the Voice Library labels its voices with
 * (`GET /v1/voices/library?descriptives=<one>`), alphabetical — what a picker
 * shows as a category's sub-groups. Every voice carries at most one. The
 * library adds and drops words over time: this is the list it used when it
 * was last read (2026-11); `GET /v1/voices/library/facets` says which exist
 * now, with how many voices each, and the route passes any value through.
 */
export const VOICE_LIBRARY_DESCRIPTIVES = [
  "anxious",
  "calm",
  "casual",
  "childish",
  "chill",
  "classy",
  "confident",
  "crisp",
  "cute",
  "deep",
  "excited",
  "formal",
  "gentle",
  "grumpy",
  "husky",
  "hyped",
  "intense",
  "mature",
  "meditative",
  "modulated",
  "neutral",
  "pleasant",
  "professional",
  "raspy",
  "relaxed",
  "robotic",
  "rough",
  "sad",
  "sassy",
  "serious",
  "soft",
  "upbeat",
  "whispery",
  "wise",
] as const
export type VoiceLibraryDescriptive = (typeof VOICE_LIBRARY_DESCRIPTIVES)[number]

/** Query params for `GET /v1/voices/library`. All optional; sent as a querystring. */
export interface VoiceLibraryParams {
  search?: string
  gender?: string
  age?: string
  accent?: string
  /** A language code as the library uses them (`en`, `he`); matches a voice's VERIFIED languages, not only its primary one. */
  language?: string
  category?: string
  /** One of `VOICE_LIBRARY_USE_CASES` (any other string is passed through as sent). */
  use_cases?: VoiceLibraryUseCase | (string & {})
  /** One of `VOICE_LIBRARY_DESCRIPTIVES` (any other string is passed through as sent); one value per call. */
  descriptives?: VoiceLibraryDescriptive | (string & {})
  featured?: boolean
  /** e.g. "trending" — passed through to the route. */
  sort?: string
  /** 0-based page; route default 0. */
  page?: number
  /** Route default 30, clamped to 1..100. */
  page_size?: number
}

/** `GET /v1/voices/library` response. */
export interface VoiceLibraryResponse {
  voices: SharedVoice[]
  hasMore: boolean
}

/**
 * Query params for `GET /v1/voices/library/facets`: the listing's filters,
 * without paging and sort. All optional.
 */
export type VoiceLibraryFacetsParams = Pick<
  VoiceLibraryParams,
  "search" | "gender" | "age" | "accent" | "language" | "category" | "use_cases" | "descriptives" | "featured"
>

/** One value of a facet and how many voices carry it. */
export interface VoiceLibraryFacetCount {
  value: string
  count: number
}

/**
 * `GET /v1/voices/library/facets` response: for the filters sent, how many
 * library voices match (`total`) and that number broken down by every facet,
 * so one call fills a whole picker screen. Each facet's counts apply every
 * filter EXCEPT its own (a client shows every category's count while one is
 * chosen); values with no voices are left out; lists are sorted by count,
 * then by value. The values are the library's own spellings — the same
 * strings the listing's filters take.
 *
 * Counted over the platform's copy of the library, refreshed on a schedule
 * (`updatedAt` is when it was read), not over the live listing: a count may
 * trail the listing by a few voices. `languages` counts a voice under every
 * language it is verified for (what the listing's `language` filter matches),
 * so those counts add up to more than `total`.
 */
export interface VoiceLibraryFacets {
  /** Voices matching every filter sent. */
  total: number
  use_cases: VoiceLibraryFacetCount[]
  languages: VoiceLibraryFacetCount[]
  descriptives: VoiceLibraryFacetCount[]
  genders: VoiceLibraryFacetCount[]
  ages: VoiceLibraryFacetCount[]
  accents: VoiceLibraryFacetCount[]
  categories: VoiceLibraryFacetCount[]
  /**
   * True when `search` was sent: the library's own search is fuzzy (it stems
   * and tolerates a typo), which the counts cannot reproduce — under `search`
   * they match the name and description as written and are a lower estimate.
   */
  approximate: boolean
  /** When the copy these counts come from was read (ISO 8601); null when there is none (no speech key). */
  updatedAt: string | null
  /** Present (true) when the deployment has no speech key: nothing to count. */
  keyMissing?: boolean
  hint?: string
}

/**
 * A user voice clone. `GET /v1/voice-clones` returns the full shape; the create
 * response (`POST /v1/voice-clones/from-url`) returns only `id, name,
 * elevenlabsVoiceId, sampleAudioUrl, createdAt` (+ a credit-tracking `jobId`),
 * so the list-only fields are optional here. `elevenlabsVoiceId` is the id that
 * resolves the clone at text-to-speech time (use it as the selected voiceId).
 */
export interface VoiceClone {
  id: string
  name: string
  elevenlabsVoiceId: string
  sampleAudioUrl: string
  createdAt: string
  /** Present on the list response; absent on the create response. */
  description?: string | null
  previewUrl?: string | null
  gender?: string | null
  accent?: string | null
  updatedAt?: string
  /** Only on the create response (credit-tracking); never on the list. */
  jobId?: string
}

/**
 * What a favorite voice is — the `voiceType` a text-to-speech run takes for it:
 * a premade voice, a Voice Library voice, or one of the user's own clones
 * (`custom`). The one list the route, the MCP tool and the CLI validate against.
 */
export const VOICE_FAVORITE_TYPES = ["premade", "library", "custom"] as const
export type VoiceFavoriteType = (typeof VOICE_FAVORITE_TYPES)[number]

/**
 * One of the signed-in user's favorite voices (`GET /v1/voices/favorites`), newest
 * first. `voiceId` is what a text-to-speech request takes as `voice` with
 * `voiceType`; `name` and `previewUrl` are the snapshot the client sent when it
 * starred the voice, so a favorites list renders with no second lookup.
 */
export interface VoiceFavorite {
  voiceId: string
  voiceType: VoiceFavoriteType
  name: string
  previewUrl: string | null
  createdAt: string
}

/** Body of `PUT /v1/voices/favorites/:voiceId`: the voice's kind and the snapshot to show it by. */
export interface VoiceFavoriteInput {
  voiceId: string
  voiceType: VoiceFavoriteType
  name: string
  previewUrl?: string | null
}
