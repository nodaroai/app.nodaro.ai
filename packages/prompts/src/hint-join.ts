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

/** A piece that already closes a sentence: a Latin or CJK full stop, question
 *  or exclamation mark, or an ellipsis. */
const ENDS_SENTENCE = /[.!?…。！？]$/

export function joinHintFragments(fragments: ReadonlyArray<string>): string {
  let out = ""
  for (const fragment of fragments) {
    if (!fragment) continue
    if (!out) { out = fragment; continue }
    out += ENDS_SENTENCE.test(out) ? ` ${fragment}` : `, ${fragment}`
  }
  return out
}

/**
 * Join prompt pieces as sentences: `". "` between two pieces, or a single
 * space when the piece before already ends a sentence. Without that check a
 * prompt typed with a closing period came out as
 * "no watermark.. butterfly portrait lighting". Blank pieces are dropped. The
 * pieces are otherwise kept verbatim, except that trailing space before a join
 * is not carried into it ("cat " + "hint" gives "cat. hint").
 */
export function joinSentences(pieces: ReadonlyArray<string | undefined>): string {
  let out = ""
  for (const piece of pieces) {
    if (!piece || !piece.trim()) continue
    if (!out) { out = piece; continue }
    const head = out.trimEnd()
    out = ENDS_SENTENCE.test(head) ? `${head} ${piece}` : `${head}. ${piece}`
  }
  return out
}

/**
 * Append wired picker hints to a prompt, the way both DAG engines fold them:
 * the hints join as clauses (`joinHintFragments`), then follow the prompt as a
 * new sentence (`joinSentences`). No hints (or only blank ones) gives the
 * prompt back unchanged.
 */
export function appendPromptHints(prompt: string | undefined, hints: ReadonlyArray<string>): string {
  const joined = joinHintFragments(hints)
  return joined.trim() ? joinSentences([prompt, joined]) : (prompt ?? "")
}
