/**
 * i18n types and language registry for parameter-node pickers.
 *
 * Architecture:
 * - English is the canonical source — every catalog entry has its `label` and
 *   `description` in English in the catalog file itself.
 * - Non-English translations live in sidecar files under
 *   `packages/shared/src/i18n/<catalog>.<locale>.ts`.
 * - Each sidecar exports a `Record<id, LocalizedEntry>` keyed by entry id.
 * - Lazy-loaded per locale via dynamic import so users only download languages
 *   they actually use.
 *
 * Translation rules (see picker-i18n design doc):
 * - `id` and `promptHint` are NEVER translated.
 * - `label` is translated when it's a common noun/adjective (e.g. "Smoky Eye"
 *   → "Ojo Ahumado"). Proper names, brand names, model numbers, technical
 *   units, and Latin/Italian/Japanese cinematography jargon stay in their
 *   canonical form (e.g. Tim Walker, Sony A7III, chiaroscuro, anamorphic,
 *   Y2K, ukiyo-e).
 * - `description` is translated freely, with proper nouns preserved inside.
 *
 * Search rule: pickers filter on the union of current-locale + English text,
 * so a French user typing "soie" finds "Silk" AND a French user typing "silk"
 * still finds it.
 */

/** Canonical language code (BCP-47 or simplified two-letter). */
export type LocaleId =
  | "en"
  | "es"
  | "fr"
  | "de"
  | "pt-BR"
  | "ru"
  | "hi"
  | "ja"
  | "ko"
  | "zh-CN"
  | "he"
  | "ar"

/** Reading direction. RTL languages need `dir="rtl"` on the picker container. */
export type LocaleDirection = "ltr" | "rtl"

export interface LanguageDefinition {
  readonly id: LocaleId
  /** English name shown in language pickers when current locale is English. */
  readonly englishName: string
  /** Native name shown to native speakers (in their own script). */
  readonly nativeName: string
  /** Two-letter or short code displayed inside the small locale chip. */
  readonly shortCode: string
  /** Reading direction. */
  readonly dir: LocaleDirection
  /** Optional flag emoji for visual recognition. */
  readonly flag: string
}

/**
 * Master language registry. Order = display order in the language picker
 * dropdown. English first as canonical default, then mainstream LTR
 * languages, then RTL languages last.
 */
export const LANGUAGES: ReadonlyArray<LanguageDefinition> = [
  { id: "en",    englishName: "English",              nativeName: "English",         shortCode: "EN",  dir: "ltr", flag: "🇬🇧" },
  { id: "es",    englishName: "Spanish",              nativeName: "Español",         shortCode: "ES",  dir: "ltr", flag: "🇪🇸" },
  { id: "fr",    englishName: "French",               nativeName: "Français",        shortCode: "FR",  dir: "ltr", flag: "🇫🇷" },
  { id: "de",    englishName: "German",               nativeName: "Deutsch",         shortCode: "DE",  dir: "ltr", flag: "🇩🇪" },
  { id: "pt-BR", englishName: "Portuguese (Brazil)",  nativeName: "Português",       shortCode: "PT",  dir: "ltr", flag: "🇧🇷" },
  { id: "ru",    englishName: "Russian",              nativeName: "Русский",         shortCode: "RU",  dir: "ltr", flag: "🇷🇺" },
  { id: "hi",    englishName: "Hindi",                nativeName: "हिन्दी",          shortCode: "HI",  dir: "ltr", flag: "🇮🇳" },
  { id: "ja",    englishName: "Japanese",             nativeName: "日本語",          shortCode: "JA",  dir: "ltr", flag: "🇯🇵" },
  { id: "ko",    englishName: "Korean",               nativeName: "한국어",          shortCode: "KO",  dir: "ltr", flag: "🇰🇷" },
  { id: "zh-CN", englishName: "Chinese (Simplified)", nativeName: "简体中文",        shortCode: "ZH",  dir: "ltr", flag: "🇨🇳" },
  { id: "he",    englishName: "Hebrew",               nativeName: "עברית",           shortCode: "HE",  dir: "rtl", flag: "🇮🇱" },
  { id: "ar",    englishName: "Arabic",               nativeName: "العربية",         shortCode: "AR",  dir: "rtl", flag: "🇸🇦" },
] as const

export const LOCALE_IDS: ReadonlyArray<LocaleId> = LANGUAGES.map((l) => l.id)
export const NON_EN_LOCALE_IDS: ReadonlyArray<Exclude<LocaleId, "en">> = LANGUAGES
  .filter((l) => l.id !== "en")
  .map((l) => l.id) as ReadonlyArray<Exclude<LocaleId, "en">>

const languageById = new Map<LocaleId, LanguageDefinition>(LANGUAGES.map((l) => [l.id, l]))

export function getLanguage(id: string | undefined | null): LanguageDefinition | undefined {
  if (!id) return undefined
  return languageById.get(id as LocaleId)
}

export function getLocaleDirection(id: string | undefined | null): LocaleDirection {
  return getLanguage(id)?.dir ?? "ltr"
}

export function isRTL(id: string | undefined | null): boolean {
  return getLocaleDirection(id) === "rtl"
}

/**
 * A single localized entry. Either or both fields may be missing — the
 * resolver falls back to the canonical English `label` / `description` from
 * the catalog when a field is absent.
 */
export interface LocalizedEntry {
  readonly label?: string
  readonly description?: string
}

/** Map shape exported by every sidecar file (`<catalog>.<locale>.ts`). */
export type LocaleCatalogMap = Readonly<Record<string, LocalizedEntry>>

/**
 * The catalogs that have i18n sidecar files. Each name corresponds to a
 * shared catalog file (e.g. "mood" → `packages/shared/src/mood.ts`).
 */
export const I18N_CATALOGS = [
  "action-fx",
  "aesthetic",
  "animals",
  "atmosphere",
  "backdrop",
  "camera-format",
  "camera-motions",
  "color-look",
  "composition-effects",
  "era",
  "exposure-settings",
  "framing",
  "furniture",
  "held-prop",
  "instrumentation",
  "lens",
  "lighting",
  "loop-subject",
  "materials",
  "mood",
  "music-genre",
  "music-mood",
  "person",
  "photo-genre",
  "photographer",
  "pose",
  "post-process-effects",
  "render-quality",
  "seasons",
  "setting",
  "style",
  "styling",
  "temporal",
  "vehicles",
  "voice-character",
  "voice-delivery",
  "weapons",
] as const

export type I18nCatalogId = (typeof I18N_CATALOGS)[number]
