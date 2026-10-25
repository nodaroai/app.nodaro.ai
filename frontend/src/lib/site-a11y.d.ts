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
    readonly spacing: boolean
    readonly links: boolean
    readonly headings: boolean
    readonly readableFont: boolean
    readonly bigCursor: boolean
    readonly stopMotion: boolean
  }

  /** The choices plus the corner button's hiding (`null` = shown). */
  export interface SharedAccessibilityState {
    readonly prefs: SharedAccessibilityPreferences
    readonly hiddenUntil: number | null
  }

  export interface SharedAccessibility {
    /**
     * What the viewer chose on any product. With no shared choice yet, the
     * app's earlier per-browser choices are read once and written through.
     */
    read(now?: number): SharedAccessibilityState
    /** Keeps the choices for every product. */
    save(state: SharedAccessibilityState): void
    /** Reads and applies the choices to `<html>` (before the first paint). Never throws. */
    applySaved(): void
  }

  /** The shared store, or null on a build without the shared header. */
  export const sharedAccessibility: SharedAccessibility | null
}
