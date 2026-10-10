/**
 * The parameter pickers render section, group, topic and field names straight
 * from the @nodaro/prompts / @nodaro/shared catalogs, in English. The host
 * translates them through `localizePickerLabel` (the `picker` table, then
 * `option`). They showed in English in every language until the Korean docs
 * review listed them. Every registered locale must carry every one, so a new
 * catalog section cannot ship untranslated.
 */
import { describe, it, expect } from "vitest"
import * as prompts from "@nodaro/prompts"
import * as shared from "@nodaro/shared"
import { CHARACTER_FACETS, LOCATION_REFERENCE_PHOTO_KIND_LABELS, REFERENCE_ROLE_PRESETS, type LocaleId } from "@nodaro/shared"
import { LABEL_TABLES, localizePickerLabel } from "../labels"

/** Every exported `*_CATEGORY_LABELS` / `*_SUBCATEGORY_LABELS` / `*_DIMENSION_LABELS` map. */
function catalogLabelMaps(): ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> {
  return Object.entries({ ...prompts, ...shared }).filter(
    (entry): entry is [string, Readonly<Record<string, string>>] =>
      /(CATEGORY|SUBCATEGORY|DIMENSION)_LABELS$/.test(entry[0]) && typeof entry[1] === "object" && entry[1] !== null,
  )
}

const PICKER_SHOWN: ReadonlyArray<readonly [source: string, english: string]> = [
  ...catalogLabelMaps().flatMap(([name, map]) => Object.values(map).map((english) => [name, english] as const)),
  ...prompts.PERSON_DIMENSION_SECTIONS.map((s) => ["PERSON_DIMENSION_SECTIONS", s.label] as const),
  ...prompts.STYLING_DIMENSION_SECTIONS.map((s) => ["STYLING_DIMENSION_SECTIONS", s.label] as const),
  // Strings the picker-ui components hold themselves.
  ...[
    "Genre", "Subgenre", "Era", "Energy", "Emotion", "Vibe", "Instruments", "Production", "Vocal Presence",
    "Singing Style", "Age", "Gender", "Accent", "Timbre", "Language", "Pace", "Archetype", "Compact", "Detailed",
    "Subgenres work with a single genre", "Pick a genre above to see its subgenres", "Ref only", "Custom…",
    "Default (from character)", "Default (from location)", "pick up to {n}", "{section} (pick up to {n})",
  ].map((english) => ["picker-ui", english] as const),
]

/** Dropdown words the editor localizes through the option table. */
const OPTION_SHOWN: ReadonlyArray<string> = [
  ...CHARACTER_FACETS.map((f) => f.label),
  ...new Set(Object.values(REFERENCE_ROLE_PRESETS).flat()),
  ...Object.values(LOCATION_REFERENCE_PHOTO_KIND_LABELS),
]

const LOCALES = Object.keys(LABEL_TABLES) as LocaleId[]

describe("parameter picker interface labels", () => {
  it("covers every catalog section (a floor so a reshaped catalog fails loudly)", () => {
    expect(PICKER_SHOWN.length).toBeGreaterThanOrEqual(250)
  })

  // Present in a table, not "different from English": a translation can be
  // the English word itself.
  it.each(LOCALES)("%s translates every picker label", (locale) => {
    const t = LABEL_TABLES[locale]!
    const missing = PICKER_SHOWN.filter(([, english]) => !(english in t.picker) && !(english in t.option)).map(
      ([source, english]) => `${source}: ${english}`,
    )
    expect(missing, `${locale}: untranslated picker labels`).toEqual([])
  })

  it.each(LOCALES)("%s keeps the placeholders of the templated labels", (locale) => {
    expect(localizePickerLabel("pick up to {n}", locale)).toContain("{n}")
    const section = localizePickerLabel("{section} (pick up to {n})", locale)
    expect(section).toContain("{n}")
    expect(section).toContain("{section}")
  })

  it.each(LOCALES)("%s translates the facet, reference-role and photo-kind words", (locale) => {
    const option = LABEL_TABLES[locale]!.option
    expect(OPTION_SHOWN.filter((english) => !(english in option)), `${locale}: untranslated`).toEqual([])
  })

  it("Korean says 표정 and 형태 for the reference roles, not the code/drawing words", () => {
    expect(LABEL_TABLES.ko!.option.expression).toBe("표정")
    expect(LABEL_TABLES.ko!.option.shape).toBe("형태")
  })
})
