/**
 * The Combine Videos transition picker renders English tiles, tabs and
 * captions (its catalog lives in @nodaro/shared), and the app localizes them
 * through the option-label tables. They stayed English in every language
 * until the docs rebuild's Japanese review found them. Every registered
 * locale must carry every string the picker shows, so a new transition or tab
 * cannot ship untranslated.
 */
import { describe, it, expect } from "vitest"
import { COMBINE_TRANSITIONS, COMBINE_TRANSITION_GROUP_LABELS } from "@nodaro/shared"
import { COMBINE_TRANSITION_PICKER_CAPTIONS } from "@/lib/picker-ui"
import { LABEL_TABLES } from "../labels"
import type { LocaleId } from "@nodaro/shared"

const SHOWN: readonly string[] = [
  ...COMBINE_TRANSITIONS.map((t) => t.label),
  ...Object.values(COMBINE_TRANSITION_GROUP_LABELS),
  ...COMBINE_TRANSITION_PICKER_CAPTIONS,
]

describe("Combine Videos transition picker strings", () => {
  it("covers every tile, tab and caption (a floor so a reshaped catalog fails loudly)", () => {
    expect(SHOWN.length).toBeGreaterThan(60)
  })

  // Present in the table, not "different from English": a translation can be
  // the English word itself (Brazilian editors say "Fade").
  it.each(Object.keys(LABEL_TABLES) as LocaleId[])("%s translates every one of them", (locale) => {
    const option = LABEL_TABLES[locale]?.option ?? {}
    const missing = SHOWN.filter((english) => !(english in option))
    expect(missing, `${locale}: untranslated transition picker strings`).toEqual([])
  })
})
