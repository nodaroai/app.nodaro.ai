/**
 * THE ONE READING OF `@` IN AUTHORED PROSE.
 *
 * A typed `@name` run. The name may hold spaces ("@Old Library"), so the scan is
 * greedy over words and every prefix is offered to the caller — the CAST decides
 * where the name ends, not a regex.
 *
 * Its own module (the R74 split's shape) because two very different readers ask
 * it the same question and must never grow a second regex between them:
 * `scanCastTokens` (`cast`) walks each run's prefixes through the
 * enrollment ladder, and the plan importer's readiness signal (`countMentions`,
 * `production-format/import.ts`) counts the runs themselves, against no library
 * at all. Not to be confused with `mention-grammar`, which is the
 * PLATFORM WIRE's `@slug:N` grammar — a different language for a different
 * reader.
 */
/** A word of a typed name: a word character to start, then word characters,
 *  the apostrophes and the hyphen a name may carry ("O'Brien", "Jean-Luc").
 *  ONE alphabet — {@link AT_TOKEN_RE} is built from it and {@link isNameChar}
 *  reads it, so a reader that walks a run by hand (the importer's
 *  canonicalization) can never accept a character the scanner would refuse. */
const WORD_START = String.raw`[\p{L}\p{N}]`
const WORD_REST = String.raw`[\p{L}\p{N}'’-]`
const AT_TOKEN_RE = new RegExp(
  String.raw`(^|[^\p{L}\p{N}@])@(${WORD_START}${WORD_REST}*(?:[ \t]${WORD_START}${WORD_REST}*)*)`,
  "gu",
)
const NAME_CHAR_RE = new RegExp(String.raw`^(?:${WORD_REST}|[ \t])$`, "u")

/** May `ch` sit inside a typed name — a word character, an apostrophe, a
 *  hyphen, or the single gap between two words? The scanner's own alphabet;
 *  where a name ENDS is the binder's question (`endsTypedName`), not this one. */
export function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && NAME_CHAR_RE.test(ch)
}

/** One `@` run: the mention text exactly as written, and the index of its `@`. */
export interface CastMentionRun {
  readonly run: string
  readonly start: number
}

/** Every `@` run in `text`, in order. */
export function castMentionRuns(text: string): CastMentionRun[] {
  if (!text.includes("@")) return []
  const out: CastMentionRun[] = []
  for (const m of text.matchAll(AT_TOKEN_RE)) {
    out.push({ run: m[2], start: (m.index ?? 0) + (m[1] ?? "").length })
  }
  return out
}
