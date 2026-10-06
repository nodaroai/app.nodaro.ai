/**
 * The Transition picker's category tabs and the transition panel's per-row
 * options (a wipe's Direction, a styled row's Style: the option names, their
 * choices and the choices' tooltips) come from the catalog in @nodaro/prompts,
 * written in English. The app localizes them through the option-label tables.
 * They showed in English in every language until the docs rebuild's Japanese
 * and Portuguese review found them. Every registered locale must carry every
 * string, so a new category, option or choice cannot ship untranslated.
 */
import { describe, it, expect } from "vitest"
import { TRANSITIONS, TRANSITION_CATEGORY_LABELS } from "@nodaro/prompts"
import type { LocaleId } from "@nodaro/shared"
import { LABEL_TABLES, localizeOptionLabel } from "../labels"

/** `rowStyle` names a styled row's default look "<choice> (default)". */
const DEFAULT_LOOK = / \(default\)$/

const OPTIONS = TRANSITIONS.flatMap((t) => t.options ?? [])
const CHOICES = OPTIONS.flatMap((o) => o.choices)

const SHOWN: readonly string[] = [
  ...new Set([
    ...Object.values(TRANSITION_CATEGORY_LABELS),
    ...OPTIONS.map((o) => o.label),
    ...CHOICES.map((c) => c.label.replace(DEFAULT_LOOK, "")),
    ...CHOICES.map((c) => c.description),
  ]),
]

const LOCALES = Object.keys(LABEL_TABLES) as LocaleId[]

describe("Transition picker and transition option strings", () => {
  it("covers every tab, option, choice and tooltip (a floor so a reshaped catalog fails loudly)", () => {
    expect(SHOWN.length).toBeGreaterThan(40)
    expect(CHOICES.some((c) => DEFAULT_LOOK.test(c.label))).toBe(true)
  })

  // Present in the table, not "different from English": a translation can be
  // the English word itself.
  it.each(LOCALES)("%s translates every one of them", (locale) => {
    const option = LABEL_TABLES[locale]?.option ?? {}
    const missing = SHOWN.filter((english) => !(english in option))
    expect(missing, `${locale}: untranslated transition strings`).toEqual([])
  })

  it.each(LOCALES)("%s names a style's default look in its own words, qualifier included", (locale) => {
    const option = LABEL_TABLES[locale]?.option ?? {}
    for (const label of CHOICES.map((c) => c.label).filter((l) => DEFAULT_LOOK.test(l))) {
      const shown = localizeOptionLabel(label, locale)
      expect(shown, label).toContain(option[label.replace(DEFAULT_LOOK, "")])
      expect(shown, label).not.toMatch(/default/i)
    }
  })
})
