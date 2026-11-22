// @vitest-environment node
import { describe, it, expect } from "vitest"
import { en } from "../en"
import { es } from "../es"

/**
 * Spanish is a complete locale.
 *
 * The language menu offers it, so every interface string must exist in
 * Spanish: translate() falls back to English silently, and one missing key
 * would put an English sentence on a Spanish screen. The rest of this file is
 * the mechanical half of the Spanish style guide (frontend/CLAUDE.md, "Spanish
 * conventions"): the rules a reviewer should never have to point out twice.
 */

const PLACEHOLDER = /\{[^{}]*\}/g

/**
 * Sentences of three or more English words that stay English on purpose: a
 * product name, a code token, a spec line. Each was reviewed; a key that gains
 * Spanish must leave this list. (Shorter values that equal the English are
 * mostly words Spanish shares — Total, Normal, Video, Clip — and are not
 * checked.)
 */
const SAME_AS_EN: ReadonlySet<string> = new Set<string>([
  "audiocfg.providerIncrediblyFastWhisper",
  // A sample of what to type: the quoted words are the example itself.
  "cfgext.compTipQuotesExample",
  "pipe.cinemaCodec",
  "pipe.heading",
  // The Nodaro Video Upscale provider's name in the upscale menu: a product name.
  "vidcfg.nodaroUpscale",
])

/**
 * An article right before a {placeholder} assumes the gender (and number) of a
 * word the code supplies. Reviewed exceptions, each with a reason the
 * agreement is known:
 */
const ARTICLE_OK: ReadonlySet<string> = new Set<string>([
  // The workspace word's gender is known at run time: genderedWorkspaceKey
  // (ee/lib/org-vocabulary.ts) picks the base (feminine) or its …Masc form.
  "org.addToWorkspace",
  "org.addToWorkspaceMasc",
  // A noun after the placeholder fixes the gender: "los {changes} cambios", "las {total} claves".
  "speakerView.reason.noClockJump",
  "speakerView.note.panAll",
  "setup.oneClickClears",
  // A percentage: "el {pct}%" reads the same whatever the number.
  "mediaed.coverageLine",
  // The shots on the sheet (las tomas), feminine whatever their number: "Las {count}".
  "tut.ccvSheetEyebrow",
])

/**
 * Values whose ¿ ? or ¡ ! do not pair inside the one string, reviewed:
 */
const INVERTED_OK: ReadonlySet<string> = new Set<string>([
  // One question split across two keys around a link: ¿ opens in the first, ? closes in the second.
  "cli.signInPre",
  "cli.signInPost",
  // Code: ! and ? are operators of the syntax being described.
  "utilcfg.syntaxReferenceBody",
])

const dict = es as Record<string, string>
const entries = Object.entries(dict)
const placeholders = (s: string) => (s.match(PLACEHOLDER) ?? []).slice().sort().join("|")
const english = (k: string) => (en as Record<string, string>)[k] ?? ""
const prose = (s: string) => s.replace(PLACEHOLDER, "")
const count = (s: string, ch: string) => s.split(ch).length - 1

describe("Spanish dictionary", () => {
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
    for (const k of SAME_AS_EN) expect(dict[k], `${k} is Spanish now — drop it from SAME_AS_EN`).toBe(english(k))
  })

  it("carries nothing copied from the Hebrew, Japanese or Korean references", () => {
    // Hebrew letters, invisible direction marks, CJK and Hangul.
    const foreign = /[֐-׿‎‏‪-‮⁦-⁩　-ヿ㐀-鿿가-힣＀-￯]/
    // Reviewed: UGC Script's language choice names each language in itself ("עברית").
    const ENDONYM: ReadonlySet<string> = new Set(["ugc.script.languageHe"])
    const bad = entries.filter(([k, v]) => !ENDONYM.has(k) && foreign.test(prose(v)))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("uses Spanish typography: …, no straight quotes, and no space before ? ! : ;", () => {
    const spaceBefore = /[\p{L}\p{N})\]}”»] +[?!:;](?:\s|$)/u
    const bad = entries.filter(([k, v]) =>
      v.includes("...") ||
      (v.includes('"') && !english(k).includes('"')) ||
      (spaceBefore.test(v) && !spaceBefore.test(english(k))),
    )
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("opens every question with ¿ and every exclamation with ¡, in the same string", () => {
    // A joiner (" · ", "?") has no letter in its English: it is punctuation, not a sentence.
    const sentence = ([k]: [string, string]) => !INVERTED_OK.has(k) && /\p{L}/u.test(english(k))
    // A URL's ? opens its query string, not a question.
    const url = /\bhttps?:\/\/\S+/gu
    const unpaired = (v: string) => {
      const p = prose(v).replace(url, "")
      return count(p, "¿") !== count(p, "?") || count(p, "¡") !== count(p, "!")
    }
    const bad = entries.filter(sentence).filter(([, v]) => unpaired(v))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
    for (const k of INVERTED_OK) expect(unpaired(dict[k] ?? ""), `${k} pairs its marks now — drop it from INVERTED_OK`).toBe(true)
  })

  it("is Spanish, with nothing left of the Portuguese reference", () => {
    const portuguese = /[çãõÇÃÕ]|(?<!\p{L})(?:você|não)(?!\p{L})/iu
    const bad = entries.filter(([, v]) => portuguese.test(prose(v)))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("is neutral Spanish: tú, no vosotros, and the words both sides of the Atlantic read", () => {
    // ordenador / computadora → equipo or dispositivo; móvil / celular → teléfono; video, never vídeo.
    const regional = /(?<!\p{L})(?:ordenador(?:es)?|computadoras?|móvil(?:es)?|celulares?|vídeos?)(?!\p{L})/iu
    // usted and the vosotros forms: pronouns, possessives and the -áis / -éis verb endings.
    // (Case-sensitive past the first letter, so "OS", an operating system, is not "os".)
    const register = /(?<!\p{L})(?:[Uu]sted(?:es)?|[Vv]osotr[oa]s|[Vv]uestr[oa]s?|[Oo]s)(?!\p{L})|\p{L}(?:áis|éis)(?!\p{L})/u
    // Numbers whose spelling ends like a vosotros verb.
    const cardinal = /(?<!\p{L})(?:dieci|veinti)séis(?!\p{L})/giu
    const bad = entries.filter(([, v]) => {
      const p = prose(v).replace(cardinal, "")
      return regional.test(p) || register.test(p)
    })
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("never makes an article agree with a {placeholder} of unknown gender", () => {
    const article = /(?<!\p{L})(?:el|la|los|las|un|una|del|al) \{/iu
    const bad = entries.filter(([k, v]) => !ARTICLE_OK.has(k) && article.test(v))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
    for (const k of ARTICLE_OK) expect(article.test(dict[k] ?? ""), `${k} has no article before a placeholder now — drop it from ARTICLE_OK`).toBe(true)
  })

  it("never writes an (a)/(o) gender ending", () => {
    const ending = /\p{L}\((?:a|as|o|os)\)(?!\p{L})/u
    const bad = entries.filter(([, v]) => ending.test(v))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })
})
