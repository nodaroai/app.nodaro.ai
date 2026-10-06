/**
 * The exact figures on a captured page, read from its DOM text (never from
 * pixels). Every fact is a verbatim substring of the text it was read from.
 */

const NOT_A_NOUN = "(?:a|an|and|are|at|by|for|from|have|has|in|is|of|on|the|to|use|uses|who|with|love|trust|per)"

const FACT_PATTERNS: readonly RegExp[] = [
  // Currency amounts with an optional period: "$6/month", "€9.99 per month", "₪49 לחודש", "9,99 €".
  // A sign after an amount never opens the next price ("Plan 1 $10" is "$10", not "1 $").
  /(?:[$€£₪]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:[$€£₪](?!\s?\d)|(?:USD|EUR|GBP|ILS)\b))(?:\s?\/\s?(?:mo|month|yr|year|user|seat)\b|\s(?:per|a)\s(?:month|year|user|seat)\b|\sלחודש|\sבחודש)?/giu,
  // Ratings: "4.8 stars", "4.8/5", "★ 4.8".
  /(?<![\d.])[0-5](?:\.\d)?\s?(?:\/\s?5\b|stars?\b|out of 5\b)|★\s?[0-5](?:\.\d)?/giu,
  // Percentages.
  /(?<![\d.])\d{1,3}(?:\.\d+)?\s?%/gu,
  // Durations: "14-day free trial", "30-day money-back guarantee".
  /\b\d{1,3}[-\s](?:day|week|month|year)s?\s(?:free\s)?(?:trial|money-back guarantee|guarantee)\b/giu,
  // Counts with a noun of up to three words: "12,000 home cooks", "10k+ teams". Never a digit
  // group that follows another one (a phone number), never mid-number, never after a currency sign.
  new RegExp(
    `(?<![\\d.,$€£₪])(?<!\\d[\\s-]?)(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?[kKmM]\\+?|\\d+\\+|\\d{2,})(?:\\s(?!${NOT_A_NOUN}\\b)\\p{L}[\\p{L}'-]*){1,3}`,
    "gu",
  ),
]

/** A plain 4-digit year at the start of a match, as in a copyright line. */
const YEAR = /^(?:19|20)\d{2}(?!\d)/

export function extractPageFacts(text: string): string[] {
  const found: Array<{ at: number; value: string }> = []
  for (const re of FACT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const value = m[0].trim()
      if (value.length === 0 || value.length > 120) continue
      if (YEAR.test(value) && !/[%$€£₪]/.test(value)) continue
      found.push({ at: m.index ?? 0, value })
    }
  }
  const ordered = [...found].sort((a, b) => a.at - b.at || b.value.length - a.value.length)
  const longest = ordered.filter((f) => !ordered.some((g) => g.value.length > f.value.length && g.value.includes(f.value)))
  const unique = longest.filter((f, i) => longest.findIndex((g) => g.value === f.value) === i)
  return unique.map((f) => f.value).slice(0, 30)
}
