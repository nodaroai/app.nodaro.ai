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
 *     profile.preferred_locale  →  localStorage  →  DEFAULT_LOCALE  →  navigator.language  →  "en"
 */

import { create } from "zustand"
import { LANGUAGES, type LocaleId, type LocaleDirection, getLocaleDirection } from "@nodaro/shared"
import { runtimeDefaultLocale } from "./runtime-config"
import { surfaceLocaleDefault } from "./surface-selectors"

const STORAGE_KEY = "nodaro:preferred-locale"

const SUPPORTED_IDS = new Set<string>(LANGUAGES.map((l) => l.id))

function isSupportedLocale(value: string | null | undefined): value is LocaleId {
  return typeof value === "string" && SUPPORTED_IDS.has(value)
}

/**
 * Resolve a BCP-47 tag to a locale we ship: an exact match, else the
 * language-only prefix ("en-US" → "en"). null if neither is supported. Shared
 * so the DEFAULT_LOCALE operator knob is exactly as forgiving as the automatic
 * browser detection it overrides.
 */
function matchSupportedLocale(tag: string | null | undefined): LocaleId | null {
  if (!tag) return null
  if (isSupportedLocale(tag)) return tag
  const prefix = tag.split("-")[0]
  return isSupportedLocale(prefix) ? prefix : null
}

function detectBrowserLocale(): LocaleId {
  if (typeof navigator === "undefined") return "en"
  // navigator.languages is BCP-47 ordered by user preference; first supported wins.
  const candidates = (navigator.languages ?? [navigator.language ?? "en"]) as string[]
  for (const tag of candidates) {
    const m = matchSupportedLocale(tag)
    if (m) return m
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

/**
 * The deployment's default locale, resolved the same lenient way as browser
 * detection — exact match or language-prefix ("en-US" → "en"). Unset, blank or
 * unrecognised → null, so the chain degrades to browser detection.
 *
 * B1 folds the surface profile's `locale.default` in front of A3's top-level
 * `DEFAULT_LOCALE`: a surface value wins, the shipped env value is the fallback.
 */
function readRuntimeDefaultLocale(): LocaleId | null {
  return matchSupportedLocale(surfaceLocaleDefault() ?? runtimeDefaultLocale())
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

/**
 * The locale a page starts in, before the user profile hydrates:
 *   saved choice (localStorage) → deployment default (`DEFAULT_LOCALE`) →
 *   browser detection → "en"
 * The deployment default outranks browser detection — an instance that declares
 * an audience should win over how a visitor's laptop happens to be configured —
 * but never a saved choice: a user who deliberately picked a language is not
 * dragged back. The profile locale, when it arrives via `markHydrated`,
 * outranks all of this.
 */
export function resolveInitialLocale(): LocaleId {
  return readStoredLocale() ?? readRuntimeDefaultLocale() ?? detectBrowserLocale()
}

const initialLocale: LocaleId = resolveInitialLocale()

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
