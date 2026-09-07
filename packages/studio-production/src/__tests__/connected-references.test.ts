import { describe, it, expect } from "vitest"

import { readReferences } from "../connected-references"

/**
 * The persisted blob is untrusted (a canvas-edited workflow, an imported file),
 * and the chips it rebuilds are handed straight to the composer. The rule:
 * the three identity fields are required, everything else rides along verbatim,
 * and nothing survivable is invented.
 */
describe("readReferences", () => {
  it("keeps the rich fields verbatim and re-pins the identity", () => {
    expect(
      readReferences([
        {
          id: "c1",
          defaultName: "Natalie",
          source: "wired-character",
          url: "https://r2.example/natalie.png",
          characterSlug: "natalie",
          variantSlug: "smile",
        },
      ]),
    ).toEqual([
      {
        id: "c1",
        defaultName: "Natalie",
        source: "wired-character",
        url: "https://r2.example/natalie.png",
        characterSlug: "natalie",
        variantSlug: "smile",
      },
    ])
  })

  it("defaults a missing url so a portrait-less chip still rebuilds", () => {
    const refs = readReferences([
      { id: "c1", defaultName: "Natalie", source: "wired-character" },
    ])
    expect(refs?.[0].url).toBe("")
  })

  it("drops an entry missing a core identity field", () => {
    expect(
      readReferences([
        { id: "c1", defaultName: "Natalie", source: "wired-character", url: "" },
        { defaultName: "Nobody", source: "wired-character", url: "" },
        null,
        "nonsense",
      ]),
    ).toHaveLength(1)
  })

  it("returns undefined when nothing survives, so a chip-less result stays byte-identical", () => {
    expect(readReferences([])).toBeUndefined()
    expect(readReferences([{ id: "c1" }])).toBeUndefined()
    expect(readReferences("nonsense")).toBeUndefined()
    expect(readReferences(undefined)).toBeUndefined()
  })
})
