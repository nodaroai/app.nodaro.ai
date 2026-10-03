import { describe, it, expect } from "vitest"
import { en } from "../en"
import { ko } from "../ko"

/**
 * Korean is a complete locale.
 *
 * The language menu offers it, so every interface string must exist in
 * Korean: translate() falls back to English silently, and one missing key
 * would put an English sentence on a Korean screen. The rest of this file is
 * the mechanical half of the Korean style guide (frontend/CLAUDE.md, "i18n —
 * Korean"): the rules a reviewer should never have to point out twice.
 */

/** Hangul syllables. */
const KO_LETTER = /[가-힣]/
const PLACEHOLDER = /\{[^{}]*\}/g

/**
 * Keys whose Korean is intentionally the English token: a brand, a model, a
 * unit or a code sample, with nothing to translate. Each was reviewed; a key
 * that gains Korean must leave this list.
 */
const LATIN_OK: ReadonlySet<string> = new Set<string>([
  // Brand, product, model and provider names, and their fixed product labels.
  "audiocfg.providerElevenLabsStt",
  "audiocfg.providerIncrediblyFastWhisper",
  "audiocfg.providerWhisper",
  "cfgext.igTitle",
  "cfgext.slideKenBurns",
  "editor.copilotName",
  "editor.copilotTabLabel",
  "editor.copilotTitle",
  "mcp.title",
  "misc.sourceApi",
  "misc.sourceCli",
  "misc.sourceMcp",
  "misc.sourceSdk",
  "node.mmaudioReplicate",
  "nodecat.AI",
  "overlayEditor.quick.linkedin",
  "overlayEditor.quick.youtube",
  "pipe.cinemaSpatialCopilot",
  // SNS is the Korean word for social media; SF is the Korean word for sci-fi.
  "cat.socialMedia",
  "integ.tabSocial",
  "scenecfg.opt.sciFi",
  // Units, formats, URLs, code and field names the user types verbatim.
  "apps.appUrlPrefix",
  "apps.previewMediaPlaceholder",
  "apps.url",
  "audiocfg.idPrefix",
  "competitors.phWebsite",
  "creature.urlPlaceholder",
  "credits.unitShort",
  "credits.unitShortLower",
  "creds.secretPh",
  "field.fps",
  "lib.triggerApi",
  "lib.triggerWebhook",
  "node.lottieJson",
  "out.json",
  "overlayEditor.addQr",
  "overlayEditor.tag.qr",
  "pipe.cinemaTimecode",
  "proccfg.overlay.formatJpg",
  "proccfg.overlay.formatWebp",
  "scene.gifLabel",
  "studioNav.lora",
  "tgacct.apiHash",
  "tgacct.apiId",
  "utilcfg.webhookUrl",
  "vidcfg.fps824",
  "vidcfg.youtubeUrl",
  // Numbers and counters: the tutorial number words render as digits.
  "copilot.runProgress",
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
])

const dict = ko as Record<string, string>
const entries = Object.entries(dict)
const placeholders = (s: string) => (s.match(PLACEHOLDER) ?? []).slice().sort().join("|")
const english = (k: string) => (en as Record<string, string>)[k] ?? ""

describe("Korean dictionary", () => {
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

  it("is written in Korean, apart from the reviewed brand and code tokens", () => {
    // English words outside the {placeholders} are what needs translating.
    const hasWords = (s: string) => /[A-Za-z]{2,}/.test(s.replace(PLACEHOLDER, ""))
    const latin = entries.filter(([k, v]) => !LATIN_OK.has(k) && hasWords(english(k)) && v !== "" && !KO_LETTER.test(v))
    expect(latin.map(([k, v]) => `${k}: ${v}`)).toEqual([])
    for (const k of LATIN_OK) expect(KO_LETTER.test(dict[k] ?? ""), `${k} is Korean now — drop it from LATIN_OK`).toBe(false)
  })

  it("uses Western punctuation, never the Japanese or Chinese full-width forms", () => {
    // Korean writes . , ? ! : and ( ); 。、「」（）： and kana are Japanese.
    const cjk = /[。、「」『』（）：？！，；【】〜]|[ぁ-ゖァ-ヺ]/
    const bad = entries.filter(([, v]) => cjk.test(v.replace(PLACEHOLDER, "")))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("has no space before . , ? or ! and uses the one-character ellipsis", () => {
    const bad = entries.filter(([, v]) => /[가-힣A-Za-z0-9)}\]] +[.,?!](?:\s|$)/.test(v) || v.includes("..."))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("writes a particle after a {placeholder} in its paired form", () => {
    // The word a placeholder renders is unknown, so its final consonant is
    // too: 은(는), 이(가), 을(를), 와(과), (으)로 read right either way.
    const bare = /\}(은|는|이|가|을|를|와|과|으로|로|이라는|라는)(?![(가-힣])/
    const bad = entries.filter(([, v]) => bare.test(v))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("attaches a counter to its number", () => {
    const spaced = /\{[A-Za-z0-9_]+\} (개|장|회|명|초|분|시간|자|건|단어)(?![가-힣])/
    const bad = entries.filter(([, v]) => spaced.test(v))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })
})
