/**
 * The public gallery's word filter: does a text name something an admin
 * barred from the gallery? Pure and deterministic — every gallery surface
 * asks the same question the same way.
 *
 * The rules are data, kept by admins (never in code). Each entry is one
 * banned word with its translations (the same word in other languages, as
 * approved) and its exceptions (phrases that are fine although they contain
 * it: "a cup of coffee" for a word that also means "cup").
 *
 * Comparable form (`normalizeForFilter`, applied to the text and the rules
 * alike): compatibility forms folded (full-width letters), invisible format
 * characters dropped (zero-width spaces, soft hyphens, joiners), lower case,
 * accents and vowel points dropped in Latin, Greek, Cyrillic, Arabic and
 * Hebrew, the Hebrew maqaf read as a space, and a Cyrillic or Greek letter
 * that looks Latin read as Latin inside a word that mixes the two scripts.
 *
 * Matching:
 *   - a word matches a WHOLE word of the text. In Hebrew a word also matches
 *     after the one-letter prefixes it can carry (ו, ה, ב, ל, מ, ש, כ, up to
 *     three of them);
 *   - a phrase of several words matches those words in a row (the first may
 *     carry Hebrew prefixes);
 *   - a Korean word matches a word that starts with it (particles follow
 *     the noun: 개가, 개를);
 *   - a word in a script written without spaces (Chinese, Japanese, Thai),
 *     or one with no letters at all (an emoji), matches anywhere in the text;
 *   - an entry's exception phrases free only THAT entry, and only where they
 *     stand as whole words: the word elsewhere in the same text still
 *     matches, and another entry's word inside the phrase is not freed.
 *
 * Built for a page of prompts against hundreds of words in dozens of
 * languages: the rules are compiled once into lookup tables, so checking a
 * prompt costs about the same whatever the size of the list.
 */

export interface GalleryWordEntry {
  /** The banned word or phrase, as the admin typed it. */
  readonly word: string
  /** The same word in other languages. */
  readonly translations: readonly string[]
  /** Phrases that are fine although they contain the word or a translation. */
  readonly exceptions: readonly string[]
  /** Exceptions suggested automatically, waiting for an admin — never applied. */
  readonly suggestedExceptions?: readonly string[]
}

const FORMAT_CHARS = /\p{Cf}/gu
/** A letter of a script whose accents and points are not part of the spelling to us, and the marks after it. */
const FOLDED_MARKS = /([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}])\p{Mn}+/gu
const MAQAF = /־/g
const WORD = /[\p{L}\p{M}\p{N}]+/gu
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u
const HANGUL = /\p{Script=Hangul}/u
const LATIN = /\p{Script=Latin}/u
const HEBREW_PREFIX = /^[ובלמשהכ]/
const HEBREW_START = /^[א-ת]/
const MAX_HEBREW_PREFIXES = 3

/** Cyrillic and Greek letters that pass for Latin ones (lower case). */
const LOOKS_LATIN: Readonly<Record<string, string>> = {
  а: "a", в: "b", е: "e", к: "k", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d", ԛ: "q", ԝ: "w",
  α: "a", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
}
const LOOKS_LATIN_CHAR = new RegExp(`[${Object.keys(LOOKS_LATIN).join("")}]`, "gu")

/** A word that mixes Latin with look-alike letters is read as Latin: "pоrn" with a Cyrillic о. */
function foldLookAlikes(word: string): string {
  if (!LATIN.test(word)) return word
  return word.replace(LOOKS_LATIN_CHAR, (ch) => LOOKS_LATIN[ch] ?? ch)
}

/** The comparable form of a text (see the file header). */
export function normalizeForFilter(text: string): string {
  return text
    .normalize("NFKC")
    .replace(FORMAT_CHARS, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(FOLDED_MARKS, "$1")
    .normalize("NFC")
    .replace(MAQAF, " ")
    .replace(WORD, foldLookAlikes)
    .replace(/\s+/g, " ")
    .trim()
}

function wordsOf(text: string): string[] {
  return text.match(WORD) ?? []
}

/** A word and the words it can be after Hebrew prefixes: והכוס → הכוס, כוס. */
function withoutHebrewPrefixes(token: string): string[] {
  const forms = [token]
  let rest = token
  for (let i = 0; i < MAX_HEBREW_PREFIXES && HEBREW_START.test(rest) && HEBREW_PREFIX.test(rest) && rest.length > 2; i++) {
    rest = rest.slice(1)
    forms.push(rest)
  }
  return forms
}

// ─── Compiled rules ──────────────────────────────────────────────────────

type Term =
  | { readonly kind: "word"; readonly text: string }
  | { readonly kind: "phrase"; readonly text: string; readonly parts: readonly string[] }
  | { readonly kind: "korean"; readonly text: string }
  | { readonly kind: "anywhere"; readonly text: string }

/** One entry in comparable form: its terms (the word, then its translations) and its exceptions. */
export interface CompiledGalleryWordEntry {
  readonly terms: readonly Term[]
  /** Longest first, so "a cup of coffee" is taken out before "cup of". */
  readonly exceptions: readonly RegExp[]
}

/** The rules in comparable form, compiled once — reuse them for every item of a page. */
export interface CompiledGalleryWords {
  readonly entries: readonly CompiledGalleryWordEntry[]
  /** Whole words → the entries with that word (or phrase starting with it). */
  readonly byWord: ReadonlyMap<string, readonly number[]>
  /** First character → the entries with a Korean or anywhere-term starting with it. */
  readonly byFirstChar: ReadonlyMap<string, readonly number[]>
}

function termOf(text: string): Term {
  const parts = wordsOf(text)
  if (parts.length === 0 || NO_SPACE_SCRIPT.test(text)) return { kind: "anywhere", text }
  if (HANGUL.test(text)) return parts.length === 1 ? { kind: "korean", text: parts[0]! } : { kind: "phrase", text, parts }
  return parts.length === 1 ? { kind: "word", text: parts[0]! } : { kind: "phrase", text, parts }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Where an exception phrase frees its word: as whole words, after any Hebrew
 * prefixes; at the start of a word in Korean (particles follow); anywhere in
 * scripts without spaces. Group 1 is always what stood before the phrase.
 */
function exceptionPattern(phrase: string): RegExp {
  const text = escapeRegExp(phrase)
  if (wordsOf(phrase).length === 0 || NO_SPACE_SCRIPT.test(phrase)) return new RegExp(`()${text}`, "gu")
  const before = "(^|[^\\p{L}\\p{M}\\p{N}])"
  if (HANGUL.test(phrase)) return new RegExp(`${before}${text}`, "gu")
  const prefixes = HEBREW_START.test(phrase) ? "(?:[ובלמשהכ]{1,3})?" : ""
  return new RegExp(`${before}${prefixes}${text}(?=$|[^\\p{L}\\p{M}\\p{N}])`, "gu")
}

function cleanList(list: readonly string[]): string[] {
  return [...new Set(list.map(normalizeForFilter).filter((entry) => entry !== ""))]
}

function indexed(map: Map<string, number[]>, key: string, entry: number): void {
  const list = map.get(key)
  if (!list) map.set(key, [entry])
  else if (list[list.length - 1] !== entry) list.push(entry)
}

export function compileGalleryWords(entries: readonly GalleryWordEntry[]): CompiledGalleryWords {
  const compiled = entries
    .map((entry) => ({
      terms: cleanList([entry.word, ...entry.translations]).map(termOf),
      exceptions: cleanList(entry.exceptions)
        .sort((a, b) => b.length - a.length)
        .map(exceptionPattern),
    }))
    .filter((entry) => entry.terms.length > 0)
  const byWord = new Map<string, number[]>()
  const byFirstChar = new Map<string, number[]>()
  compiled.forEach((entry, i) => {
    for (const term of entry.terms) {
      if (term.kind === "word") indexed(byWord, term.text, i)
      else if (term.kind === "phrase") indexed(byWord, term.parts[0]!, i)
      else indexed(byFirstChar, String.fromCodePoint(term.text.codePointAt(0)!), i)
    }
  })
  return { entries: compiled, byWord, byFirstChar }
}

// ─── Matching ────────────────────────────────────────────────────────────

/** A text read once: its comparable form, its words, and each word with Hebrew prefixes taken off. */
interface ReadText {
  readonly comparable: string
  readonly tokens: readonly string[]
  /** Every form of every word → the positions of the words it is a form of. */
  readonly at: ReadonlyMap<string, readonly number[]>
}

function readText(comparable: string): ReadText {
  const tokens = wordsOf(comparable)
  const at = new Map<string, number[]>()
  tokens.forEach((token, i) => {
    for (const form of withoutHebrewPrefixes(token)) indexed(at, form, i)
  })
  return { comparable, tokens, at }
}

function termIn(term: Term, text: ReadText): boolean {
  switch (term.kind) {
    case "word":
      return text.at.has(term.text)
    case "phrase":
      return (text.at.get(term.parts[0]!) ?? []).some((start) => term.parts.every((part, k) => k === 0 || text.tokens[start + k] === part))
    case "korean":
      return text.tokens.some((token) => token.startsWith(term.text))
    case "anywhere":
      return text.comparable.includes(term.text)
  }
}

function firstTermIn(entry: CompiledGalleryWordEntry, text: ReadText): string | null {
  return entry.terms.find((term) => termIn(term, text))?.text ?? null
}

/** The entries that could match this text, in list order (the lookup tables, then a check). */
function candidates(rules: CompiledGalleryWords, text: ReadText): number[] {
  const found = new Set<number>()
  for (const form of text.at.keys()) for (const entry of rules.byWord.get(form) ?? []) found.add(entry)
  if (rules.byFirstChar.size > 0) {
    for (const ch of new Set(text.comparable)) for (const entry of rules.byFirstChar.get(ch) ?? []) found.add(entry)
  }
  return [...found].sort((a, b) => a - b)
}

/** The banned term the text contains (in its comparable form), or null. */
export function findBannedWord(text: string, rules: CompiledGalleryWords): string | null {
  if (rules.entries.length === 0 || text.trim() === "") return null
  const base = readText(normalizeForFilter(text))
  for (const i of candidates(rules, base)) {
    const entry = rules.entries[i]!
    const hit = firstTermIn(entry, base)
    if (hit === null) continue
    if (entry.exceptions.length === 0) return hit
    // Only now take this entry's exceptions out — a page of prompts rarely gets here.
    const freed = entry.exceptions.reduce((rest, pattern) => rest.replace(pattern, (_m, before: string) => `${before} `), base.comparable)
    const stillThere = firstTermIn(entry, readText(freed))
    if (stillThere !== null) return stillThere
  }
  return null
}
