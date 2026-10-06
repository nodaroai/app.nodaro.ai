/**
 * The exact figures on a captured page, read from its DOM text (never from
 * pixels). Every fact is a verbatim substring of the page text with its
 * whitespace collapsed (the way §8.3 matches), on one line, at most 120
 * characters, deduplicated, at most 30.
 *
 * Patterns run over the text with its line breaks kept, because a price card
 * is laid out over several lines ("$10", "/mo") and a count's noun phrase must
 * end where the line does; each match is collapsed to one line afterwards.
 */

type Tier = 0 | 1 | 2 | 3

/** Horizontal whitespace: a space or tab, never a line break. */
const HS = "[^\\S\\r\\n]"
const LETTER = "[\\p{L}\\p{M}'’-]"
const WORD = `\\p{L}${LETTER}*`

/** A number: 1,200.50 · 1.200,50 · 12,99 · 650.000 · 4500. */
const NUM = "(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)"
const CURRENCY_SIGN = "[$€£₪]"
/** What a price is per: "/mo", "/ MO", "per month", "pro Monat", "לחודש". A line break is allowed before it. */
const PERIOD = `(?:\\s*\\/\\s*(?:mo|month|yr|year|user|seat|monat|jahr)(?![\\p{L}])|\\s+(?:per|a|pro)\\s+(?:month|year|user|seat|monat|jahr|nutzer)(?![\\p{L}])|\\s+(?:לחודש|בחודש|לשנה))?`
/** A word that never starts or continues a noun phrase. */
const STOP =
  "(?:a|an|and|are|at|by|for|from|have|has|in|is|of|on|the|to|use|uses|who|with|love|trust|per|or|as|be|was|will|can|you|your|our|we|it|that|this|than|pro|mit|und|der|die|das|den|dem|für|von|im|bei|zu|zum|zur|auf|oder|als|wie|ist|sind|nach|aus|über)"
const NOUN = `(?!${STOP}(?![\\p{L}\\p{M}'’-]))${WORD}`
/** A noun phrase after "% of": words, or a number ("62% of Fortune 100"). */
const NOUN_OR_NUMBER = `(?:${NOUN}|\\d+)`
const QUALIFIER = `(?:(?:over|up to|more than|less than|under|almost|nearly|about|around|bis zu|mehr als)${HS}+)`
const MONTH =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec|" +
  "Januar|Februar|März|Maerz|Mai|Juni|Juli|Oktober|Dezember|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|" +
  "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|" +
  "ב?(?:ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר))"
const TIME_UNIT =
  "(?:years?|months?|weeks?|days?|hours?|minutes?|mins?|Jahre|Jahren|Monate|Monaten|Wochen|Tage|Tagen|Stunden|Minuten)"
/** A count's number: 12,000 · 1.4M+ · 200+ · 10k · 2024 · or a single digit that is followed by a unit of time. */
const COUNT_NUM = `(?:${NUM}[kKmMbB]\\+?|${NUM}\\+|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d{2,}(?:[.,]\\d+)?|\\d(?=${HS}+(?:consecutive${HS}+|straight${HS}+)?${TIME_UNIT}(?![\\p{L}])))`
/** Never mid-number, never after a currency sign, never the minutes of a clock time. */
const COUNT_START = `(?<![\\d.,:$€£₪])(?<!\\d[\\s-]?)`

interface FactPattern {
  tier: Tier
  re: RegExp
}

const FACT_PATTERNS: readonly FactPattern[] = [
  // Currency amounts with an optional period: "$6/month", "€9.99 per month", "₪49 לחודש", "9,99 €", "10 $ /mo".
  // A sign after an amount never opens the next price ("Plan 1 $10" is "$10", not "1 $").
  {
    tier: 0,
    re: new RegExp(
      `(?:${QUALIFIER})?(?:${CURRENCY_SIGN}${HS}?${NUM}|${NUM}${HS}?(?:${CURRENCY_SIGN}(?!${HS}?\\d)|(?:USD|EUR|GBP|ILS|CHF)(?![\\p{L}])))${PERIOD}`,
      "giu",
    ),
  },
  // Ratings: "4.8 stars", "4.8/5", "★ 4.8".
  { tier: 0, re: /(?<![\d.])[0-5](?:\.\d)?\s?(?:\/\s?5\b|stars?\b|out of 5\b)|★\s?[0-5](?:\.\d)?/giu },
  // Percentages, with up to two words that say what they are a percentage of: "21 % weniger Zeitaufwand", "Over 50% of YC companies".
  {
    tier: 1,
    re: new RegExp(`(?:${QUALIFIER})?(?<![\\d.])\\d{1,3}(?:[.,]\\d+)?${HS}?%(?:${HS}+of(?![\\p{L}])(?:${HS}+${NOUN_OR_NUMBER}){1,3}|(?:${HS}+${NOUN}){0,2})`, "giu"),
  },
  // Durations: "14-day free trial", "30-day money-back guarantee".
  { tier: 1, re: /\b\d{1,3}[-\s](?:day|week|month|year)s?\s(?:free\s)?(?:trial|money-back guarantee|guarantee)\b/giu },
  // Dates: "1 June 2026", "June 1, 2026", "1. Juni 2026", "1 ביוני 2026".
  {
    tier: 1,
    re: new RegExp(
      `(?<![\\d.])\\d{1,2}\\.?${HS}+(?:of${HS}+)?(?<![\\p{L}])${MONTH}(?![\\p{L}])\\.?,?${HS}+\\d{4}(?!\\d)|(?<![\\p{L}])${MONTH}\\.?${HS}+\\d{1,2}(?:st|nd|rd|th)?,${HS}+\\d{4}(?!\\d)`,
      "giu",
    ),
  },
  // A founding year: "Since 2012", "Est. 1998".
  { tier: 1, re: /(?<![\p{L}])(?:since|seit|est\.?|established|depuis|desde|מאז)\s(?:19|20)\d{2}(?!\d)/giu },
  // Counts with a noun of up to three words, an optional second count ("100M users in over 50 countries") and an
  // optional period ("4,500 CREDITS / MO"). The noun phrase ends at the end of the line.
  {
    tier: 2,
    re: new RegExp(
      `(?:${QUALIFIER})?${COUNT_START}${COUNT_NUM}(?:${HS}+${NOUN}){1,3}(?:${HS}+to${HS}+${NOUN})?` +
        `(?:${HS}+(?:in|across|from)${HS}+(?:(?:over|more than)${HS}+)?${COUNT_NUM}(?:${HS}+${NOUN}){1,2}|\\s*\\/\\s*(?:mo|month|yr|year|day|user|seat)(?![\\p{L}]))?`,
      "giu",
    ),
  },
  // A clock time or a media duration: "0:36", "10:45 AM".
  { tier: 3, re: /(?<![\d:.])\d{1,2}:\d{2}(?::\d{2})?(?:[^\S\r\n]?[AP]M\b)?(?![\d:])/giu },
]

/** A plain 4-digit year at the start of a match, as in a copyright line. */
const YEAR = /^(?:19|20)\d{2}(?!\d)/

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim()

/** One figure however it is spelled: case, spacing and which side of the amount the currency sign sits on do not count. */
const sameFigure = (s: string): string => `${s.toLowerCase().replace(/[$€£₪]/g, "").replace(/\s+/g, "")}|${s.match(/[$€£₪]/)?.[0] ?? ""}`

interface Found {
  at: number
  end: number
  tier: Tier
  value: string
}

export function extractPageFacts(text: string): string[] {
  const found: Found[] = []
  for (const { tier, re } of FACT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const value = collapse(m[0])
      if (value.length === 0 || value.length > 120) continue
      if (YEAR.test(value) && !/[%$€£₪]/.test(value)) continue
      const at = m.index ?? 0
      found.push({ at, end: at + m[0].length, tier, value })
    }
  }
  const ordered = [...found].sort((a, b) => a.at - b.at || b.end - b.at - (a.end - a.at))
  // A figure that a longer one on the same stretch of text contains is that figure.
  const longest = ordered.filter((f) => !ordered.some((g) => g !== f && g.end - g.at > f.end - f.at && g.at < f.end && f.at < g.end))
  const seen = new Set<string>()
  const unique = longest.filter((f) => {
    const key = sameFigure(f.value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // At most 30: prices, ratings, percentages, dates and durations ahead of loose counts and times, then page order.
  const kept = unique
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.tier - b.f.tier || a.i - b.i)
    .slice(0, 30)
    .sort((a, b) => a.i - b.i)
  return kept.map(({ f }) => f.value)
}
