// Which languages the app OFFERS — in the sidebar switcher, the config-panel
// locale picker and browser auto-detection.
//
// The picker catalogs ship in every registered locale, but the app chrome is
// translated language by language. A user who picks a language whose chrome
// dict is still a stub gets English menus with localized picker tiles — a
// half-translated product that reads as broken. So a locale is offered only
// once its chrome dictionary is (near-)complete. The gate is DERIVED from the
// dictionaries: finishing a translation puts the language in the menu, and
// nothing else has to be updated.
//
// Deliberately free of any import from the locale store (which imports this
// module for browser detection) — keep it that way.
import { LANGUAGES, type LocaleId } from "@nodaro/shared"
import { en, type MessageKey } from "./en"
import { DICTS } from "./dicts"

// `@nodaro/shared` exports the registry but not its row type by name.
type LanguageDefinition = (typeof LANGUAGES)[number]

/**
 * A locale is offered once its chrome dict covers at least this share of the
 * canonical keys. Not 1.0: a handful of tracked, deliberately-untranslated
 * keys must never pull a shipped language out of the menu; far above the
 * ~0.5% the stub dicts sit at, so an untranslated language never leaks in.
 */
export const CHROME_COMPLETE_RATIO = 0.98

const CANONICAL_KEYS = Object.keys(en) as MessageKey[]

/** Share of the canonical key set that `locale`'s chrome dict translates (0–1). */
export function chromeCoverage(locale: LocaleId): number {
  if (locale === "en") return 1
  const dict = DICTS[locale]
  if (!dict) return 0
  const translated = CANONICAL_KEYS.reduce((n, key) => (dict[key] === undefined ? n : n + 1), 0)
  return translated / CANONICAL_KEYS.length
}

export function isChromeComplete(locale: LocaleId): boolean {
  return chromeCoverage(locale) >= CHROME_COMPLETE_RATIO
}

// Computed once: the dictionaries are static modules.
const OFFERED: ReadonlyArray<LanguageDefinition> = LANGUAGES.filter((l) => isChromeComplete(l.id))
const OFFERED_IDS = new Set<string>(OFFERED.map((l) => l.id))

/** The languages the app offers, in `LANGUAGES` display order. */
export function offeredLanguages(): ReadonlyArray<LanguageDefinition> {
  return OFFERED
}

export function isOfferedLocale(id: string | null | undefined): id is LocaleId {
  return typeof id === "string" && OFFERED_IDS.has(id)
}

/**
 * Rows for a language menu: the offered languages, plus the current locale
 * when it is not offered — a saved choice made before the gate existed stays
 * visible and switchable instead of silently disappearing from the menu.
 */
export function languageMenuRows(current: LocaleId): ReadonlyArray<LanguageDefinition> {
  if (OFFERED_IDS.has(current)) return OFFERED
  const currentDef = LANGUAGES.find((l) => l.id === current)
  return currentDef ? [...OFFERED, currentDef] : OFFERED
}
