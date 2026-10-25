import { sharedAccessibility } from "virtual:site-a11y"

/**
 * The viewer's accessibility-menu choices, and how they reach the page: each
 * choice is a `data-a11y-*` attribute on <html>, and globals.css holds what
 * every attribute does. A blocked or empty storage simply means the defaults.
 *
 * Where they are kept — ONE store per build, never two:
 *   - a build with the shared site header (`virtual:site-a11y` is the
 *     header's): the cookie every Nodaro product shares, on every page — the
 *     header's own menu where the header is mounted, this app's menu on the
 *     pages without it. The header's reader carries this browser's earlier
 *     choices (the localStorage keys below) into the cookie once, when there
 *     is no cookie yet; from then on localStorage is never read or written.
 *   - every other build (`sharedAccessibility` is null): this browser's
 *     localStorage, as before.
 *
 * The operating system's "reduce motion" is honoured by CSS alone (a media
 * query beside the attribute rule), so it holds in every edition and changes
 * live; data-a11y-motion is only the viewer's choice in this menu.
 */

export type TextScale = 0 | 1 | 2

export interface AccessibilityPreferences {
  readonly textScale: TextScale
  readonly contrast: boolean
  readonly spacing: boolean
  readonly links: boolean
  readonly headings: boolean
  readonly readableFont: boolean
  readonly bigCursor: boolean
  readonly stopMotion: boolean
}

export type ToggleKey = Exclude<keyof AccessibilityPreferences, "textScale">

export const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  textScale: 0,
  contrast: false,
  spacing: false,
  links: false,
  headings: false,
  readableFont: false,
  bigCursor: false,
  stopMotion: false,
}

export const STORAGE_KEY = "nodaro.a11y.v1"

const ATTRIBUTES: Readonly<Record<ToggleKey, string>> = {
  contrast: "data-a11y-contrast",
  spacing: "data-a11y-spacing",
  links: "data-a11y-links",
  headings: "data-a11y-headings",
  readableFont: "data-a11y-font",
  bigCursor: "data-a11y-cursor",
  stopMotion: "data-a11y-motion",
}

export const TOGGLE_KEYS = Object.keys(ATTRIBUTES) as readonly ToggleKey[]

function isTextScale(value: unknown): value is TextScale {
  return value === 0 || value === 1 || value === 2
}

/** Reads what this browser kept, keeping only well-formed values. */
export function parsePreferences(raw: string | null): AccessibilityPreferences {
  if (!raw) return DEFAULT_PREFERENCES
  try {
    const stored = JSON.parse(raw) as Record<string, unknown>
    const toggles = Object.fromEntries(
      TOGGLE_KEYS.map((key) => [key, stored[key] === true]),
    ) as Record<ToggleKey, boolean>
    return {
      ...toggles,
      textScale: isTextScale(stored.textScale) ? stored.textScale : 0,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function loadPreferences(): AccessibilityPreferences {
  if (sharedAccessibility) return sharedAccessibility.read().prefs
  try {
    return parsePreferences(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(prefs: AccessibilityPreferences): void {
  if (sharedAccessibility) {
    sharedAccessibility.save({ prefs, hiddenUntil: sharedAccessibility.read().hiddenUntil })
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
}

/** Puts the choices on <html>. Pure DOM; safe to call before React renders. */
export function applyPreferences(
  prefs: AccessibilityPreferences,
  root: HTMLElement = document.documentElement,
): void {
  for (const key of TOGGLE_KEYS) {
    if (prefs[key]) root.setAttribute(ATTRIBUTES[key], "")
    else root.removeAttribute(ATTRIBUTES[key])
  }
  if (prefs.textScale > 0) root.setAttribute("data-a11y-text", String(prefs.textScale))
  else root.removeAttribute("data-a11y-text")
}

/**
 * For the entry module, before the first paint: the saved choices on <html>.
 * On a shared-header build the header's own `applySavedAccessibility()` (the
 * shared cookie, seeded once from this browser's earlier choices); elsewhere
 * this browser's storage. One source per build, so a page never gets two sets.
 */
export function applySavedPreferences(): void {
  if (sharedAccessibility) sharedAccessibility.applySaved()
  else applyPreferences(loadPreferences())
}

/*
 * Hiding the corner button: the viewer may put it away for a month, three
 * months or half a year. Kept in this browser as the moment it comes back;
 * Alt+A opens the menu all the while (the statement says so), and the menu
 * offers to bring the button back early.
 */
export const HIDE_KEY = "nodaro.a11y.button-hidden-until"

export type HideMonths = 1 | 3 | 6

/** The moment the button returns, `months` calendar months from `now`. */
export function hiddenUntilAfter(months: HideMonths, now: Date = new Date()): number {
  const until = new Date(now.getTime())
  until.setMonth(until.getMonth() + months)
  return until.getTime()
}

/** When the button is hidden, the moment it returns; null when it shows. */
export function loadHiddenUntil(now: number = Date.now()): number | null {
  if (sharedAccessibility) {
    const until = sharedAccessibility.read(now).hiddenUntil
    return until !== null && until > now ? until : null
  }
  try {
    const stored = Number(window.localStorage.getItem(HIDE_KEY))
    if (Number.isFinite(stored) && stored > now) return stored
    window.localStorage.removeItem(HIDE_KEY)
    return null
  } catch {
    return null
  }
}

export function saveHiddenUntil(until: number | null): void {
  if (sharedAccessibility) {
    sharedAccessibility.save({ prefs: sharedAccessibility.read().prefs, hiddenUntil: until })
    return
  }
  try {
    if (until === null) window.localStorage.removeItem(HIDE_KEY)
    else window.localStorage.setItem(HIDE_KEY, String(until))
  } catch {
    // Storage blocked: the choice holds for this visit only.
  }
}

export function isDefault(prefs: AccessibilityPreferences): boolean {
  return prefs.textScale === 0 && TOGGLE_KEYS.every((key) => !prefs[key])
}
