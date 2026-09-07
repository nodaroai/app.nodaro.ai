/**
 * THE PLATFORM'S MENTION-SEGMENT CLASS — the one grammar rule shared by the WIRE
 * binders (`lib/prompt-mentions`, `lib/directing-references`) and by the cast's
 * own `@<role-slug>` PROSE token (`lib/cast`'s `roleToken`, C6).
 *
 * It lives in a module of its own for one structural reason: the binders must be
 * able to read the role-token grammar (`roleTokenForName`) to degrade a token
 * nothing bound back to a readable name, and `lib/cast` must be able to read the
 * segment class to refuse a token the wire could never bind. Leaving the class in
 * `prompt-mentions` made those two imports a cycle, and a cycle is exactly the
 * pressure that produced a copy of the rule somewhere else.
 */

/** A mention slug segment the platform grammar accepts (`@town:1`, `@kira:2`).
 *  Both parsers require a lowercase-letter start — `characterMentionSlug` can
 *  emit "" (unsluggable name) or a digit-led slug ("3D Render" → `3d-render`),
 *  neither of which any token can bind. */
export const MENTION_SEGMENT = /^[a-z][a-z0-9-]*$/

/**
 * Is `slug` a segment the platform's mention grammar can bind? THE grammar
 * class, exported so the cast's own `@role-slug` prose token (C6 — see
 * `lib/cast`'s `roleToken`) is gated on the very pattern the binder rewrites
 * on. A studio-local copy of the class is exactly the drift that would let the
 * editor serialize a token the wire then hands the model literally.
 */
export function isMentionSegment(slug: string): boolean {
  return MENTION_SEGMENT.test(slug)
}

/**
 * The text that must NOT follow an emitted `@<role-slug>` token (C6). Letters
 * and digits are the ordinary word boundary; `-` and `:` are the two characters
 * that would make the run a DIFFERENT, longer token than the one claimed —
 * `@panda` inside `@panda-2`, or an already-indexed `@panda:1` — and binding
 * either would point the model at the wrong reference and leave a literal
 * remainder in the prose.
 *
 * Shared by every token reader (both wire binders, the rename's `namePattern`,
 * the restore's `buildPromptDoc`, the typed-mention recovery), so "where does a
 * role token end" is answered in exactly one place.
 */
export const TOKEN_TRAILING = /[\p{L}\p{N}:-]/u

/** What must NOT precede a role token: a word character (the token starts a run)
 *  or a second `@` — a typed `@@panda` is prose, never a token. */
const TOKEN_LEADING = /[\p{L}\p{N}@]/u

/**
 * Is the run at `[start, start + length)` in `text` a WHOLE role token, rather
 * than the head of a longer one (`@panda` inside `@panda-2` / `@panda:1`) or a
 * fragment of a word? The claim rule every token READER shares — the two wire
 * binders match it as a regex, the restore (`buildPromptDoc`) and the typed
 * recovery ask it directly, so an index-based claim can't drift from a
 * pattern-based one.
 */
export function isWholeToken(
  text: string,
  start: number,
  length: number,
): boolean {
  const before = text[start - 1]
  if (before !== undefined && TOKEN_LEADING.test(before)) return false
  const next = text[start + length]
  return next === undefined || !TOKEN_TRAILING.test(next)
}
