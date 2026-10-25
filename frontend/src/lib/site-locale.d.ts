/**
 * `virtual:site-locale` — the interface language every Nodaro product shares
 * (a cookie on the products' common domain), resolved with the shared site
 * header: the header's own locale module on a cloud build with the header,
 * `site-locale-stub.ts` everywhere else. Typed here, never by the header's
 * package, so public CI typechecks without it.
 */
declare module "virtual:site-locale" {
  import type { LocaleId } from "@nodaro/shared/i18n"

  /** The language the viewer chose on any product, or null. */
  export function readSavedLocale(): LocaleId | null
  /** Keeps a choice for every product; a value that is not a platform language is ignored. */
  export function saveLocale(id: string): void
  /** Calls back when the viewer comes back and the shared language is not the one shown (`current`); returns the unsubscribe. */
  export function watchSavedLocale(onChange: (id: LocaleId) => void, current: () => string | null): () => void
}
