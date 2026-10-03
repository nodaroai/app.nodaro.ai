/**
 * Two ethnicity picks read as one heritage phrase built from each entry's
 * prompt text — never from its short label, which is picker-grid display copy
 * ("Mediter.", "Pacific Isl.", "any", a bare "East"). Two picks used to put
 * those abbreviations into the prompt: "of mixed Slavic and Mediter. heritage".
 */
import { describe, it, expect } from "vitest"
import { buildPersonHints, buildPersonTerms, PEOPLE } from "../person.js"

const hintsFor = (ethnicity: string[]) => buildPersonHints({ ethnicity })
const termsFor = (ethnicity: string[]) => buildPersonTerms({ ethnicity })

describe("mixed heritage (two ethnicity picks)", () => {
  it("names both heritages in full", () => {
    expect(hintsFor(["slavic", "mediterranean"])).toContain(
      "of mixed Slavic Eastern European and Mediterranean heritage",
    )
    expect(hintsFor(["pacific-islander", "east-asian"])).toContain("of mixed Pacific Islander and East Asian heritage")
  })

  it("never doubles the word heritage", () => {
    expect(hintsFor(["brazilian", "west-african"])).toContain("of mixed Brazilian and West African heritage")
  })

  it("reads the same in compact mode", () => {
    expect(termsFor(["slavic", "mediterranean"])).toContain("of mixed Slavic Eastern European and Mediterranean heritage")
  })

  it("treats 'mixed' paired with a specific pick as that pick", () => {
    expect(hintsFor(["mixed", "italian"])).toEqual(hintsFor(["italian"]))
  })

  it("puts no short-label abbreviation into any two-pick phrase", () => {
    // The short labels' tell-tales: an abbreviation dot ("Mediter.", "Isl."),
    // "(any)" / a bare "any", and a region with no noun ("West", "East").
    const bad = /\.|\(any\)|\bany\b|of mixed (West|East|Central|Southern) and/
    // Paired with French, so French itself is the one entry left out.
    const leaks = PEOPLE.filter((p) => p.dimension === "ethnicity" && p.id !== "mixed" && p.id !== "french")
      .map((p) => `${p.id}: ${hintsFor([p.id, "french"]).find((h) => h.startsWith("of mixed")) ?? "(no phrase)"}`)
      .filter((line) => bad.test(line.slice(line.indexOf(":") + 1)) || line.endsWith("(no phrase)"))
    expect(leaks).toEqual([])
  })
})
