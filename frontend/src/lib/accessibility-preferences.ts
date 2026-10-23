/**
 * The viewer's accessibility-menu choices, and how they reach the page: each
 * choice is a `data-a11y-*` attribute on <html>, and globals.css holds what
 * every attribute does. Kept in this browser only (a per-viewer convenience);
 * a blocked or empty storage simply means the defaults.
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
  try {
    return parsePreferences(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(prefs: AccessibilityPreferences): void {
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

export function isDefault(prefs: AccessibilityPreferences): boolean {
  return prefs.textScale === 0 && TOGGLE_KEYS.every((key) => !prefs[key])
}
