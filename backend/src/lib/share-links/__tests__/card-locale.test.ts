/**
 * The share card's language (card-locale.ts): the card has its own words in
 * exactly the platform's interface languages (the editor's list), every id a
 * link may store fits the column's CHECK (migration 689), and an id a client
 * sends is read leniently.
 */
// @test-watches frontend/src/lib/i18n/platform-languages.ts supabase/migrations/689_share_link_locale.sql
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { LANGUAGES } from "@nodaro/shared/i18n"
import { CARD_WORDS, SHARE_CARD_LOCALES, cardLocaleOf, normalizeShareLocale } from "../card-locale.js"
import { SHARE_WORK_KINDS } from "../tool-names.js"

const root = new URL("../../../../../", import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, root), "utf8")

describe("the card's languages", () => {
  it("are exactly the platform's interface languages", () => {
    const src = read("frontend/src/lib/i18n/platform-languages.ts")
    const list = /PLATFORM_LANGUAGES[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/.exec(src)?.[1]
    expect(list, "PLATFORM_LANGUAGES not found").toBeDefined()
    const platform = [...list!.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect([...SHARE_CARD_LOCALES].sort()).toEqual(platform.sort())
  })

  it("each has every line", () => {
    for (const locale of SHARE_CARD_LOCALES) {
      const words = CARD_WORDS[locale]
      for (const work of SHARE_WORK_KINDS) expect(words.made[work], `${locale} ${work}`).toMatch(/Nodaro/)
      expect(words.trend, locale).toContain("{trend}")
      expect(words.results(3), locale).toContain("3")
      expect(words.sessions(3), locale).toContain("3")
    }
  })

  it("every id a link may store fits the column's CHECK", () => {
    const check = /locale ~ '([^']+)'/.exec(read("supabase/migrations/689_share_link_locale.sql"))?.[1]
    expect(check).toBeDefined()
    const re = new RegExp(check!)
    for (const { id } of LANGUAGES) {
      const stored = normalizeShareLocale(id)
      expect(stored, id).toBe(id)
      expect(re.test(stored!), id).toBe(true)
    }
    for (const sent of ["he-IL", "pt", "PT_br", "de-AT", "iw", "zh-Hant-TW", "es-419", "EN"]) {
      const stored = normalizeShareLocale(sent)
      expect(stored, sent).not.toBeNull()
      expect(re.test(stored!), sent).toBe(true)
    }
  })

  it("reads a sent id leniently", () => {
    expect(normalizeShareLocale("he-IL")).toBe("he")
    expect(normalizeShareLocale("pt_br")).toBe("pt-BR")
    expect(normalizeShareLocale("es-419")).toBe("es")
    for (const bad of [undefined, null, 42, "", "xx", "x".repeat(100), "../../etc"]) expect(normalizeShareLocale(bad), String(bad)).toBeNull()
    // A language the platform names but the card has no words in reads in English.
    expect(cardLocaleOf("fr")).toBe("en")
    expect(cardLocaleOf("he")).toBe("he")
    expect(cardLocaleOf(null)).toBe("en")
  })
})
