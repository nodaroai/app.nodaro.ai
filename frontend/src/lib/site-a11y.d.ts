/**
 * `virtual:site-a11y` — the accessibility choices every Nodaro product shares
 * (a cookie on the products' common domain), resolved with the shared site
 * header: on a cloud build with the header, an adapter over the header's own
 * accessibility module (it also loads the header's page-wide accessibility
 * stylesheet); everywhere else `site-a11y-stub.ts`, `null`, and the app keeps
 * its own per-browser storage. Typed here, never by the header's package, so
 * public CI typechecks without it.
 */
declare module "virtual:site-a11y" {
  export interface SharedAccessibilityPreferences {
    readonly textScale: 0 | 1 | 2
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

  /** Where the viewer moved the header's button: its top-left corner in whole percent of the viewport. */
  export interface ButtonPosition {
    readonly x: number
    readonly y: number
  }

  /**
   * The choices plus the corner button's hiding (`null` = shown) and place
   * (absent or `null` = the default corner). `unknownLetters` and
   * `extraFields` are what a newer product wrote that this one does not know.
   * The app never builds a state from scratch: it spreads what `read()`
   * returned, so a save from its own menu keeps the place and those unknowns.
   */
  export interface SharedAccessibilityState {
    readonly prefs: SharedAccessibilityPreferences
    readonly hiddenUntil: number | null
    readonly position?: ButtonPosition | null
    readonly unknownLetters?: string
    readonly extraFields?: readonly string[]
  }

  export interface SharedAccessibility {
    /**
     * What the viewer chose on any product. With no shared choice yet, the
     * app's earlier per-browser choices are read once and written through.
     */
    read(now?: number): SharedAccessibilityState
    /** Keeps the choices for every product (the package's own cookie writer). */
    save(state: SharedAccessibilityState): void
    /** Reads and applies the choices to `<html>` (before the first paint). Never throws. */
    applySaved(): void
  }

  /** The shared store, or null on a build without the shared header. */
  export const sharedAccessibility: SharedAccessibility | null
}
