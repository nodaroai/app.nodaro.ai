import { describe, it, expect } from "vitest"
import { en } from "../en"
import { ptBR } from "../pt-br"

/**
 * Brazilian Portuguese is a complete locale.
 *
 * The language menu offers it, so every interface string must exist in
 * Portuguese: translate() falls back to English silently, and one missing key
 * would put an English sentence on a Portuguese screen. The rest of this file
 * is the mechanical half of the Portuguese style guide (frontend/CLAUDE.md,
 * "Brazilian Portuguese conventions"): the rules a reviewer should never have
 * to point out twice.
 */

const PLACEHOLDER = /\{[^{}]*\}/g

/**
 * Sentences of three or more English words that stay English on purpose: a
 * product name, a code token, a spec line. Each was reviewed; a key that gains
 * Portuguese must leave this list. (Shorter values that equal the English are
 * mostly words Portuguese shares — Total, Normal, Animal, Workflow — and are
 * not checked.)
 */
const SAME_AS_EN: ReadonlySet<string> = new Set<string>([
  "audiocfg.providerIncrediblyFastWhisper",
  "integ.viaEnvKey",
  "pipe.cinemaCodec",
  "pipe.heading",
])

/**
 * A contracted article before a {placeholder} assumes the gender of a word the
 * code supplies. Reviewed exceptions, each with a noun that fixes the gender
 * after the placeholder or a word whose gender is a convention:
 */
const CONTRACTED_OK: ReadonlySet<string> = new Set<string>([
  "integ.clearsMissingKeys",        // "{n} das {total} chaves": chaves fixes it
  "setup.oneClickClears",           // same
  // The workspace word's gender is known at run time: genderedWorkspaceKey
  // (ee/lib/org-vocabulary.ts) picks the base (feminine) or its …Masc form.
  "org.workspaceNamePlaceholder",
  "org.workspaceNamePlaceholderMasc",
])

const dict = ptBR as Record<string, string>
const entries = Object.entries(dict)
const placeholders = (s: string) => (s.match(PLACEHOLDER) ?? []).slice().sort().join("|")
const english = (k: string) => (en as Record<string, string>)[k] ?? ""

describe("Brazilian Portuguese dictionary", () => {
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
    const words = (s: string) => (s.replace(PLACEHOLDER, "").match(/[A-Za-z]{2,}/g) ?? []).length
    const same = entries.filter(([k, v]) => !SAME_AS_EN.has(k) && words(english(k)) >= 3 && v === english(k))
    expect(same.map(([k, v]) => `${k}: ${v}`)).toEqual([])
    for (const k of SAME_AS_EN) expect(dict[k], `${k} is Portuguese now — drop it from SAME_AS_EN`).toBe(english(k))
  })

  it("carries nothing copied from the Hebrew, Japanese or Korean references", () => {
    // Hebrew letters, invisible direction marks, CJK and Hangul.
    const foreign = /[֐-׿‎‏‪-‮⁦-⁩　-ヿ㐀-鿿가-힣＀-￯]/
    const bad = entries.filter(([, v]) => foreign.test(v.replace(PLACEHOLDER, "")))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("uses Brazilian typography: …, “ ”, and no space before ? ! : ;", () => {
    const spaceBefore = /[\p{L}\p{N})\]}”] +[?!:;](?:\s|$)/u
    const bad = entries.filter(([k, v]) =>
      v.includes("...") ||
      (v.includes('"') && !english(k).includes('"')) ||
      (spaceBefore.test(v) && !spaceBefore.test(english(k))),
    )
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("is Brazilian, never European Portuguese", () => {
    const ptPT = /(?<!\p{L})(ficheiros?|ecrãs?|utilizador(?:es|as?)?|telemóve(?:l|is)|definições|palavras?-passe|registos?|equipas?|partilh\p{L}*|aceder|contactos?|secç(?:ão|ões)|subscriç(?:ão|ões)|actua(?:l|is|liz\p{L}*)|acç(?:ão|ões)|activ\p{L}*|est(?:á|ão|ou|amos|ava) a \p{L}+(?:ar|er|ir))(?!\p{L})/iu
    const bad = entries.filter(([, v]) => ptPT.test(v.replace(PLACEHOLDER, "")))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("never makes an article agree with a {placeholder} of unknown gender", () => {
    const contracted = /(?<!\p{L})(do|da|dos|das|no|na|nos|nas|pelo|pela|pelos|pelas|ao|aos|à|às) \{/iu
    // A clock time always takes "às" (às 15h), so "às {time}" is right.
    const clockTime = /(?<!\p{L})às \{time\}/giu
    const bad = entries.filter(([k, v]) => !CONTRACTED_OK.has(k) && contracted.test(v.replace(clockTime, "")))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it("never writes an (a)/(o) gender ending", () => {
    const ending = /\p{L}\((?:a|as|o|os)\)(?!\p{L})/u
    const bad = entries.filter(([, v]) => ending.test(v))
    expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })
})
