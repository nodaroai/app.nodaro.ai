import { describe, it, expect } from "vitest"

import { audioFromDirections, directionsFromAudio } from "../audio"

/**
 * The document's audio cues ↔ the `/` direction chips (spec D3, D5). The
 * document's `mode` IS the chip's `kind` — the recast script's own vocabulary,
 * plus studio's `tone` — so the map is a rename, not a translation, and
 * `voice` / `speaker` only ever mean something on `speech`.
 */
describe("directionsFromAudio / audioFromDirections", () => {
  it("maps the recast vocabulary onto chips and back, speech fields only on speech", () => {
    const layers = [
      { mode: "speech", content: "Run!", speaker: "Anna", voice: "urgent" },
      { mode: "sfx", content: "wind", speaker: "ignored" },
    ] as const
    const directions = directionsFromAudio(layers)
    expect(directions).toEqual([
      { kind: "speech", text: "Run!", speaker: "Anna", voice: "urgent" },
      { kind: "sfx", text: "wind" },
    ])
    expect(audioFromDirections(directions)).toEqual([
      { mode: "speech", content: "Run!", voice: "urgent", speaker: "Anna" },
      { mode: "sfx", content: "wind" },
    ])
    expect(audioFromDirections([])).toBeUndefined()
  })

  it("is the identity on absent input", () => {
    expect(directionsFromAudio(undefined)).toEqual([])
    expect(audioFromDirections(undefined)).toBeUndefined()
  })
})
