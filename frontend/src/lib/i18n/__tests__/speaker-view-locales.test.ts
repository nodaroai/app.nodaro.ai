/**
 * Speaker View's panel strings ship in the five product locales (English,
 * Hebrew, Japanese, Korean, Brazilian Portuguese). The other dictionaries are
 * partial by design and fall back to English, and the coverage report is
 * non-failing, so nothing else would notice a missing key: this pins every
 * `speakerView.*` key present, non-empty, and carrying exactly the English
 * value's {placeholders} in the four translated dictionaries.
 */
import { describe, it, expect } from "vitest"
import { en, type ChromeDict, type MessageKey } from "../en"
import { he } from "../he"
import { ja } from "../ja"
import { ko } from "../ko"
import { ptBR } from "../pt-br"

const DICTS: Record<string, ChromeDict> = { he, ja, ko, "pt-BR": ptBR }
const KEYS = (Object.keys(en) as MessageKey[]).filter((k) => k.startsWith("speakerView."))
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe("Speaker View strings in every product locale", () => {
  it("is a real set of keys (a floor so a rename fails loudly)", () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(55)
    for (const k of ["speakerView.state.notRun", "speakerView.reason.noClockJump", "speakerView.framing.set", "speakerView.switch.crossfadeMore"] as const) expect(KEYS).toContain(k)
  })

  it.each(Object.keys(DICTS))("%s carries every key, with the English placeholders", (locale) => {
    const dict = DICTS[locale]!
    const missing = KEYS.filter((k) => !dict[k]?.trim())
    expect(missing, `${locale}: untranslated`).toEqual([])
    const drifted = KEYS.filter((k) => JSON.stringify(placeholders(dict[k]!)) !== JSON.stringify(placeholders(en[k])))
    expect(drifted, `${locale}: placeholders differ from English`).toEqual([])
  })
})

describe("the two switch reasons (decided 2026-10-08, full stop on Pan's added round 2)", () => {
  const PAN: Record<string, string> = {
    en: "No speaker change can pan here.",
    he: "אף החלפת דוברים לא יכולה לעשות פאן כאן.",
    ja: "ここでパンできる話者の切り替えはありません。",
    ko: "여기서 팬할 수 있는 화자 전환이 없습니다.",
    "pt-BR": "Nenhuma troca de falante pode fazer pan aqui.",
  }
  const ALL: Record<string, ChromeDict> = { en, ...DICTS }

  it.each(Object.keys(PAN))("%s words Pan's ruled-out reason as decided", (locale) => {
    expect(ALL[locale]!["speakerView.reason.noSameCamera"]).toBe(PAN[locale])
  })

  it("Pan's reason is not tied to a count any more", () => {
    for (const dict of Object.values(ALL)) expect(dict["speakerView.reason.noSameCamera"]).not.toContain("{changes}")
  })

  it.each(Object.keys(ALL))("%s has a Crossfade reason carrying the count", (locale) => {
    expect(ALL[locale]!["speakerView.reason.noClockJump"]).toContain("{changes}")
  })

  it("the retired \"applies to none\" note is gone: the greyed tile's reason replaces it", () => {
    for (const dict of Object.values(ALL)) expect(Object.keys(dict)).not.toContain("speakerView.note.crossfadeNone")
  })

  it("no Speaker View string offers a minimum-shot setting (decided 2026-10-08)", () => {
    for (const [locale, dict] of Object.entries(ALL)) {
      const offending = KEYS.filter((k) => /min(imum)?\.? shot|shortest shot/i.test(dict[k] ?? ""))
      expect(offending, locale).toEqual([])
    }
  })
})
