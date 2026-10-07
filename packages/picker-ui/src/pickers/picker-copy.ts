/**
 * The package owns no dictionary. A picker that renders interface strings
 * around its tiles takes them from the host in the host's language (`copy`),
 * and takes a localizer for its catalog's English section names
 * (`localizeLabel`). Both default to English, so a host that passes neither
 * renders what the picker always rendered.
 */

/** The strings every search-first picker renders around its tiles. */
export interface PickerSearchCopy {
  /** The search box placeholder, which is also its accessible name. */
  readonly searchPlaceholder: string
  /** Shown when the search matches nothing. */
  readonly noMatch: (query: string) => string
}

/** The default `localizeLabel`: English hosts need nothing. */
export const identityLabel = (english: string): string => english
