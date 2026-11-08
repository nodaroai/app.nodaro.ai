import { a11yStylesheet, sharedAccessibility, type SharedAccessibility } from "virtual:site-a11y"
import { siteHeaderCookieOptions, siteHeaderMode } from "./site-header-mode"

/**
 * The viewer's accessibility-menu choices, and how they reach the page: each
 * choice is a `data-a11y-*` attribute on <html>, and globals.css holds what
 * every attribute does. A blocked or empty storage simply means the defaults.
 *
 * Where they are kept — ONE store per deployment, never two:
 *   - where the deployment shows the shared site header (`siteHeaderMode()`,
 *     on a build whose `virtual:site-a11y` is the header's): the cookie every
 *     Nodaro product shares, on every page — the header's own menu where the
 *     header is mounted, this app's menu on the pages without it — and on this
 *     host alone for a white-label deployment. The header's reader carries
 *     this browser's earlier choices (the localStorage keys below) into the
 *     cookie once, when there is no cookie yet; from then on localStorage is
 *     never read or written. The header's page-wide stylesheet is linked there
 *     too (`linkSharedAccessibilityStylesheet`).
 *   - everywhere else (`sharedAccessibility` is null, or the deployment shows
 *     no header): this browser's localStorage, as before, and no stylesheet
 *     of the header's.
 *
 * The operating system's "reduce motion" is honoured by CSS alone (a media
 * query beside the attribute rule), so it holds in every edition and changes
 * live; data-a11y-motion is only the viewer's choice in this menu.
 */

export type TextScale = 0 | 1 | 2

export interface AccessibilityPreferences {
  readonly textScale: TextScale
  readonly contrast: boolean
  /** Inverted colours: light and dark swap; photos and video stay natural. */
  readonly invert: boolean
  /** Strong contrast: yellow text on black, cyan links. */
  readonly strong: boolean
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
  invert: false,
  strong: false,
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
  invert: "data-a11y-invert",
  strong: "data-a11y-strong",
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

/**
 * The contrast choices: at most one is on at a time, since each repaints the
 * whole page. The shared header's rule (`CONTRAST_MODES` and
 * `setAccessibilityToggle` in the package), so both menus behave alike;
 * `ee/shell/__tests__/a11y-package.test.ts` holds this copy to the package's.
 */
export const CONTRAST_MODES: readonly ToggleKey[] = ["contrast", "invert", "strong"]

/** Turns a choice on or off; turning a contrast mode on turns the other two off. */
export function setToggle(prefs: AccessibilityPreferences, key: ToggleKey, on: boolean): AccessibilityPreferences {
  const others = on && CONTRAST_MODES.includes(key)
    ? Object.fromEntries(CONTRAST_MODES.filter((mode) => mode !== key).map((mode) => [mode, false]))
    : {}
  return { ...prefs, ...others, [key]: on }
}

/** Keeps the first contrast mode on (in CONTRAST_MODES order) when the storage holds several. */
function oneContrastMode(prefs: AccessibilityPreferences): AccessibilityPreferences {
  const first = CONTRAST_MODES.find((mode) => prefs[mode])
  return first ? setToggle(prefs, first, true) : prefs
}

/** Reads what this browser kept, keeping only well-formed values. */
export function parsePreferences(raw: string | null): AccessibilityPreferences {
  if (!raw) return DEFAULT_PREFERENCES
  try {
    const stored = JSON.parse(raw) as Record<string, unknown>
    const toggles = Object.fromEntries(
      TOGGLE_KEYS.map((key) => [key, stored[key] === true]),
    ) as Record<ToggleKey, boolean>
    return oneContrastMode({
      ...toggles,
      textScale: isTextScale(stored.textScale) ? stored.textScale : 0,
    })
  } catch {
    return DEFAULT_PREFERENCES
  }
}

/** The shared store, where the deployment shows the header; null where this browser's storage is the store. */
function sharedStore(): SharedAccessibility | null {
  if (!sharedAccessibility) return null
  return siteHeaderMode() === null ? null : sharedAccessibility
}

export function loadPreferences(): AccessibilityPreferences {
  const shared = sharedStore()
  if (shared) return shared.read(undefined, siteHeaderCookieOptions()).prefs
  try {
    return parsePreferences(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(prefs: AccessibilityPreferences): void {
  const shared = sharedStore()
  if (shared) {
    // Spread what is kept: the header's button place and a newer product's
    // letters and fields are not this menu's to erase.
    const options = siteHeaderCookieOptions()
    shared.save({ ...shared.read(undefined, options), prefs }, options)
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
 * Where the deployment shows the shared header, the header's own
 * `applySavedAccessibility()` (the shared cookie, seeded once from this
 * browser's earlier choices) and its stylesheet; elsewhere this browser's
 * storage. One source per deployment, so a page never gets two sets.
 */
export function applySavedPreferences(): void {
  const shared = sharedStore()
  if (!shared) {
    applyPreferences(loadPreferences())
    return
  }
  // A failure here is the header's to handle (its mount waits for the same link).
  void linkSharedAccessibilityStylesheet().catch(() => {})
  shared.applySaved(siteHeaderCookieOptions())
}

let stylesheet: Promise<void> | null = null

/**
 * The header's page-wide accessibility stylesheet (what each choice does to
 * the page, the header's own parts included), linked once — and only where
 * the deployment shows the header: the build carries its address, never the
 * rules themselves, so a deployment without the header is styled as before.
 *
 * Resolves once the rules apply, at once where there is nothing to link. The
 * header's mount waits for it (`components/layout/site-header-slot.tsx`): the
 * header draws its accessibility menu only where the rules are on the page,
 * and checks once, when it mounts, while this app's own menu steps aside for
 * it. Rejects when the stylesheet cannot load, so the header fails and the
 * page keeps its own chrome and menu instead of losing both.
 */
export function linkSharedAccessibilityStylesheet(): Promise<void> {
  if (stylesheet) return stylesheet
  if (!a11yStylesheet || sharedStore() === null || typeof document === "undefined") return Promise.resolve()
  const href = a11yStylesheet
  stylesheet = new Promise<void>((resolve, reject) => {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = href
    link.setAttribute("data-site-a11y", "")
    link.addEventListener("load", () => resolve(), { once: true })
    link.addEventListener("error", () => reject(new Error("the shared accessibility stylesheet did not load")), { once: true })
    document.head.appendChild(link)
  })
  return stylesheet
}

/** Test seam: forget the stylesheet linked by an earlier test. */
export function resetSharedAccessibilityStylesheetForTests(): void {
  stylesheet = null
  if (typeof document !== "undefined") for (const link of document.querySelectorAll("link[data-site-a11y]")) link.remove()
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
  const shared = sharedStore()
  if (shared) {
    const until = shared.read(now, siteHeaderCookieOptions()).hiddenUntil
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
  const shared = sharedStore()
  if (shared) {
    const options = siteHeaderCookieOptions()
    shared.save({ ...shared.read(undefined, options), hiddenUntil: until }, options)
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
