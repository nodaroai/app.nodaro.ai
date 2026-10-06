/**
 * The Character Studio reference sheet shows its presets ("Studio · Main",
 * "Studio · Extended", with a description each) and its add-on boards
 * (Expressions … Palette) from the @nodaro/shared catalog, written in English.
 * The app localizes them through the option-label tables. They showed in
 * English in every language until the docs rebuild's Japanese review found
 * them. Every registered locale must carry every string, so a new preset or
 * board cannot ship untranslated.
 */
import { describe, it, expect } from "vitest"
import { ALA_CARTE_BOARDS, SHEET_PRESETS, type LocaleId } from "@nodaro/shared"
import { LABEL_TABLES } from "../labels"

const SHOWN: readonly string[] = [
  ...SHEET_PRESETS.flatMap((p) => [p.label, p.description]),
  ...ALA_CARTE_BOARDS.map((b) => b.label),
]

describe("reference sheet preset and board strings", () => {
  it("covers every preset and board (a floor so a reshaped catalog fails loudly)", () => {
    expect(SHOWN.length).toBeGreaterThanOrEqual(9)
  })

  // Present in the table, not "different from English": a translation can be
  // the English word itself (Portuguese "Poses").
  it.each(Object.keys(LABEL_TABLES) as LocaleId[])("%s translates every one of them", (locale) => {
    const option = LABEL_TABLES[locale]?.option ?? {}
    const missing = SHOWN.filter((english) => !(english in option))
    expect(missing, `${locale}: untranslated reference sheet strings`).toEqual([])
  })
})
