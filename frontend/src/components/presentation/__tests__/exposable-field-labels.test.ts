import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { en } from "@/lib/i18n/en"
import { translate } from "@/lib/i18n"
import { EXPOSABLE_FIELD_LABEL_KEYS, localizeExposableFieldLabel } from "../exposable-field-labels"

/**
 * A field exposed on a published app renders its node definition's English
 * `ExposableField.label`. Unmapped, it shows English on a translated app; and a
 * mapped key whose English differs from the label would change the English
 * card. Both are checked here.
 */
describe("exposable field labels", () => {
  it("every node definition's exposable field label has a dictionary key", () => {
    const labels = new Set(NODE_DEFINITIONS.flatMap((d) => (d.exposableFields ?? []).map((f) => f.label)))
    // Floor so a reshaped NODE_DEFINITIONS fails loudly instead of passing for free.
    expect(labels.size).toBeGreaterThan(15)
    const missing = [...labels].filter((l) => !(l in EXPOSABLE_FIELD_LABEL_KEYS))
    expect(missing, "exposable field labels with no dictionary key").toEqual([])
  })

  it("keeps English byte-identical: each key's English is the label it replaces", () => {
    const drift = Object.entries(EXPOSABLE_FIELD_LABEL_KEYS)
      .filter(([label, key]) => en[key] !== label)
      .map(([label, key]) => `${key} = ${JSON.stringify(en[key])} (label ${JSON.stringify(label)})`)
    expect(drift).toEqual([])
  })

  it("translates a known label and passes a derived one through", () => {
    const he = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("he", key, vars)
    expect(localizeExposableFieldLabel("Aspect Ratio", he)).toBe(translate("he", "field.aspectRatio"))
    expect(localizeExposableFieldLabel("Title Text", he)).toBe("Title Text")
  })
})
