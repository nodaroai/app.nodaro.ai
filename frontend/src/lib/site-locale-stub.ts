import type { LocaleId } from "@nodaro/shared/i18n"

/**
 * `virtual:site-locale` on every build without the shared site header
 * (community, business, public CI, a cloud build with the flag off) and in
 * tests: there is no other product to share a language with, so no cookie.
 * The locale store keeps the choice in its own storage, as before.
 */

export function readSavedLocale(): LocaleId | null {
  return null
}

export function saveLocale(_id: string): void {}

export function watchSavedLocale(_onChange: (id: LocaleId) => void, _current: () => string | null): () => void {
  return () => {}
}
