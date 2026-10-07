/**
 * The Lighting, Loop Subject and Color/Look pickers group their tiles under
 * section names from the @nodaro/prompts catalogs, written in English (Time of
 * Day, Realistic, Palette, …). The app localizes them through the option-label
 * tables. They showed in English in every language until the docs rebuild's
 * Japanese review found them. Every registered locale must carry every name,
 * so a new section cannot ship untranslated.
 */
import { describe, it, expect } from "vitest"
import { COLOR_LOOK_CATEGORY_LABELS, LIGHTING_CATEGORY_LABELS, LOOP_SUBJECT_CATEGORY_LABELS } from "@nodaro/prompts"
import type { LocaleId } from "@nodaro/shared"
import { LABEL_TABLES } from "../labels"

const SECTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  lighting: LIGHTING_CATEGORY_LABELS,
  "loop-subject": LOOP_SUBJECT_CATEGORY_LABELS,
  "color-look": COLOR_LOOK_CATEGORY_LABELS,
}

const SHOWN: ReadonlyArray<readonly [picker: string, english: string]> = Object.entries(SECTIONS).flatMap(
  ([picker, labels]) => Object.values(labels).map((english) => [picker, english] as const),
)

describe("Lighting, Loop Subject and Color/Look section names", () => {
  it("covers every section (a floor so a reshaped catalog fails loudly)", () => {
    expect(SHOWN.length).toBeGreaterThanOrEqual(10)
  })

  // Present in the table, not "different from English": a translation can be
  // the English word itself.
  it.each(Object.keys(LABEL_TABLES) as LocaleId[])("%s translates every one of them", (locale) => {
    const option = LABEL_TABLES[locale]?.option ?? {}
    const missing = SHOWN.filter(([, english]) => !(english in option)).map(([picker, english]) => `${picker}: ${english}`)
    expect(missing, `${locale}: untranslated picker section names`).toEqual([])
  })
})
