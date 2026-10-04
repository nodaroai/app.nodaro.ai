/**
 * The gallery word filter. Neutral stand-in words on purpose: the real list
 * is admin data, never code.
 */
import { describe, it, expect } from "vitest"
import { compileGalleryWords, findBannedWord, normalizeForFilter, type GalleryWordEntry } from "../gallery-word-filter.js"

const entry = (word: string, translations: string[] = [], exceptions: string[] = []): GalleryWordEntry => ({ word, translations, exceptions })
const rules = (...entries: GalleryWordEntry[]) => compileGalleryWords(entries)

describe("findBannedWord", () => {
  it("finds a banned word as a whole word, whatever its case", () => {
    const r = rules(entry("bucket"))
    expect(findBannedWord("A RED Bucket on a table", r)).toBe("bucket")
    expect(findBannedWord("buckets of paint", r)).toBeNull()
    expect(findBannedWord("abucket", r)).toBeNull()
  })

  it("finds a translation like the word itself", () => {
    const r = rules(entry("דלי", ["bucket", "seau"]))
    expect(findBannedWord("un seau rouge", r)).toBe("seau")
    expect(findBannedWord("a red bucket", r)).toBe("bucket")
  })

  it("an exception frees itself only — the word elsewhere still matches", () => {
    const r = rules(entry("bucket", [], ["bucket of water"]))
    expect(findBannedWord("a bucket of water on the floor", r)).toBeNull()
    expect(findBannedWord("a bucket of water and a bucket", r)).toBe("bucket")
  })

  it("an exception frees its word in every language of the entry", () => {
    const r = rules(entry("דלי", ["bucket"], ["דלי מים", "bucket of water"]))
    expect(findBannedWord("bucket of water", r)).toBeNull()
    expect(findBannedWord("דלי מים", r)).toBeNull()
  })

  it("an exception never frees another entry's word inside it", () => {
    const r = rules(entry("bucket", [], ["red bucket"]), entry("red"))
    expect(findBannedWord("a red bucket", r)).toBe("red")
  })

  it("the longest exception is taken out first", () => {
    // Taking "of coffee" out first would leave "cup" behind and break the longer phrase.
    const r = rules(entry("cup", [], ["of coffee", "cup of coffee"]))
    expect(findBannedWord("a cup of coffee", r)).toBeNull()
  })

  it("Hebrew: a word matches after the prefixes it can carry, never inside another word", () => {
    const r = rules(entry("דלי"))
    for (const text of ["דלי אדום", "והדלי נפל", "בדלי", "ושבדלי"]) expect(findBannedWord(text, r)).toBe("דלי")
    expect(findBannedWord("דליים רבים", r)).toBeNull()
    expect(findBannedWord("מדליון", r)).toBeNull()
  })

  it("Hebrew points and odd spacing do not hide a word", () => {
    expect(findBannedWord("דְּלִי   גדול", rules(entry("דלי")))).toBe("דלי")
  })

  it("Hebrew exceptions free their phrase, prefixes and all", () => {
    const r = rules(entry("דלי", [], ["דלי מים"]))
    expect(findBannedWord("דלי מים על השולחן", r)).toBeNull()
    expect(findBannedWord("ודלי מים על השולחן", r)).toBeNull()
    expect(findBannedWord("דלי מים ודלי", r)).toBe("דלי")
  })

  it("a banned phrase matches its words in a row", () => {
    const r = rules(entry("red bucket"))
    expect(findBannedWord("a big red bucket", r)).toBe("red bucket")
    expect(findBannedWord("a red and blue bucket", r)).toBeNull()
  })

  it("scripts written without spaces match inside the text", () => {
    expect(findBannedWord("赤いバケツを描いて", rules(entry("バケツ")))).toBe("バケツ")
    expect(findBannedWord("ถังน้ำสีแดง", rules(entry("ถัง")))).toBe("ถัง")
  })

  it("full-width letters read as their plain form", () => {
    expect(findBannedWord("a ＢＵＣＫＥＴ", rules(entry("bucket")))).toBe("bucket")
  })

  it("no rules, or no text, never matches", () => {
    expect(findBannedWord("bucket", rules())).toBeNull()
    expect(findBannedWord("   ", rules(entry("bucket")))).toBeNull()
  })

  it("invisible characters inside a word do not hide it", () => {
    const r = rules(entry("bucket"))
    for (const text of ["a buc\u200Bket", "a buc\u00ADket", "a buc\u200Dket", "a \u2066bucket\u2069"]) expect(findBannedWord(text, r)).toBe("bucket")
  })

  it("accents and vowel marks do not hide a word, in either direction", () => {
    expect(findBannedWord("a büçkét", rules(entry("bucket")))).toBe("bucket")
    expect(findBannedWord("a bucket", rules(entry("bückét")))).toBe("bucket")
    expect(findBannedWord("دَلْو كبير", rules(entry("دلو")))).toBe("دلو")
  })

  it("a look-alike letter from another script inside a Latin word reads as Latin", () => {
    expect(findBannedWord("a buсkеt", rules(entry("bucket")))).toBe("bucket") // Cyrillic с and е
    // A word wholly in Cyrillic is left alone: it matches only itself.
    expect(findBannedWord("ведро", rules(entry("ведро")))).toBe("ведро")
    expect(findBannedWord("cop", rules(entry("сор")))).toBeNull()
  })

  it("the Hebrew maqaf separates words, for words and for exceptions", () => {
    expect(findBannedWord("בית־דלי", rules(entry("דלי")))).toBe("דלי")
    expect(findBannedWord("בית־דלי", rules(entry("דלי", [], ["בית דלי"])))).toBeNull()
  })

  it("a word with no letters (an emoji) matches anywhere", () => {
    expect(findBannedWord("a red🪣bucket", rules(entry("🪣")))).toBe("🪣")
    expect(findBannedWord("a red bucket", rules(entry("🪣")))).toBeNull()
  })

  it("a Hebrew phrase matches with prefixes on its first word", () => {
    const r = rules(entry("דלי מים"))
    expect(findBannedWord("ודלי מים", r)).toBe("דלי מים")
    expect(findBannedWord("דלי ומים", r)).toBeNull()
  })

  it("a Korean word matches a word that starts with it, not one that ends with it", () => {
    const r = rules(entry("양동이"))
    expect(findBannedWord("양동이가 있다", r)).toBe("양동이")
    expect(findBannedWord("큰양동이", r)).toBeNull()
  })

  it("an exception frees whole words only, never the inside of another word", () => {
    const r = rules(entry("cup", [], ["tea cup"]))
    expect(findBannedWord("a tea cup", r)).toBeNull()
    expect(findBannedWord("a hottea cup", r)).toBe("cup")
    expect(findBannedWord("a tea cups and a cup", r)).toBe("cup")
  })

  it("a Korean exception frees its word with a particle after it", () => {
    const r = rules(entry("양동이", [], ["양동이 물"]))
    expect(findBannedWord("양동이 물이 차갑다", r)).toBeNull()
  })

  it("an exception in a script without spaces frees its place in the text", () => {
    const r = rules(entry("バケツ", [], ["バケツの水"]))
    expect(findBannedWord("赤いバケツの水", r)).toBeNull()
    expect(findBannedWord("バケツの水とバケツ", r)).toBe("バケツ")
  })

  it("checking a prompt costs about the same however long the list is", () => {
    // 500 words × 61 terms, the stored maximum, against 2,000 clean prompts.
    const words = Array.from({ length: 500 }, (_, w) =>
      entry(`word${w}`, Array.from({ length: 60 }, (_, t) => (t % 3 === 0 ? `ワード${w}x${t}` : t % 3 === 1 ? `two w${w} t${t}` : `t${w}x${t}`)), [`word${w} ok`]),
    )
    const r = compileGalleryWords(words)
    const prompt = "a quiet harbour at dawn, fishing boats, soft light, 35mm film, wide shot of the pier and the old lighthouse"
    const started = performance.now()
    for (let i = 0; i < 2000; i++) expect(findBannedWord(`${prompt} ${i}`, r)).toBeNull()
    // ~25 ms here with the lookup tables; checking every entry instead took ~900 ms.
    expect(performance.now() - started).toBeLessThan(300)
    expect(findBannedWord("now t499x59 here", r)).toBe("t499x59")
  })
})

describe("compileGalleryWords", () => {
  it("drops blanks and duplicates, in comparable form; an entry with no word left is dropped", () => {
    const compiled = compileGalleryWords([entry(" Bucket ", ["bucket", ""], ["  "]), entry("  ")])
    expect(compiled.entries).toEqual([{ terms: [{ kind: "word", text: "bucket" }], exceptions: [] }])
    expect([...compiled.byWord.entries()]).toEqual([["bucket", [0]]])
  })

  it("suggested exceptions are never applied", () => {
    const r = compileGalleryWords([{ word: "bucket", translations: [], exceptions: [], suggestedExceptions: ["a bucket of water"] }])
    expect(findBannedWord("a bucket of water", r)).toBe("bucket")
  })

  it("normalizeForFilter folds case, width, points and spaces", () => {
    expect(normalizeForFilter("  ＡＢ  c\nד֣ ")).toBe("ab c ד")
  })
})
