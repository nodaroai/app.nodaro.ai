/** Minimal shape the pill matcher needs (subset of SnippetPoolItem). */
export interface MatchableSnippet {
  readonly id: string
  readonly name: string
  readonly text: string
}

export interface SnippetRange {
  readonly start: number
  readonly end: number
  readonly snippet: MatchableSnippet
}

/**
 * Exact, case-sensitive substring matcher for the display-pill layer.
 * Longest-text-first so a snippet containing another never gets shadowed;
 * within equal length, pool order wins (user snippets precede factory in the
 * pool, giving user-over-factory precedence on identical text). Never returns
 * overlapping ranges and never matches inside `occupied` spans (mention /
 * image-ref pills). O(snippets × line length) via indexOf — pool ≤ a few
 * hundred entries, prompts ≤ a few KB; negligible.
 */
export function matchSnippetRanges(
  line: string,
  snippets: readonly MatchableSnippet[],
  occupied: ReadonlyArray<{ start: number; end: number }>,
): SnippetRange[] {
  if (!line || snippets.length === 0) return []
  // Stable longest-first ordering (sort is stable in JS — pool order preserved
  // within equal lengths).
  const ordered = [...snippets].sort((a, b) => b.text.length - a.text.length)
  const taken: Array<{ start: number; end: number }> = [...occupied]
  const overlaps = (s: number, e: number) => taken.some((t) => s < t.end && e > t.start)
  const out: SnippetRange[] = []
  for (const sn of ordered) {
    if (!sn.text) continue
    let from = 0
    while (true) {
      const idx = line.indexOf(sn.text, from)
      if (idx === -1) break
      const end = idx + sn.text.length
      if (!overlaps(idx, end)) {
        out.push({ start: idx, end, snippet: sn })
        taken.push({ start: idx, end })
      }
      from = idx + 1
    }
  }
  return out.sort((a, b) => a.start - b.start)
}
