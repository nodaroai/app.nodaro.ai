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

/** A header past this many languages is read no further. */
const MAX_ACCEPTED_LANGUAGES = 32

/**
 * The first of `locales` an `Accept-Language` header asks for, highest
 * weight first (`;q=`, ties in the order sent; `q=0` refuses a language):
 * the exact tag, case-insensitively (`pt-br` is `pt-BR`), else its primary
 * language (`he-IL` is `he`, `pt` is `pt-BR`). Undefined when it asks for
 * none of them, or is absent.
 */
export function acceptedLocale(header: string | string[] | undefined, locales: ReadonlyArray<string>): string | undefined {
  const raw = Array.isArray(header) ? header.join(",") : header
  if (!raw) return undefined
  const byTag = new Map(locales.map((l) => [l.toLowerCase(), l]))
  const byPrimary = new Map<string, string>()
  for (const l of locales) {
    const primary = l.toLowerCase().split("-")[0]!
    if (!byPrimary.has(primary)) byPrimary.set(primary, l)
  }
  const asked = raw
    .split(",")
    .slice(0, MAX_ACCEPTED_LANGUAGES)
    .map((part, order) => {
      const [tag = "", ...params] = part.trim().split(";")
      const q = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith("q="))
      const weight = q === undefined ? 1 : Number(q.slice(2))
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, order }
    })
    .filter((a) => a.tag && a.tag !== "*" && a.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.order - b.order)
  for (const { tag } of asked) {
    const found = byTag.get(tag) ?? byPrimary.get(tag.split("-")[0]!)
    if (found) return found
  }
  return undefined
}
