/**
 * ⌘F inside the inspector (§2.3 of the inspectors design): a case- and
 * diacritic-insensitive search over the transcript's words, with "n of m" and
 * next / previous. A query may span words ("one market") or match part of one.
 *
 * The words are folded once into one text (`buildFindIndex`), each word's start
 * recorded, so a search is one scan of a 3-hour transcript and a match maps
 * back to the words it covers by binary search.
 */

/** Lower case, accents removed, runs of whitespace as one space, trimmed. */
export function foldForFind(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export interface FindIndex {
  /** Every word folded, joined by single spaces. */
  readonly text: string
  /** Where each word starts in `text`. */
  readonly starts: Int32Array
}

export function buildFindIndex(words: readonly { readonly text: string }[]): FindIndex {
  const starts = new Int32Array(words.length)
  const parts: string[] = []
  let at = 0
  for (let i = 0; i < words.length; i++) {
    const folded = foldForFind(words[i]!.text)
    starts[i] = at
    parts.push(folded)
    at += folded.length + 1
  }
  return { text: parts.join(" "), starts }
}

/** A match: the words it covers, inclusive. */
export interface FindMatch {
  readonly first: number
  readonly last: number
}

/** The word whose text holds offset `at` (the last word starting at or before it). */
function wordAt(starts: Int32Array, at: number): number {
  let lo = 0
  let hi = starts.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (starts[mid]! <= at) lo = mid + 1
    else hi = mid
  }
  return Math.max(0, lo - 1)
}

/** Every match of `query`, in transcript order, never overlapping. */
export function findMatches(index: FindIndex, query: string): FindMatch[] {
  const needle = foldForFind(query)
  if (!needle || index.starts.length === 0) return []
  const matches: FindMatch[] = []
  for (let at = index.text.indexOf(needle); at >= 0; at = index.text.indexOf(needle, at + needle.length)) {
    matches.push({ first: wordAt(index.starts, at), last: wordAt(index.starts, at + needle.length - 1) })
  }
  return matches
}

/** The match after (`1`) or before (`-1`) match `current`, wrapping round; -1 when there is none. */
export function stepMatch(matches: readonly FindMatch[], current: number, dir: 1 | -1): number {
  if (matches.length === 0) return -1
  return (((current + dir) % matches.length) + matches.length) % matches.length
}

/** The first match that reaches `word` or comes after it, wrapping to the first; -1 when there is none. */
export function matchAtOrAfter(matches: readonly FindMatch[], word: number): number {
  if (matches.length === 0) return -1
  let lo = 0
  let hi = matches.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (matches[mid]!.last < word) lo = mid + 1
    else hi = mid
  }
  return lo < matches.length ? lo : 0
}
