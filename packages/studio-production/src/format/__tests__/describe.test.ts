import { describe, it, expect } from "vitest"

import { describeFilmLook } from "../describe"
import { buildFormatRegistry } from "../registry"

/**
 * The preview's one-line-per-chip film summary ("Camera: ARRI Alexa · Art
 * style: Anime…") — the FILM strip's own chip order and labels (registry
 * §4), never a hardcoded catalog string, so an id the catalog doesn't know
 * still prints (as itself) rather than vanishing.
 */
describe("describeFilmLook", () => {
  const REGISTRY = buildFormatRegistry()
  const labelOf = (key: string, id: string) =>
    REGISTRY.pickers.find((p) => p.key === key)!.options.find((o) => o.id === id)!.label

  it("names each film chip with the catalog label, in strip order", () => {
    const style = REGISTRY.pickers.find((p) => p.key === "styleId")!.options[0].id
    const camera = REGISTRY.pickers.find((p) => p.key === "cameraFormatId")!.options[0].id
    expect(describeFilmLook({ styleId: style, cameraFormatId: camera })).toEqual([
      `Camera: ${labelOf("cameraFormatId", camera)}`,
      `Art style: ${labelOf("styleId", style)}`,
    ])
  })

  it("ignores non-film keys and prints an unknown id as itself", () => {
    expect(describeFilmLook({ moodId: "tense", eraId: "nope" })).toEqual(["Period: nope"])
    expect(describeFilmLook(undefined)).toEqual([])
  })
})
