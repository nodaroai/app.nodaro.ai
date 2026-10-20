import type { LocalizedText } from "./types.js"

/**
 * The text in `locale`, else English. An unknown locale, or a language the
 * text has no (or an empty) translation for, reads as English.
 */
export function pickText(t: LocalizedText | undefined, locale: string): string | undefined {
  if (!t) return undefined
  const own = Object.hasOwn(t, locale) ? (t as Record<string, unknown>)[locale] : undefined
  return typeof own === "string" && own.length > 0 ? own : t.en
}
