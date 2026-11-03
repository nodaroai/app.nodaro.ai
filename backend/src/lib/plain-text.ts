/**
 * Plain text, as the content rights records keep it: what a person or an
 * administrator typed that is forwarded, shown to someone else, or kept on a
 * legal record, so it must read there as it reads here. No control character
 * (C0, DEL, C1), no invisible format character (direction marks, embeddings,
 * overrides, isolates, zero-width spaces, the byte order mark, tag
 * characters), no line or paragraph separator, and no lone surrogate; a line
 * break only where a field allows one, and then as a line feed whatever the
 * client sent. The zero-width joiner and non-joiner stay: some scripts spell
 * words with them, and emoji sequences join with them.
 */
import { z } from "zod"

/** An invisible format character (Unicode category Cf). */
const FORMAT = /\p{Cf}/u

/** The format characters a word may need: zero-width non-joiner and joiner. */
const JOINERS: ReadonlySet<number> = new Set([0x200c, 0x200d])

/** Whether one character may not be typed (a line feed is the caller's to allow). */
function refusedCharacter(ch: string, code: number): boolean {
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true
  if (code >= 0xd800 && code <= 0xdfff) return true
  if (code === 0x2028 || code === 0x2029) return true
  return FORMAT.test(ch) && !JOINERS.has(code)
}

/** Whether text holds what may not be typed: a refused character, or a line break where `lineBreaks` allows none. */
export function hasRefusedCharacters(text: string, opts: { readonly lineBreaks: boolean }): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0x0a && opts.lineBreaks) continue
    if (refusedCharacter(ch, code)) return true
  }
  return false
}

/** A multi-line field's line breaks, whatever the client sent, as a line feed. */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n")
}

/** A field of plain text that may break lines: trimmed, at most `max` characters (empty allowed; a caller that needs some says so). */
export const plainText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" ? normalizeLineBreaks(value) : value),
    z.string().trim().max(max).refine((value) => !hasRefusedCharacters(value, { lineBreaks: true }), { message: "Plain text" }),
  )
