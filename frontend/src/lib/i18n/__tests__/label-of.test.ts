import { describe, it, expect } from "vitest"
import { labelOf, translate, type MessageKey, type TFunction } from ".."

/**
 * labelOf turns a stored id into its label, and shows an id the table does not
 * know as written — a value from an older or newer plan must not crash a
 * preview or show an empty line.
 */
const LABELS: Readonly<Record<"fade" | "none", MessageKey>> = { fade: "preview.exitFade", none: "preview.exitNone" }
const pt: TFunction = (key, vars) => translate("pt-BR", key, vars)

describe("labelOf", () => {
  it("gives the label of a known id in the interface language", () => {
    expect(labelOf(LABELS, "fade", pt)).toBe(translate("pt-BR", "preview.exitFade"))
    expect(labelOf(LABELS, "none", pt)).toBe("Nenhuma")
  })

  it("shows an unknown id as written", () => {
    expect(labelOf(LABELS, "spiral-out", pt)).toBe("spiral-out")
  })

  it("does not read inherited properties as ids", () => {
    expect(labelOf(LABELS, "toString", pt)).toBe("toString")
  })
})
