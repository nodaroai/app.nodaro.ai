import type { DisplayOrigin, DisplaySegment } from "@/components/editor/config-panels/prompt-field-final-view"

/** A known text fragment to locate in the assembled prompt, with its colour origin. */
export interface ProvenanceFragment {
  readonly text: string
  readonly origin: Exclude<DisplayOrigin, "user">
}

/**
 * Partition `finalText` into origin-tagged segments by locating known fragments
 * VERBATIM inside it. Fragments are consumed in PRECEDENCE ORDER (earlier wins on
 * overlap); each match marks its span occupied so later/inner fragments can't
 * double-tag. Unmatched text stays "user". Pure partitioning, so
 * `segments.map(s => s.text).join("") === finalText` ALWAYS holds — the absolute
 * join-invariant `PromptFieldFinalView` relies on is satisfied by construction.
 *
 * Robust to assembly rewrites: it tags whatever survived verbatim in the FINAL
 * string (same discipline as `matchSnippetRanges`), so reference/{image:N}/
 * truncation rewrites degrade a fragment to "untagged" rather than collapsing
 * ALL colour to one user span.
 *
 * Caller orders fragments outer/structural-first: reference block (mention),
 * style suffix, negative suffix, identity clause (mention), variables, pickers,
 * snippets.
 */
export function tagPromptProvenance(
  finalText: string,
  fragments: readonly ProvenanceFragment[],
): DisplaySegment[] {
  if (!finalText) return []

  const taken: Array<{ start: number; end: number; origin: DisplayOrigin }> = []
  const overlaps = (s: number, e: number) => taken.some((t) => s < t.end && e > t.start)

  for (const frag of fragments) {
    if (!frag.text) continue
    let from = 0
    while (true) {
      const idx = finalText.indexOf(frag.text, from)
      if (idx === -1) break
      const end = idx + frag.text.length
      if (!overlaps(idx, end)) taken.push({ start: idx, end, origin: frag.origin })
      from = idx + 1
    }
  }

  if (taken.length === 0) return [{ text: finalText, origin: "user" }]

  taken.sort((a, b) => a.start - b.start)

  const out: DisplaySegment[] = []
  let cursor = 0
  for (const t of taken) {
    if (t.start > cursor) out.push({ text: finalText.slice(cursor, t.start), origin: "user" })
    out.push({ text: finalText.slice(t.start, t.end), origin: t.origin })
    cursor = t.end
  }
  if (cursor < finalText.length) out.push({ text: finalText.slice(cursor), origin: "user" })

  return out
}
