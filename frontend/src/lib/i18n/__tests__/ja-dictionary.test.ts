import { describe, it, expect } from "vitest"
import { en } from "../en"
import { ja } from "../ja"

/**
 * Japanese is a complete locale.
 *
 * The language menu offers it, so every interface string must exist in
 * Japanese: translate() falls back to English silently, and one missing key
 * would put an English sentence on a Japanese screen. The rest of this file is
 * the mechanical half of the Japanese style guide (frontend/CLAUDE.md, "i18n —
 * Japanese"): the rules a reviewer should never have to point out twice.
 */

/** Japanese letters: kana (with ー) and kanji. Excludes punctuation such as ・「」. */
const JA_LETTER = /[ぁ-ゖァ-ヺー㐀-䶿一-鿿]/
const PLACEHOLDER = /\{[^{}]*\}/g

/**
 * Keys whose Japanese is intentionally the English token: a brand, a model, a
 * unit or a code sample, with nothing to translate. Each was reviewed; a key
 * that gains Japanese must leave this list.
 */
const LATIN_OK: ReadonlySet<string> = new Set<string>([
  // Brand, model, product and unit names, URLs and code samples; the
  // tutorial number words render as digits.
  "apps.appUrlPrefix",
  "apps.previewMediaPlaceholder",
  "apps.url",
  "audiocfg.idPrefix",
  "audiocfg.providerElevenLabsStt",
  "audiocfg.providerIncrediblyFastWhisper",
  "audiocfg.providerWhisper",
  "cfgext.igTitle",
  "cfgext.slideKenBurns",
  "common.ok",
  "copilot.ceilingSuffix",
  "copilot.runProgress",
  "creature.urlPlaceholder",
  "credits.unitShort",
  "credits.unitShortLower",
  "creds.secretPh",
  "dash.varSampleResolved",
  "editor.copilotName",
  "editor.copilotTabLabel",
  "editor.copilotTitle",
  "field.fps",
  "integ.tabSocial",
  "lib.triggerWebhook",
  "mcp.title",
  "misc.sourceApi",
  "misc.sourceCli",
  "misc.sourceMcp",
  "misc.sourceSdk",
  "misc.sourceWeb",
  "node.locCatSciFi",
  "node.lottieJson",
  "node.mmaudioReplicate",
  "nodecat.AI",
  "out.json",
  "overlayEditor.addQr",
  "overlayEditor.quick.linkedin",
  "overlayEditor.quick.youtube",
  "overlayEditor.tag.qr",
  "pipe.cinemaShotAbbrev",
  "pipe.cinemaSpatialCopilot",
  "pipe.cinemaTimecode",
  "proccfg.overlay.formatJpg",
  "proccfg.overlay.formatWebp",
  "project.studioBadge",
  "scene.gifLabel",
  "scenecfg.opt.sciFi",
  "tgacct.apiHash",
  "tgacct.apiId",
  "tut.countEight",
  "tut.countEleven",
  "tut.countFive",
  "tut.countFour",
  "tut.countNine",
  "tut.countOne",
  "tut.countSeven",
  "tut.countSix",
  "tut.countTen",
  "tut.countThree",
  "tut.countTwelve",
  "tut.countTwo",
  "tut.countZero",
  "tut.ofTotal",
  "utilcfg.webhookUrl",
])

const dict = ja as Record<string, string>
const entries = Object.entries(dict)
const placeholders = (s: string) => (s.match(PLACEHOLDER) ?? []).slice().sort().join("|")

describe("Japanese dictionary", () => {
  it("translates every en key", () => {
    const missing = Object.keys(en).filter((k) => !(k in dict))
    expect(missing.length, `untranslated keys, e.g. ${missing.slice(0, 20).join(", ")}`).toBe(0)
  })

  it("has no key that en does not", () => {
    const orphans = Object.keys(dict).filter((k) => !(k in en))
    expect(orphans).toEqual([])
  })

  it("keeps every {placeholder} of the English", () => {
    const bad = entries.filter(([k, v]) => placeholders(v) !== placeholders((en as Record<string, string>)[k] ?? ""))
    expect(bad.map(([k]) => k)).toEqual([])
  })

  it("is written in Japanese, apart from the reviewed brand and code tokens", () => {
    // English words outside the {placeholders} are what needs translating.
    const hasWords = (s: string) => /[A-Za-z]{2,}/.test(s.replace(PLACEHOLDER, ""))
    const latin = entries.filter(
      ([k, v]) => !LATIN_OK.has(k) && hasWords((en as Record<string, string>)[k] ?? "") && v !== "" && !JA_LETTER.test(v),
    )
    expect(latin.map(([k, v]) => `${k}: ${v}`)).toEqual([])
    for (const k of LATIN_OK) expect(JA_LETTER.test(dict[k] ?? ""), `${k} is Japanese now — drop it from LATIN_OK`).toBe(false)
  })

  it("uses full-width punctuation after Japanese text", () => {
    // 、。：？！ and （）, not their ASCII forms, next to a Japanese letter.
    const ascii = new RegExp(`${JA_LETTER.source}[,.:?!](?=\\s|$)|${JA_LETTER.source}\\)|\\(${JA_LETTER.source}`)
    const bad = entries.filter(([, v]) => ascii.test(v))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("has no space before 、 or 。 and uses the one-character ellipsis", () => {
    const bad = entries.filter(([, v]) => / [、。]/.test(v) || v.includes("..."))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  // Spacing around a {placeholder} is deliberately NOT checked. It depends on
  // what the placeholder renders: "{n} 件" has a space before a number, while
  // "{time}に更新" has none because the formatted date is Japanese. A test
  // can't see which case applies.
})
