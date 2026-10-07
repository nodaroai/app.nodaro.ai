/**
 * Remove inline `[audio tags]` from speech text, for a model that does not
 * perform them (it would read them aloud). Pure, dependency-free: the
 * backend's credit counter (lib/speech-credits.ts), its payload builder and
 * the editor's estimate (frontend/src/lib/speech-estimate.ts) all read it, so
 * the two engines count exactly the same characters.
 *
 * A tag is `[`, one or more characters that are not `]`, then `]` — what
 * `/\[[^\]]+\]/g` matches. That pattern is quadratic on an unclosed run of `[`
 * (every `[` rescans to the end of the text), and the credit counter runs this
 * on raw request text on the API and orchestrator event loops, so the scan is
 * written by hand: one `indexOf` per `[`, and when no `]` is left no later `[`
 * can match either, so the rest of the text is kept in one slice.
 */
function removeBracketTags(text: string): string {
  let out = ""
  let from = 0
  let open = text.indexOf("[")
  while (open !== -1) {
    const close = text.indexOf("]", open + 1)
    if (close === -1) break
    if (close === open + 1) {
      // "[]" is not a tag (needs 1+ characters); the "[" stays and the scan moves on.
      open = text.indexOf("[", open + 1)
      continue
    }
    out += text.slice(from, open)
    from = close + 1
    open = text.indexOf("[", from)
  }
  return out + text.slice(from)
}

export function stripAudioTags(text: string): string {
  return removeBracketTags(text).replace(/\s{2,}/g, " ").trim()
}
