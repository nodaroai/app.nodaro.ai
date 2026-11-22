// @vitest-environment node
import { describe, it, expect } from "vitest"
import { en } from "../en"
import { de } from "../de"

/**
 * German is a complete locale.
 *
 * The language menu offers it, so every interface string must exist in
 * German: translate() falls back to English silently, and one missing key
 * would put an English sentence on a German screen. The rest of this file is
 * the mechanical half of the German style guide (frontend/CLAUDE.md, "German
 * conventions"): the rules a reviewer should never have to point out twice.
 */

const PLACEHOLDER = /\{[^{}]*\}/g

/**
 * Placeholders that always render a number or a date: an article before one
 * does not assume the gender or case of a word the code supplies.
 */
const NUMERIC = /^\{(n|count|total|max|min|num|number|done|remaining|used|limit|left|current|index|seconds|secs|minutes|mins|hours|days|percent|pct|credits|amount|size|width|height|fps|duration|time|cost|price|balance|rows|items|files|steps|shots|clips|frames|scenes|date|day|when|month|year|start|end|from|to|deadline|resetAt|expires|until)\}$/i

/**
 * Sentences of three or more English words that stay English on purpose: a
 * product name, a code token, a spec line. Each was reviewed; a key that gains
 * German must leave this list. (Shorter values that equal the English are
 * mostly words German shares — Total, Normal, Video, Clip — and are not
 * checked.)
 */
const SAME_AS_EN: ReadonlySet<string> = new Set<string>([
  // Product and model names, a codec line and a spec line: the words are the names.
  "vidcfg.nodaroUpscale",
  "cfgext.genAutoSonnet",
  "audiocfg.providerIncrediblyFastWhisper",
  "pipe.heading",
  "pipe.cinemaCodec",
  "pipe.cinemaSpatialCopilot",
  // Identical to the English today and waiting for German wording (platform needs-translation list); drop each once it is German.
  "addnode.catDescWorkflow",
])

/**
 * Keys whose German keeps a character or a pattern the rules below forbid,
 * each reviewed with its reason.
 */
const ARTICLE_OK: ReadonlySet<string> = new Set<string>([
  // {changes} is a count ("keinem der {changes} Sprecherwechsel" reads the same whatever the number).
  "speakerView.reason.noClockJump",
])
const SPACE_PUNCT_OK: ReadonlySet<string> = new Set<string>([])
const QUOTE_OK: ReadonlySet<string> = new Set<string>([
  // Closes a „…“ quote opened in its Pre fragment (the link text sits between the two keys).
  "audiocfg.svClickPost",
])
const SIE_DU_OK: ReadonlySet<string> = new Set<string>([])

const dict = de as Record<string, string>
const entries = Object.entries(dict)
const placeholders = (s: string) => (s.match(PLACEHOLDER) ?? []).slice().sort().join("|")
const english = (k: string) => (en as Record<string, string>)[k] ?? ""
const prose = (s: string) => s.replace(PLACEHOLDER, "").replace(/https?:\/\/\S+/g, "")

/** A match that is not at the start of the string and not right after . ! ? : a newline or an opening quote. */
const midSentence = (re: RegExp) => (v: string) => {
  const p = prose(v)
  for (const m of p.matchAll(re)) {
    const before = p.slice(0, m.index).trimEnd()
    if (before && !/[.!?:\n„“"]$/.test(before)) return true
  }
  return false
}
const formalSie = midSentence(/(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/gu)
const capitalDu = midSentence(/(?<!\p{L})(Du|Dein|Deine|Deinen|Deinem|Deiner|Deines|Dich|Dir)(?!\p{L})/gu)

const hasArticleBeforePlaceholder = (v: string) => {
  const re = /(?<!\p{L})(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|dieser|diese|dieses|diesen|diesem|zum|zur|im|vom|beim|am|ins) (\{[^{}]*\})/giu
  for (const m of v.matchAll(re)) if (!NUMERIC.test(m[2])) return true
  return false
}

describe("German dictionary", () => {
  it("translates every en key", () => {
    const missing = Object.keys(en).filter((k) => !(k in dict))
    expect(missing.length, `untranslated keys, e.g. ${missing.slice(0, 20).join(", ")}`).toBe(0)
  })

  it("has no key that en does not", () => {
    const orphans = Object.keys(dict).filter((k) => !(k in en))
    expect(orphans).toEqual([])
  })

  it("keeps every {placeholder} of the English", () => {
    const bad = entries.filter(([k, v]) => placeholders(v) !== placeholders(english(k)))
    expect(bad.map(([k]) => k)).toEqual([])
  })

  it("leaves no English sentence untranslated, apart from the reviewed names", () => {
    const words = (s: string) => (prose(s).match(/[A-Za-z]{2,}/g) ?? []).length
    const same = entries.filter(([k, v]) => !SAME_AS_EN.has(k) && words(english(k)) >= 3 && v === english(k))
    expect(same.map(([k, v]) => `${k}: ${v}`)).toEqual([])
    for (const k of SAME_AS_EN) expect(dict[k], `${k} is German now — drop it from SAME_AS_EN`).toBe(english(k))
  })

  it("carries nothing copied from the Hebrew, Japanese or Korean references", () => {
    // Hebrew letters, invisible direction marks, CJK and Hangul.
    const foreign = /[֐-׿‎‏‪-‮⁦-⁩　-ヿ㐀-鿿가-힣＀-￯]/
    // Reviewed: UGC Script's language choice names each language in itself ("עברית").
    const ENDONYM: ReadonlySet<string> = new Set(["ugc.script.languageHe"])
    const bad = entries.filter(([k, v]) => !ENDONYM.has(k) && foreign.test(prose(v)))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("is German, with nothing left of the Spanish or Portuguese references", () => {
    const romance = /[çãõñÇÃÕÑ¿¡«»]/
    const bad = entries.filter(([, v]) => romance.test(prose(v)))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("uses German typography: …, no three dots, no straight quotes, and no space before ? ! : ;", () => {
    const spaceBefore = /[\p{L}\p{N})\]}“] +[?!:;](?:\s|$)/u
    const bad = entries.filter(([k, v]) =>
      v.includes("...") ||
      (v.includes('"') && !english(k).includes('"')) ||
      (!SPACE_PUNCT_OK.has(k) && spaceBefore.test(v) && !spaceBefore.test(english(k))),
    )
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
    for (const k of SPACE_PUNCT_OK) expect(spaceBefore.test(dict[k] ?? ""), `${k} has no space before the mark now — drop it from SPACE_PUNCT_OK`).toBe(true)
  })

  it("quotes with „…“, never with “…” alone", () => {
    const bad = entries.filter(([k, v]) => !QUOTE_OK.has(k) && /“/.test(v) && !/„/.test(v))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
    for (const k of QUOTE_OK) expect(/“/.test(dict[k] ?? "") && !/„/.test(dict[k] ?? ""), `${k} is quoted „…“ now — drop it from QUOTE_OK`).toBe(true)
  })

  it("addresses the reader as du: no formal Sie / Ihr, and du / dein in lower case inside a sentence", () => {
    const bad = entries.filter(([k, v]) => !SIE_DU_OK.has(k) && (formalSie(v) || capitalDu(v)))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
    for (const k of SIE_DU_OK) expect(formalSie(dict[k] ?? "") || capitalDu(dict[k] ?? ""), `${k} is du now — drop it from SIE_DU_OK`).toBe(true)
  })

  it("never puts an article or a contraction right before a {placeholder} of unknown gender and case", () => {
    const bad = entries.filter(([k, v]) => !ARTICLE_OK.has(k) && hasArticleBeforePlaceholder(v))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
    for (const k of ARTICLE_OK) expect(hasArticleBeforePlaceholder(dict[k] ?? ""), `${k} has no article before a placeholder now — drop it from ARTICLE_OK`).toBe(true)
  })

  it("never attaches a suffix to a {placeholder}", () => {
    const bad = entries.filter(([, v]) => /\{[^{}]*\}(?:s|es|-\p{L})/u.test(v))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })
})
