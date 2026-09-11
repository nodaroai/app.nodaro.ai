/**
 * Join prompt-hint fragments into one injected string.
 *
 * Catalog hints were historically single clauses ("slow camera pan left,
 * rotating horizontally") and every composer glued fragments with `", "`. The
 * tested camera-motion injections are multi-sentence paragraphs that END IN A
 * PERIOD, so the comma join produced `"...no pull-out., beginning with ..."`.
 *
 * This helper keeps the comma between clause-style fragments — every string
 * the composers emitted before it existed is byte-identical — and switches to
 * a single space after a fragment that already closes a sentence. It never
 * strips or adds terminal punctuation: a tested injection ships exactly as
 * approved, and a user's preText/postText is never rewritten.
 */

const ENDS_SENTENCE = /[.!?]$/

export function joinHintFragments(fragments: ReadonlyArray<string>): string {
  let out = ""
  for (const fragment of fragments) {
    if (!fragment) continue
    if (!out) { out = fragment; continue }
    out += ENDS_SENTENCE.test(out) ? ` ${fragment}` : `, ${fragment}`
  }
  return out
}
