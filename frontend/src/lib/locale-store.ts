/**
 * Locale state for parameter-node picker i18n.
 *
 * - Source of truth at rest: `profiles.preferred_locale` (per user).
 * - Hydrated into this store on app load (via `hydrateLocaleFromProfile`).
 * - When the user changes the locale via any picker's <LocalePicker>:
 *     1. Optimistically update this store.
 *     2. Persist via PATCH /v1/user/settings { preferredLocale: ... }.
 *     3. localStorage mirror so reload-without-network shows last choice.
 * - Fallback chain on first load:
 *     profile.preferred_locale  →  localStorage  →  navigator.language  →  "en"
 */

import { create } from "zustand"
import { LANGUAGES, type LocaleId, type LocaleDirection, getLocaleDirection } from "@nodaro/shared"

const STORAGE_KEY = "nodaro:preferred-locale"

const SUPPORTED_IDS = new Set<string>(LANGUAGES.map((l) => l.id))

function isSupportedLocale(value: string | null | undefined): value is LocaleId {
  return typeof value === "string" && SUPPORTED_IDS.has(value)
}

function detectBrowserLocale(): LocaleId {
  if (typeof navigator === "undefined") return "en"
  // navigator.languages is BCP-47 ordered by user preference. Pick the first
  // that matches one of our supported locales (also try the language-only
  // prefix, since "en-US" should match "en").
  const candidates = (navigator.languages ?? [navigator.language ?? "en"]) as string[]
  for (const tag of candidates) {
    if (!tag) continue
    if (isSupportedLocale(tag)) return tag
    const prefix = tag.split("-")[0]
    if (isSupportedLocale(prefix)) return prefix
  }
  return "en"
}

function readStoredLocale(): LocaleId | null {
  if (typeof window === "undefined") return null
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return isSupportedLocale(v) ? v : null
  } catch {
    return null
  }
}

function writeStoredLocale(value: LocaleId) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* ignore storage errors */
  }
}

interface LocaleStore {
  /** Current effective locale (display language for pickers). */
  locale: LocaleId
  /** Reading direction derived from the locale. */
  dir: LocaleDirection
  /** Whether the locale was loaded from the user profile yet (vs initial guess). */
  hydrated: boolean
  /** Set the locale and persist to localStorage (does NOT call backend — caller does that). */
  setLocale: (locale: LocaleId) => void
  /** Mark the store as hydrated (after profile fetch). */
  markHydrated: (locale: LocaleId | null) => void
}

const initialLocale: LocaleId = readStoredLocale() ?? detectBrowserLocale()

export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: initialLocale,
  dir: getLocaleDirection(initialLocale),
  hydrated: false,
  setLocale: (locale) => {
    writeStoredLocale(locale)
    set({ locale, dir: getLocaleDirection(locale) })
  },
  markHydrated: (locale) => {
    if (locale && isSupportedLocale(locale)) {
      writeStoredLocale(locale)
      set({ locale, dir: getLocaleDirection(locale), hydrated: true })
    } else {
      set({ hydrated: true })
    }
  },
}))

/** Convenience hook: just the locale id. */
export function useUserLocale(): LocaleId {
  return useLocaleStore((s) => s.locale)
}

/**
 * Reading direction for PARAMETER-PICKER TILE GRIDS ONLY.
 *
 * Deliberately pinned to `"ltr"`: tile grids are laid out against catalog
 * order, so they read the same in every locale (label left, control right,
 * tabs in catalog order). Flipping them buys nothing and costs alignment
 * with the catalogs, docs and tutorial media.
 *
 * THIS IS NOT THE APP'S DIRECTION. `<html dir>` is set from the locale by
 * `I18nHtmlDir`, so RTL locales flip the whole chrome. Anything outside a
 * picker grid that needs the live direction must use `useAppDir()`;
 * reaching for this hook there silently pins it LTR inside an RTL page.
 */
export function usePickerDir(): LocaleDirection {
  return "ltr"
}

/**
 * The app's live reading direction, derived from the chosen locale.
 * `I18nHtmlDir` mirrors this into `<html dir>`. Use it for icon flips and
 * any layout decision that must follow the user's locale.
 */
export function useAppDir(): LocaleDirection {
  return useLocaleStore((s) => s.dir)
}
